import type { FileEntry, GraphInfo, QueryRequest, QueryResponse, ROIConfig, CameraState } from './types';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).detail ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listFiles: () =>
    request<FileEntry[]>('GET', '/api/files'),

  uploadFile: async (file: File): Promise<FileEntry> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/files', { method: 'POST', body: fd });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { msg = (await res.json()).detail ?? msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.json() as Promise<FileEntry>;
  },

  deleteFile: (name: string) =>
    request<{ deleted: string }>('DELETE', `/api/files/${name}`),

  loadGraph: (name: string) =>
    request<GraphInfo>('POST', `/api/graphs/${encodeURIComponent(name)}/load`),

  unloadGraph: (name: string) =>
    request<unknown>('POST', `/api/graphs/${encodeURIComponent(name)}/unload`),

  graphInfo: (name: string) =>
    request<GraphInfo>('GET', `/api/graphs/${encodeURIComponent(name)}/info`),

  query: (name: string, req: QueryRequest) =>
    request<QueryResponse>('POST', `/api/graphs/${encodeURIComponent(name)}/query`, req),

  listRoiPresets: () =>
    request<{ name: string }[]>('GET', '/api/roi-presets'),

  getRoiPreset: (name: string) =>
    request<ROIConfig>('GET', `/api/roi-presets/${encodeURIComponent(name)}`),

  saveRoiPreset: (name: string, roi: ROIConfig) =>
    request<{ saved: string }>('POST', `/api/roi-presets/${encodeURIComponent(name)}`, roi),

  deleteRoiPreset: (name: string) =>
    request<{ deleted: string }>('DELETE', `/api/roi-presets/${encodeURIComponent(name)}`),

  listCameraPresets: () =>
    request<{ name: string }[]>('GET', '/api/camera-presets'),

  getCameraPreset: (name: string) =>
    request<CameraState>('GET', `/api/camera-presets/${encodeURIComponent(name)}`),

  saveCameraPreset: (name: string, cam: CameraState) =>
    request<{ saved: string }>('POST', `/api/camera-presets/${encodeURIComponent(name)}`, cam),

  deleteCameraPreset: (name: string) =>
    request<{ deleted: string }>('DELETE', `/api/camera-presets/${encodeURIComponent(name)}`),
};
