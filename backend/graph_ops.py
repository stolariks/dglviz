from __future__ import annotations
import torch
import numpy as np
from typing import Optional
import dgl

import graph_store
from models import QueryRequest, FilterConfig, SimpleFilter


def _cpu_float(tensor: torch.Tensor) -> torch.Tensor:
    return tensor.cpu().float()


def _extract_scalar(g: dgl.DGLGraph, key: str, index: Optional[int], kind: str) -> torch.Tensor:
    data = g.ndata if kind == "node" else g.edata
    t = _cpu_float(data[key])
    if t.dim() == 1:
        return t
    if index is not None:
        return t[:, index]
    if t.shape[1] == 1:
        return t[:, 0]
    raise ValueError(
        f"Feature '{key}' has {t.shape[1]} columns; specify a column index"
    )


def _apply_simple(g: dgl.DGLGraph, f: SimpleFilter, kind: str) -> torch.Tensor:
    vals = _extract_scalar(g, f.key, f.index, kind)
    ops = {
        "<": torch.lt, "<=": torch.le,
        ">": torch.gt, ">=": torch.ge,
        "==": torch.eq, "!=": torch.ne,
    }
    return ops[f.op](vals, f.value)


def _apply_advanced(g: dgl.DGLGraph, expr: str) -> torch.Tensor:
    # Restricted eval — safe for single-user local tool; do not expose publicly
    ns = {
        "ndata": {k: v.cpu().numpy() for k, v in g.ndata.items()},
        "edata": {k: v.cpu().numpy() for k, v in g.edata.items()},
        "np": np,
    }
    safe_builtins = {"abs": abs, "len": len, "min": min, "max": max, "sum": sum}
    expr = expr.replace("graph.ndata", "ndata").replace("graph.edata", "edata")
    try:
        result = eval(expr, {"__builtins__": safe_builtins}, ns)  # noqa: S307
    except Exception as e:
        raise ValueError(f"Filter expression error: {e}") from e
    return torch.from_numpy(np.asarray(result, dtype=bool))


def _resolve_filter(g: dgl.DGLGraph, cfg: FilterConfig, kind: str) -> Optional[torch.Tensor]:
    if not cfg.enabled:
        return None
    if cfg.advanced and cfg.expression:
        return _apply_advanced(g, cfg.expression)
    if not cfg.advanced and cfg.simple:
        return _apply_simple(g, cfg.simple, kind)
    return None


def _normalize(vals: torch.Tensor) -> tuple[torch.Tensor, float, float]:
    vmin, vmax = float(vals.min()), float(vals.max())
    if vmax > vmin:
        return (vals - vmin) / (vmax - vmin), vmin, vmax
    return torch.zeros_like(vals), vmin, vmax


def query(name: str, req: QueryRequest) -> dict:
    g = graph_store.get_graph(name)
    if g is None:
        raise RuntimeError(f"Graph {name!r} is not loaded; call /load first")

    # ── positions ─────────────────────────────────────────────────────────────
    ps = req.position_source
    pos_feat = _cpu_float(g.ndata[ps.key])
    positions = torch.stack(
        [pos_feat[:, ps.x_col], pos_feat[:, ps.y_col], pos_feat[:, ps.z_col]], dim=1
    )

    # ── ROI ───────────────────────────────────────────────────────────────────
    mask = torch.ones(g.num_nodes(), dtype=torch.bool)
    if req.roi.enabled:
        if req.roi.type == "box" and req.roi.box:
            b = req.roi.box
            mask &= (positions[:, 0] >= b.x_min) & (positions[:, 0] <= b.x_max)
            mask &= (positions[:, 1] >= b.y_min) & (positions[:, 1] <= b.y_max)
            mask &= (positions[:, 2] >= b.z_min) & (positions[:, 2] <= b.z_max)
        elif req.roi.type == "sphere" and req.roi.sphere:
            s = req.roi.sphere
            d2 = (
                (positions[:, 0] - s.cx) ** 2
                + (positions[:, 1] - s.cy) ** 2
                + (positions[:, 2] - s.cz) ** 2
            )
            mask &= d2 <= s.radius ** 2

    # ── node filter ───────────────────────────────────────────────────────────
    fmask = _resolve_filter(g, req.node_filter, "node")
    if fmask is not None:
        mask &= fmask

    # ── subsample (last step after all filtering) ─────────────────────────────
    node_indices = torch.where(mask)[0]
    num_after_filter = int(len(node_indices))
    n_to_show = max(1, num_after_filter // req.node_subsample_factor)
    if n_to_show < num_after_filter:
        perm = torch.randperm(num_after_filter)[:n_to_show]
        node_indices = node_indices[perm]

    # ── node colors ───────────────────────────────────────────────────────────
    node_colors_norm = None
    node_color_range = None
    if req.node_color is not None:
        raw = _extract_scalar(g, req.node_color.key, req.node_color.index, "node")
        normed, vmin, vmax = _normalize(raw[node_indices])
        node_colors_norm = normed.numpy().tolist()
        node_color_range = [vmin, vmax]

    sel_positions = positions[node_indices].numpy().tolist()

    # ── edges ─────────────────────────────────────────────────────────────────
    edges_out: dict = {"src": [], "dst": [], "colors": None, "color_range": None, "count": 0, "total": 0}
    if req.show_edges:
        edge_tensors = graph_store.get_edge_tensors(name)
        if edge_tensors is not None:
            src_all, dst_all = edge_tensors

            # Boolean mask over all nodes, then index src/dst
            node_mask_full = torch.zeros(g.num_nodes(), dtype=torch.bool)
            node_mask_full[node_indices] = True
            edge_mask = node_mask_full[src_all] & node_mask_full[dst_all]

            efmask = _resolve_filter(g, req.edge_filter, "edge")
            if efmask is not None:
                edge_mask &= efmask

            edge_indices = torch.where(edge_mask)[0]
            total_edges = int(len(edge_indices))

            e_to_show = max(1, total_edges // req.edge_subsample_factor)
            if e_to_show < total_edges:
                perm = torch.randperm(total_edges)[:e_to_show]
                edge_indices = edge_indices[perm]

            sel_src = src_all[edge_indices]
            sel_dst = dst_all[edge_indices]

            # Remap original node IDs → local indices in output array
            remap = torch.full((g.num_nodes(),), -1, dtype=torch.long)
            remap[node_indices] = torch.arange(len(node_indices), dtype=torch.long)
            local_src = remap[sel_src].numpy().tolist()
            local_dst = remap[sel_dst].numpy().tolist()

            edge_colors_norm = None
            edge_color_range = None
            if req.edge_color is not None:
                raw_e = _extract_scalar(g, req.edge_color.key, req.edge_color.index, "edge")
                normed_e, evmin, evmax = _normalize(raw_e[edge_indices])
                edge_colors_norm = normed_e.numpy().tolist()
                edge_color_range = [evmin, evmax]

            edges_out = {
                "src": local_src,
                "dst": local_dst,
                "colors": edge_colors_norm,
                "color_range": edge_color_range,
                "count": len(local_src),
                "total": total_edges,
            }

    return {
        "num_nodes_after_filter": num_after_filter,
        "num_nodes_shown": len(node_indices),
        "positions": sel_positions,
        "node_colors": node_colors_norm,
        "node_color_range": node_color_range,
        "node_ids": node_indices.numpy().tolist(),
        "edges": edges_out,
    }
