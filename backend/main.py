from __future__ import annotations
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import graph_store
import graph_ops
from models import QueryRequest

app = FastAPI(title="DGLViz")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── File management ────────────────────────────────────────────────────────────

@app.get("/api/files")
def list_files():
    return graph_store.list_files()


@app.post("/api/files")
async def upload_file(file: UploadFile = File(...)):
    if not (file.filename or "").endswith(".dgl"):
        raise HTTPException(400, "Only .dgl files are accepted")
    dest = graph_store.GRAPHS_DIR / file.filename
    if dest.exists():
        raise HTTPException(409, f"{file.filename!r} already exists on server")
    content = await file.read()
    dest.write_bytes(content)
    return {"name": file.filename, "size_mb": round(len(content) / 1024 ** 2, 2), "loaded": False}


@app.delete("/api/files/{name}")
def delete_file(name: str):
    try:
        graph_store.delete_file(name)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"deleted": name}


# ── Graph lifecycle ────────────────────────────────────────────────────────────

@app.post("/api/graphs/{name}/load")
def load_graph(name: str):
    try:
        graph_store.load_graph(name)
        return graph_store.get_graph_info(name)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


@app.post("/api/graphs/{name}/unload")
def unload_graph(name: str):
    graph_store.unload_graph(name)
    return {"unloaded": name}


@app.get("/api/graphs/{name}/info")
def graph_info(name: str):
    info = graph_store.get_graph_info(name)
    if not info:
        raise HTTPException(404, f"Graph {name!r} is not loaded")
    return info


# ── Visualization query ────────────────────────────────────────────────────────

@app.post("/api/graphs/{name}/query")
def query_graph(name: str, req: QueryRequest):
    try:
        return graph_ops.query(name, req)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


# ── Serve built frontend ───────────────────────────────────────────────────────

_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if _DIST.exists():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
