from __future__ import annotations
import dgl
import torch
from pathlib import Path
from typing import Dict, Optional, Tuple

GRAPHS_DIR = Path(__file__).parent.parent / "graphs"
GRAPHS_DIR.mkdir(exist_ok=True)

_graphs: Dict[str, dgl.DGLGraph] = {}
# Pre-cached src/dst tensors to avoid repeated g.edges() calls during queries
_edge_tensors: Dict[str, Tuple[torch.Tensor, torch.Tensor]] = {}


def list_files() -> list[dict]:
    return [
        {
            "name": f.name,
            "size_mb": round(f.stat().st_size / (1024 * 1024), 2),
            "loaded": f.name in _graphs,
        }
        for f in sorted(GRAPHS_DIR.glob("*.dgl"))
    ]


def load_graph(name: str) -> dgl.DGLGraph:
    path = GRAPHS_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"Graph file {name!r} not found in {GRAPHS_DIR}")
    graphs, _ = dgl.load_graphs(str(path))
    g = graphs[0]
    src, dst = g.edges()
    _graphs[name] = g
    _edge_tensors[name] = (src.cpu(), dst.cpu())
    return g


def get_graph(name: str) -> Optional[dgl.DGLGraph]:
    return _graphs.get(name)


def get_edge_tensors(name: str) -> Optional[Tuple[torch.Tensor, torch.Tensor]]:
    return _edge_tensors.get(name)


def unload_graph(name: str) -> None:
    _graphs.pop(name, None)
    _edge_tensors.pop(name, None)


def delete_file(name: str) -> None:
    unload_graph(name)
    path = GRAPHS_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"Graph file {name!r} not found")
    path.unlink()


def get_graph_info(name: str) -> dict:
    g = _graphs.get(name)
    if g is None:
        return {}

    def feat_info(tensor: torch.Tensor) -> dict:
        t = tensor.cpu().float()
        d: dict = {
            "shape": list(t.shape),
            "dtype": str(tensor.dtype),
            "min": float(t.min()),
            "max": float(t.max()),
            "is_vector": t.dim() == 2 and t.shape[1] > 1,
            "num_cols": int(t.shape[1]) if t.dim() == 2 else 1,
        }
        if t.dim() == 2 and t.shape[1] <= 64:
            d["col_stats"] = [
                {"min": float(t[:, c].min()), "max": float(t[:, c].max())}
                for c in range(t.shape[1])
            ]
        return d

    return {
        "num_nodes": g.num_nodes(),
        "num_edges": g.num_edges(),
        "ndata": {k: feat_info(v) for k, v in g.ndata.items()},
        "edata": {k: feat_info(v) for k, v in g.edata.items()},
    }
