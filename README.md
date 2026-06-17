# DGLViz

3D web-based visualization platform for DGL graphs (designed for large meshes ~14M nodes / 58M edges).

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI + DGL/PyTorch |
| Frontend | Vite + TypeScript + Three.js |
| 3D rendering | WebGL via Three.js Points + LineSegments |

## Setup

### Backend (Python ≥ 3.10)

```bash
cd backend
pip install -r requirements.txt
python main.py          # starts on http://localhost:8000
# or with auto-reload:
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (Node ≥ 18)

```bash
cd frontend
npm install
npm run dev             # dev server at http://localhost:5173
```

In dev mode, `/api/*` requests are proxied to the backend via `vite.config.ts`.

### Production build

```bash
cd frontend && npm run build   # outputs to frontend/dist/
# FastAPI serves dist/ automatically if it exists
python backend/main.py
```

## Usage

1. Place `.dgl` files in `graphs/` **or** upload via the UI.
2. Click a file in the sidebar → loads into server memory.
3. Configure controls:
   - **Position source** — which ndata key + column indices supply X/Y/Z.
   - **Node color** — pick any ndata feature (scalar or vector column) + colormap.
   - **Node filter** — simple (key / op / threshold) or advanced Python expression.
   - **Edges** — toggle visibility, color by edata feature, set max edge count.
   - **Edge filter** — same options as node filter.
   - **Sampling** — max nodes rendered (random subsample after filter/ROI).
   - **ROI** — axis-aligned box or sphere to restrict the displayed region.
   - **Render options** — axes helper, edge opacity, camera fit.
4. Press **Redraw**.

## Graph file format

Graphs saved with `dgl.save_graphs("path.dgl", [g])`.  
Expected ndata for your mesh graphs: `feat` (N×6: x,y,z,σxx,σyy,σzz), `label` (N×1), `is_stim_node` (N bool).  
Expected edata: `stim` (E×1).

## Advanced filter expressions

The expression runs in a restricted `eval` with:
- `ndata['key']` — numpy arrays for all node features
- `edata['key']` — numpy arrays for all edge features
- `np` — numpy
- `graph.ndata`/`graph.edata` are rewritten automatically

Examples:
```python
ndata['feat'][:, 3] > 1e-5          # Sigma_xx threshold
ndata['label'][:, 0] > 0.5          # label threshold
np.abs(ndata['feat'][:, 0]) < 0.01  # near x=0 plane
edata['stim'][:, 0] > 0             # stimulated edges only
```
