import { api } from './api';
import { GraphRenderer, type RenderOptions } from './renderer';
import { drawColorbar, COLORMAP_NAMES, type ColormapName } from './colormap';
import type {
  FileEntry, GraphInfo, FeatureInfo,
  QueryRequest, FilterConfig, SimpleFilter, ROIBox, ROISphere, ROIConfig,
} from './types';

interface VisualizationPreset {
  version: 1;
  graph_name: string;
  query: QueryRequest;
  render: {
    nodeColormap: ColormapName;
    edgeColormap: ColormapName;
    pointSize: number;
    nodeOpacity: number;
    edgeOpacity: number;
    solidNodeColor: string;
    solidEdgeColor: string;
    highlightColor: string;
    highlightSize: number;
    dimmedOpacity: number;
  };
}

// ── Global state ──────────────────────────────────────────────────────────────

let activeGraph: string | null = null;
let graphInfo: GraphInfo | null = null;
let nodeColormap: ColormapName = 'jet';
let edgeColormap: ColormapName = 'jet';
let pointSize = 2;
let nodeOpacity = 1.0;
let edgeOpacity = 0.55;
let solidNodeColor = '#5aa6ff';
let solidEdgeColor = '#666688';
let highlightColor = '#ffff00';
let highlightSize  = 6;
let dimmedOpacity  = 0.12;

const queryReq: QueryRequest = {
  position_source: { key: 'feat', x_col: 0, y_col: 1, z_col: 2 },
  node_color: null,
  node_filter: { enabled: false, advanced: false, simple: null, expression: null },
  node_filter_mode: 'reduce' as const,
  node_subsample_factor: 1,
  show_edges: false,
  edge_color: null,
  edge_filter: { enabled: false, advanced: false, simple: null, expression: null },
  edge_subsample_factor: 1,
  roi: { enabled: false, type: 'box', box: null, sphere: null },
};

// ── Renderer ─────────────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const renderer = new GraphRenderer(canvas);

// ── Utilities ─────────────────────────────────────────────────────────────────

function downloadURL(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

function downloadJSON(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  downloadURL(URL.createObjectURL(blob), filename);
}

// ── Toast notifications ───────────────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function toast(msg: string, isError = false): void {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.className = isError ? 'error visible' : 'visible';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3500);
}

// ── Loading overlay ───────────────────────────────────────────────────────────

function setLoading(msg: string | false): void {
  const ov = document.getElementById('loading-overlay')!;
  const tx = document.getElementById('loading-text')!;
  if (msg === false) {
    ov.style.display = 'none';
  } else {
    tx.textContent = msg;
    ov.style.display = 'flex';
  }
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function setStats(html: string): void {
  document.getElementById('stats-bar')!.innerHTML = html;
}

// ── Colorbar ──────────────────────────────────────────────────────────────────

function updateColorbar(title: string, min: number, max: number): void {
  const bar = document.getElementById('colorbar')!;
  const cbCanvas = document.getElementById('colorbar-canvas') as HTMLCanvasElement;
  bar.style.display = 'flex';
  drawColorbar(cbCanvas, nodeColormap);
  document.getElementById('colorbar-max')!.textContent = max.toExponential(3);
  document.getElementById('colorbar-min')!.textContent = min.toExponential(3);
  document.getElementById('colorbar-title')!.textContent = title;
}

function hideColorbar(): void {
  document.getElementById('colorbar')!.style.display = 'none';
}

function updateEdgeColorbar(title: string, min: number, max: number): void {
  const bar = document.getElementById('edge-colorbar')!;
  const cbCanvas = document.getElementById('edge-colorbar-canvas') as HTMLCanvasElement;
  bar.style.display = 'flex';
  drawColorbar(cbCanvas, edgeColormap);
  document.getElementById('edge-colorbar-max')!.textContent = max.toExponential(3);
  document.getElementById('edge-colorbar-min')!.textContent = min.toExponential(3);
  document.getElementById('edge-colorbar-title')!.textContent = title;
}

function hideEdgeColorbar(): void {
  document.getElementById('edge-colorbar')!.style.display = 'none';
}

// ── Screenshot helpers ────────────────────────────────────────────────────────

async function captureFullScreenshot(scale: number, transparent: boolean): Promise<string> {
  const vpEl = document.getElementById('viewport')!;
  const vpRect = vpEl.getBoundingClientRect();
  const W = Math.round(vpRect.width * scale);
  const H = Math.round(vpRect.height * scale);

  const webglUrl = renderer.captureScreenshot(scale, transparent);

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d')!;

  const img = new Image();
  await new Promise<void>(res => { img.onload = () => res(); img.src = webglUrl; });
  ctx.drawImage(img, 0, 0, W, H);

  for (const barId of ['edge-colorbar', 'colorbar']) {
    const bar = document.getElementById(barId);
    if (!bar || bar.style.display === 'none') continue;
    paintBarToCanvas(ctx, bar, vpRect, scale);
  }

  return out.toDataURL('image/png');
}

function paintBarToCanvas(
  ctx: CanvasRenderingContext2D,
  bar: HTMLElement,
  vpRect: DOMRect,
  scale: number,
): void {
  const gradCanvas = bar.querySelector('canvas') as HTMLCanvasElement | null;
  if (gradCanvas) {
    const r = gradCanvas.getBoundingClientRect();
    ctx.drawImage(
      gradCanvas,
      (r.left - vpRect.left) * scale,
      (r.top  - vpRect.top)  * scale,
      r.width  * scale,
      r.height * scale,
    );
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 4 * scale;

  for (const el of bar.querySelectorAll('.cb-label, .cb-title')) {
    const e = el as HTMLElement;
    const text = e.textContent?.trim();
    if (!text) continue;
    const r = e.getBoundingClientRect();
    const cx = (r.left - vpRect.left + r.width / 2) * scale;
    const cy = (r.top  - vpRect.top  + r.height / 2) * scale;
    const fs = Math.max(8, Math.round(10 * scale));
    ctx.font = `${e.classList.contains('cb-title') ? '600 ' : ''}${fs}px "Courier New", monospace`;
    ctx.fillStyle = 'rgba(200,220,255,0.9)';
    ctx.fillText(text, cx, cy);
  }

  ctx.shadowBlur = 0;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function row(labelText: string, ...children: HTMLElement[]): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'row';
  if (labelText) {
    const l = document.createElement('label');
    l.textContent = labelText;
    d.appendChild(l);
  }
  children.forEach((c) => d.appendChild(c));
  return d;
}

function makeSelect(opts: string[], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = document.createElement('select');
  s.className = 'flex-1';
  opts.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    if (o === value) opt.selected = true;
    s.appendChild(opt);
  });
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function makeNumInput(value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.value = String(value);
  inp.min = String(min);
  inp.max = String(max);
  inp.step = String(step);
  inp.addEventListener('change', () => onChange(Number(inp.value)));
  return inp;
}

function makeCheckbox(checked: boolean, label: string, onChange: (v: boolean) => void): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'filter-toggle';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = checked;
  cb.addEventListener('change', () => onChange(cb.checked));
  const span = document.createElement('span');
  span.textContent = label;
  d.appendChild(cb);
  d.appendChild(span);
  return d;
}

function makeSection(title: string, open = true): [HTMLDetailsElement, HTMLDivElement] {
  const details = document.createElement('details');
  details.className = 'panel';
  if (open) details.open = true;
  const summary = document.createElement('summary');
  summary.textContent = title;
  const body = document.createElement('div');
  body.className = 'panel-body';
  details.appendChild(summary);
  details.appendChild(body);
  return [details, body];
}

// ── Feature selector helpers ──────────────────────────────────────────────────

function ndataKeys(): string[] { return Object.keys(graphInfo?.ndata ?? {}); }
function edataKeys(): string[] { return Object.keys(graphInfo?.edata ?? {}); }

function featureInfo(kind: 'node' | 'edge', key: string): FeatureInfo | null {
  if (!graphInfo) return null;
  return kind === 'node' ? (graphInfo.ndata[key] ?? null) : (graphInfo.edata[key] ?? null);
}

// Builds a [key select] + optional [index input] pair and wires them up
function makeFeaturePicker(
  kind: 'node' | 'edge',
  noneLabel: string,
  currentKey: string | null,
  currentIdx: number | null,
  onChanged: (key: string | null, index: number | null) => void,
): HTMLDivElement {
  const keys = kind === 'node' ? ndataKeys() : edataKeys();
  const all = [noneLabel, ...keys];

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:6px;align-items:center;flex:1';

  const keySelect = makeSelect(all, currentKey ?? noneLabel, () => {
    const k = keySelect.value === noneLabel ? null : keySelect.value;
    const fi = k ? featureInfo(kind, k) : null;
    idxInput.style.display = fi?.is_vector ? 'block' : 'none';
    if (fi?.is_vector && Number(idxInput.value) >= fi.num_cols) idxInput.value = '0';
    if (fi?.is_vector) idxInput.max = String(fi.num_cols - 1);
    onChanged(k, fi?.is_vector ? Number(idxInput.value) : null);
  });
  keySelect.style.flex = '1';

  const fi0 = currentKey ? featureInfo(kind, currentKey) : null;
  const idxInput = makeNumInput(currentIdx ?? 0, 0, (fi0?.num_cols ?? 1) - 1, 1, (v) => {
    const k = keySelect.value === noneLabel ? null : keySelect.value;
    onChanged(k, v);
  });
  idxInput.title = 'Column index for vector features';
  idxInput.style.display = (fi0?.is_vector && currentKey !== null) ? 'block' : 'none';

  wrap.appendChild(keySelect);
  wrap.appendChild(idxInput);
  return wrap;
}

function makeColorPickerRow(label: string, initial: string, onChange: (v: string) => void): HTMLDivElement {
  const r = row(label);
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = initial;
  inp.style.flex = '1';
  inp.style.height = '28px';
  inp.style.cursor = 'pointer';
  inp.addEventListener('input', () => onChange(inp.value));
  r.appendChild(inp);
  return r;
}

function makeOpacityRow(label: string, initial: number, onChange: (v: number) => void): HTMLDivElement {
  const r = row(label);
  const inp = document.createElement('input');
  inp.type = 'range'; inp.min = '0'; inp.max = '1'; inp.step = '0.05';
  inp.value = String(initial);
  inp.style.flex = '1';
  inp.addEventListener('input', () => onChange(Number(inp.value)));
  r.appendChild(inp);
  return r;
}

// ── Filter section builder ────────────────────────────────────────────────────

interface HighlightProps {
  getMode(): 'reduce' | 'highlight';
  setMode(v: 'reduce' | 'highlight'): void;
  getColor(): string;
  setColor(v: string): void;
  getSize(): number;
  setSize(v: number): void;
  getDimmedOpacity(): number;
  setDimmedOpacity(v: number): void;
}

function makeFilterSection(
  title: string,
  kind: 'node' | 'edge',
  cfg: FilterConfig,
  hl?: HighlightProps,
): HTMLDetailsElement {
  const [details, body] = makeSection(title, false);

  const keys = kind === 'node' ? ndataKeys() : edataKeys();

  // Enabled toggle
  const enabledCb = makeCheckbox(cfg.enabled, 'Enable filter', (v) => {
    cfg.enabled = v;
    contentDiv.style.display = v ? 'flex' : 'none';
  });
  body.appendChild(enabledCb);

  const contentDiv = document.createElement('div');
  contentDiv.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px';
  contentDiv.style.display = cfg.enabled ? 'flex' : 'none';
  body.appendChild(contentDiv);

  // ── Highlight / Reduce mode toggle (nodes only) ──────────────────────────
  if (hl) {
    const modeRow = document.createElement('div');
    modeRow.className = 'radio-group';
    modeRow.style.marginBottom = '2px';

    for (const m of ['reduce', 'highlight'] as const) {
      const id = `filter-mode-${m}`;
      const rb = document.createElement('input');
      rb.type = 'radio'; rb.name = 'filter-mode'; rb.id = id; rb.value = m;
      rb.checked = hl.getMode() === m;
      rb.addEventListener('change', () => {
        hl.setMode(m);
        hlConfigDiv.style.display = m === 'highlight' ? 'flex' : 'none';
      });
      const lbl = document.createElement('label');
      lbl.htmlFor = id;
      lbl.appendChild(rb);
      lbl.appendChild(document.createTextNode(' ' + m));
      modeRow.appendChild(lbl);
    }
    contentDiv.appendChild(modeRow);

    // Highlight-specific config (color, size, dimmed opacity)
    const hlConfigDiv = document.createElement('div');
    hlConfigDiv.style.cssText = 'display:flex;flex-direction:column;gap:5px';
    hlConfigDiv.style.display = hl.getMode() === 'highlight' ? 'flex' : 'none';

    hlConfigDiv.appendChild(makeColorPickerRow('Highlight color', hl.getColor(), (v) => hl.setColor(v)));
    hlConfigDiv.appendChild(row('Highlight size',
      makeNumInput(hl.getSize(), 1, 30, 1, (v) => hl.setSize(v))));
    hlConfigDiv.appendChild(makeOpacityRow('Dimmed opacity', hl.getDimmedOpacity(), (v) => hl.setDimmedOpacity(v)));

    contentDiv.appendChild(hlConfigDiv);
  }

  // Advanced toggle
  const advCb = makeCheckbox(cfg.advanced, 'Advanced (expression)', (v) => {
    cfg.advanced = v;
    simpleDiv.style.display = v ? 'none' : 'flex';
    advDiv.style.display = v ? 'flex' : 'none';
  });
  contentDiv.appendChild(advCb);

  // ── Simple filter controls ────────────────────────────────────────────────
  const simpleDiv = document.createElement('div');
  simpleDiv.style.cssText = 'display:flex;flex-direction:column;gap:5px';
  simpleDiv.style.display = cfg.advanced ? 'none' : 'flex';

  const initSimple: SimpleFilter = cfg.simple ?? {
    key: keys[0] ?? '',
    index: null,
    op: '>',
    value: 0,
  };

  // key + index picker
  const featPicker = makeFeaturePicker(kind, '— key —', initSimple.key, initSimple.index, (k, idx) => {
    if (!cfg.simple) cfg.simple = { key: '', index: null, op: '>', value: 0 };
    cfg.simple.key = k ?? '';
    cfg.simple.index = idx;
  });
  simpleDiv.appendChild(row('Feature', featPicker));

  // op + value
  const ops = ['<', '<=', '>', '>=', '==', '!='];
  const opSel = makeSelect(ops, initSimple.op, (v) => {
    if (!cfg.simple) cfg.simple = { key: '', index: null, op: '>', value: 0 };
    cfg.simple.op = v as SimpleFilter['op'];
  });
  opSel.style.width = '64px';
  opSel.style.flex = 'unset';

  const valInp = document.createElement('input');
  valInp.type = 'number';
  valInp.value = String(initSimple.value);
  valInp.step = 'any';
  valInp.style.flex = '1';
  valInp.addEventListener('change', () => {
    if (!cfg.simple) cfg.simple = { key: '', index: null, op: '>', value: 0 };
    cfg.simple.value = Number(valInp.value);
  });

  const opRow = row('');
  opRow.style.gap = '6px';
  opRow.appendChild(opSel);
  opRow.appendChild(valInp);
  simpleDiv.appendChild(opRow);

  // Initialize cfg.simple
  if (!cfg.simple) {
    cfg.simple = { ...initSimple };
  }

  contentDiv.appendChild(simpleDiv);

  // ── Advanced filter (expression) ────────────────────────────────────────────
  const advDiv = document.createElement('div');
  advDiv.style.display = cfg.advanced ? 'flex' : 'none';
  advDiv.style.flexDirection = 'column';
  advDiv.style.gap = '4px';

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:10px;color:var(--text-dim)';
  hint.textContent = kind === 'node'
    ? "e.g.  ndata['feat'][:, 3] > 0.5"
    : "e.g.  edata['stim'][:, 0] > 0";
  advDiv.appendChild(hint);

  const textarea = document.createElement('textarea');
  textarea.value = cfg.expression ?? '';
  textarea.placeholder = kind === 'node'
    ? "ndata['label'] > 0.5"
    : "edata['stim'][:, 0] > 0";
  textarea.addEventListener('input', () => { cfg.expression = textarea.value; });
  advDiv.appendChild(textarea);
  contentDiv.appendChild(advDiv);

  return details;
}

// ── Files section ─────────────────────────────────────────────────────────────

async function renderFilesSection(files: FileEntry[]): Promise<void> {
  const container = document.getElementById('files-section')!;
  container.innerHTML = '';

  const [details, body] = makeSection('Files', true);

  // Upload area
  const uploadArea = document.createElement('div');
  uploadArea.className = 'upload-area';
  uploadArea.textContent = '+ Upload .dgl file';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.dgl';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    setLoading('Uploading…');
    try {
      await api.uploadFile(f);
      toast(`Uploaded ${f.name}`);
      const fresh = await api.listFiles();
      await renderFilesSection(fresh);
    } catch (e) {
      toast(String(e), true);
    } finally {
      setLoading(false);
    }
  });
  uploadArea.addEventListener('click', () => fileInput.click());
  body.appendChild(fileInput);
  body.appendChild(uploadArea);

  if (files.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:var(--text-dim);font-size:11px;padding:4px 0';
    empty.textContent = 'No .dgl files on server.';
    body.appendChild(empty);
  }

  for (const f of files) {
    const item = document.createElement('div');
    item.className = 'file-item' + (activeGraph === f.name ? ' active' : '');

    const dot = document.createElement('div');
    dot.className = 'file-dot' + (f.loaded ? ' loaded' : '');

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = f.name;
    name.title = f.name;

    const size = document.createElement('span');
    size.className = 'file-size';
    size.textContent = `${f.size_mb} MB`;

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger';
    delBtn.textContent = '×';
    delBtn.title = 'Delete from server';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete ${f.name} from server?`)) return;
      try {
        await api.deleteFile(f.name);
        if (activeGraph === f.name) {
          activeGraph = null;
          graphInfo = null;
          document.getElementById('graph-controls')!.style.display = 'none';
          hideColorbar();
          hideEdgeColorbar();
          setStats('');
        }
        toast(`Deleted ${f.name}`);
        const fresh = await api.listFiles();
        await renderFilesSection(fresh);
      } catch (e) {
        toast(String(e), true);
      }
    });

    item.appendChild(dot);
    item.appendChild(name);
    item.appendChild(size);
    item.appendChild(delBtn);

    item.addEventListener('click', () => handleFileClick(f.name, f.loaded));
    body.appendChild(item);
  }

  container.appendChild(details);
}

function resetQueryReq(): void {
  queryReq.position_source = { key: 'feat', x_col: 0, y_col: 1, z_col: 2 };
  queryReq.node_color = null;
  queryReq.node_filter = { enabled: false, advanced: false, simple: null, expression: null };
  queryReq.node_filter_mode = 'reduce';
  queryReq.node_subsample_factor = 1;
  queryReq.show_edges = false;
  queryReq.edge_color = null;
  queryReq.edge_filter = { enabled: false, advanced: false, simple: null, expression: null };
  queryReq.edge_subsample_factor = 1;
  queryReq.roi = { enabled: false, type: 'box', box: null, sphere: null };
}

async function handleFileClick(name: string, alreadyLoaded: boolean): Promise<void> {
  if (activeGraph === name) return;

  setLoading(`Loading ${name}…`);
  try {
    const info = alreadyLoaded ? await api.graphInfo(name) : await api.loadGraph(name);
    activeGraph = name;
    graphInfo = info;
    toast(`Loaded ${name} — ${info.num_nodes.toLocaleString()} nodes, ${info.num_edges.toLocaleString()} edges`);
    resetQueryReq();
    buildGraphControls(info);
    const fresh = await api.listFiles();
    await renderFilesSection(fresh);
  } catch (e) {
    toast(String(e), true);
  } finally {
    setLoading(false);
  }
}

// ── Graph controls ────────────────────────────────────────────────────────────

function buildGraphControls(info: GraphInfo): void {
  // Set defaults (only when not already set from a preset load)
  const nkeys = Object.keys(info.ndata);
  const ekeys = Object.keys(info.edata);

  const defaultPosKey = nkeys.find(k => (info.ndata[k].num_cols ?? 1) >= 3) ?? nkeys[0] ?? 'feat';
  if (!queryReq.position_source.key || !info.ndata[queryReq.position_source.key]) {
    queryReq.position_source = { key: defaultPosKey, x_col: 0, y_col: 1, z_col: 2 };
  }
  if (queryReq.node_color === null && nkeys.length > 0) {
    queryReq.node_color = { key: nkeys[0], index: info.ndata[nkeys[0]].is_vector ? 0 : null };
  }
  if (queryReq.edge_color === null && ekeys.length > 0) {
    queryReq.edge_color = { key: ekeys[0], index: info.edata[ekeys[0]].is_vector ? 0 : null };
  }
  if (!queryReq.roi.box) {
    queryReq.roi.box = buildDefaultROIBox(info, queryReq.position_source.key, 0, 1, 2);
  }

  const gc = document.getElementById('graph-controls')!;
  gc.innerHTML = '';
  gc.style.display = 'block';

  gc.appendChild(buildPositionSection(info));
  gc.appendChild(buildNodeColorSection(info));
  gc.appendChild(makeFilterSection('Node filter', 'node', queryReq.node_filter, {
    getMode:          () => queryReq.node_filter_mode,
    setMode:          (v) => { queryReq.node_filter_mode = v; },
    getColor:         () => highlightColor,
    setColor:         (v) => { highlightColor = v; },
    getSize:          () => highlightSize,
    setSize:          (v) => { highlightSize = v; },
    getDimmedOpacity: () => dimmedOpacity,
    setDimmedOpacity: (v) => { dimmedOpacity = v; },
  }));
  gc.appendChild(buildEdgeSection(info));
  gc.appendChild(makeFilterSection('Edge filter', 'edge', queryReq.edge_filter));
  gc.appendChild(buildSamplingSection());

  // ROI section is wrapped so it can be rebuilt when a preset is loaded
  const roiWrapper = document.createElement('div');
  gc.appendChild(roiWrapper);
  function rebuildRoi() {
    roiWrapper.innerHTML = '';
    roiWrapper.appendChild(buildROISection(info, rebuildRoi));
  }
  rebuildRoi();

  gc.appendChild(buildRenderSection());
  gc.appendChild(buildPresetSection());

  const redrawBtn = document.createElement('button');
  redrawBtn.id = 'redraw-btn';
  redrawBtn.textContent = 'Redraw';
  redrawBtn.addEventListener('click', runQuery);
  gc.appendChild(redrawBtn);
}

function buildDefaultROIBox(info: GraphInfo, key: string, xc: number, yc: number, zc: number): ROIBox {
  const fi = info.ndata[key];
  const cs = fi?.col_stats;
  const get = (c: number) => ({ min: cs?.[c]?.min ?? fi?.min ?? 0, max: cs?.[c]?.max ?? fi?.max ?? 1 });
  const x = get(xc), y = get(yc), z = get(zc);
  return { x_min: x.min, x_max: x.max, y_min: y.min, y_max: y.max, z_min: z.min, z_max: z.max };
}

function buildPositionSection(info: GraphInfo): HTMLElement {
  const [details, body] = makeSection('Position source', true);
  const nkeys = Object.keys(info.ndata);

  const keySelect = makeSelect(nkeys, queryReq.position_source.key, (v) => {
    queryReq.position_source.key = v;
    queryReq.roi.box = buildDefaultROIBox(info, v,
      queryReq.position_source.x_col,
      queryReq.position_source.y_col,
      queryReq.position_source.z_col);
  });
  body.appendChild(row('Feature', keySelect));

  const fi0 = info.ndata[queryReq.position_source.key];
  const maxCol = (fi0?.num_cols ?? 1) - 1;

  const mkColInput = (label: string, current: number, assign: (v: number) => void) =>
    row(label, makeNumInput(current, 0, maxCol, 1, assign));

  body.appendChild(mkColInput('X col', queryReq.position_source.x_col, (v) => { queryReq.position_source.x_col = v; }));
  body.appendChild(mkColInput('Y col', queryReq.position_source.y_col, (v) => { queryReq.position_source.y_col = v; }));
  body.appendChild(mkColInput('Z col', queryReq.position_source.z_col, (v) => { queryReq.position_source.z_col = v; }));

  return details;
}

function buildNodeColorSection(info: GraphInfo): HTMLElement {
  const [details, body] = makeSection('Node color', true);

  const hasFeature = queryReq.node_color !== null;

  const solidRow = makeColorPickerRow('Solid color', solidNodeColor, (v) => { solidNodeColor = v; });
  solidRow.style.display = hasFeature ? 'none' : 'flex';

  const cmSelect = makeSelect(COLORMAP_NAMES, nodeColormap, (v) => {
    nodeColormap = v as ColormapName;
    const bar = document.getElementById('colorbar')!;
    if (bar.style.display !== 'none') {
      drawColorbar(document.getElementById('colorbar-canvas') as HTMLCanvasElement, nodeColormap);
    }
  });
  const cmRow = row('Colormap', cmSelect);
  cmRow.style.display = hasFeature ? 'flex' : 'none';

  const picker = makeFeaturePicker('node', '— none —',
    queryReq.node_color?.key ?? null,
    queryReq.node_color?.index ?? null,
    (k, idx) => {
      queryReq.node_color = k ? { key: k, index: idx } : null;
      solidRow.style.display = k ? 'none' : 'flex';
      cmRow.style.display = k ? 'flex' : 'none';
    });
  body.appendChild(row('Feature', picker));
  body.appendChild(solidRow);
  body.appendChild(cmRow);

  body.appendChild(makeOpacityRow('Node opacity', nodeOpacity, (v) => {
    nodeOpacity = v;
    renderer.setNodeOpacity(v);
  }));

  body.appendChild(row('Point size',
    makeNumInput(pointSize, 1, 20, 1, (v) => {
      pointSize = v;
      renderer.setPointSize(v);
    })));

  return details;
}

function buildEdgeSection(info: GraphInfo): HTMLElement {
  const [details, body] = makeSection('Edges', false);

  const enableCb = makeCheckbox(queryReq.show_edges, 'Show edges', (v) => {
    queryReq.show_edges = v;
    edgeBody.style.display = v ? 'flex' : 'none';
  });
  body.appendChild(enableCb);

  const edgeBody = document.createElement('div');
  edgeBody.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:4px';
  edgeBody.style.display = queryReq.show_edges ? 'flex' : 'none';

  const hasEdgeFeature = queryReq.edge_color !== null && Object.keys(info.edata).length > 0;

  const edgeSolidRow = makeColorPickerRow('Solid color', solidEdgeColor, (v) => { solidEdgeColor = v; });
  edgeSolidRow.style.display = hasEdgeFeature ? 'none' : 'flex';

  const edgeCmSelect = makeSelect(COLORMAP_NAMES, edgeColormap, (v) => {
    edgeColormap = v as ColormapName;
  });
  const edgeCmRow = row('Colormap', edgeCmSelect);
  edgeCmRow.style.display = hasEdgeFeature ? 'flex' : 'none';

  if (Object.keys(info.edata).length > 0) {
    const picker = makeFeaturePicker('edge', '— none —',
      queryReq.edge_color?.key ?? null,
      queryReq.edge_color?.index ?? null,
      (k, idx) => {
        queryReq.edge_color = k ? { key: k, index: idx } : null;
        edgeSolidRow.style.display = k ? 'none' : 'flex';
        edgeCmRow.style.display = k ? 'flex' : 'none';
      });
    edgeBody.appendChild(row('Color by', picker));
  }

  edgeBody.appendChild(edgeSolidRow);
  edgeBody.appendChild(edgeCmRow);

  edgeBody.appendChild(makeOpacityRow('Edge opacity', edgeOpacity, (v) => {
    edgeOpacity = v;
    renderer.setEdgeOpacity(v);
  }));

  const edgeFactorInp = makeNumInput(queryReq.edge_subsample_factor, 1, 1e9, 1, (v) => {
    queryReq.edge_subsample_factor = Math.max(1, Math.round(v));
  });
  edgeFactorInp.title = '1 = all edges, 2 = 50%, 100 = 1%, …';
  edgeBody.appendChild(row('Edge factor', edgeFactorInp));

  body.appendChild(edgeBody);
  return details;
}

function buildSamplingSection(): HTMLElement {
  const [details, body] = makeSection('Sampling', true);

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:10px;color:var(--text-dim);margin-bottom:2px';
  hint.textContent = '1 = all, 2 = 50%, 100 = 1%  (applied after all filters)';
  body.appendChild(hint);

  const nodeFactorInp = makeNumInput(queryReq.node_subsample_factor, 1, 1e9, 1, (v) => {
    queryReq.node_subsample_factor = Math.max(1, Math.round(v));
  });
  nodeFactorInp.title = '1 = all nodes, 2 = 50%, N = keep 1/N of filtered nodes';
  body.appendChild(row('Node factor', nodeFactorInp));

  return details;
}

function buildROISection(info: GraphInfo, rebuildSelf?: () => void): HTMLElement {
  const [details, body] = makeSection('ROI', false);

  // Enabled
  const enableCb = makeCheckbox(queryReq.roi.enabled, 'Enable ROI', (v) => {
    queryReq.roi.enabled = v;
    roiBody.style.display = v ? 'flex' : 'none';
  });
  body.appendChild(enableCb);

  const roiBody = document.createElement('div');
  roiBody.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:4px';
  roiBody.style.display = queryReq.roi.enabled ? 'flex' : 'none';
  body.appendChild(roiBody);

  // Type selector
  const typeRow = document.createElement('div');
  typeRow.className = 'radio-group';

  for (const t of ['box', 'sphere'] as const) {
    const id = `roi-type-${t}`;
    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'roi-type';
    rb.id = id;
    rb.value = t;
    rb.checked = queryReq.roi.type === t;
    rb.addEventListener('change', () => {
      queryReq.roi.type = t;
      boxDiv.style.display = t === 'box' ? 'flex' : 'none';
      sphereDiv.style.display = t === 'sphere' ? 'flex' : 'none';
    });
    const lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.appendChild(rb);
    lbl.appendChild(document.createTextNode(' ' + t));
    typeRow.appendChild(lbl);
  }
  roiBody.appendChild(typeRow);

  // Determine default bounds
  const ps = queryReq.position_source;
  const defBox = queryReq.roi.box ?? buildDefaultROIBox(info, ps.key, ps.x_col, ps.y_col, ps.z_col);
  if (!queryReq.roi.box) queryReq.roi.box = defBox;

  // Box controls
  const boxDiv = document.createElement('div');
  boxDiv.style.cssText = 'display:flex;flex-direction:column;gap:5px';
  boxDiv.style.display = queryReq.roi.type === 'box' ? 'flex' : 'none';

  const addAxisRow = (label: string, minKey: keyof ROIBox, maxKey: keyof ROIBox, minV: number, maxV: number) => {
    const r = document.createElement('div');
    r.className = 'row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.flex = '0 0 22px';

    const minInp = document.createElement('input');
    minInp.type = 'number'; minInp.step = 'any';
    minInp.value = String(minV); minInp.style.flex = '1';
    minInp.addEventListener('change', () => { (queryReq.roi.box as ROIBox)[minKey] = Number(minInp.value); });

    const sep = document.createElement('span');
    sep.textContent = '–';
    sep.style.color = 'var(--text-dim)';

    const maxInp = document.createElement('input');
    maxInp.type = 'number'; maxInp.step = 'any';
    maxInp.value = String(maxV); maxInp.style.flex = '1';
    maxInp.addEventListener('change', () => { (queryReq.roi.box as ROIBox)[maxKey] = Number(maxInp.value); });

    r.append(lbl, minInp, sep, maxInp);
    boxDiv.appendChild(r);
  };

  addAxisRow('X', 'x_min', 'x_max', defBox.x_min, defBox.x_max);
  addAxisRow('Y', 'y_min', 'y_max', defBox.y_min, defBox.y_max);
  addAxisRow('Z', 'z_min', 'z_max', defBox.z_min, defBox.z_max);
  roiBody.appendChild(boxDiv);

  // Sphere controls
  const sphereDiv = document.createElement('div');
  sphereDiv.style.cssText = 'display:flex;flex-direction:column;gap:5px';
  sphereDiv.style.display = queryReq.roi.type === 'sphere' ? 'flex' : 'none';

  const cx = (defBox.x_min + defBox.x_max) / 2;
  const cy = (defBox.y_min + defBox.y_max) / 2;
  const cz = (defBox.z_min + defBox.z_max) / 2;
  const r0 = Math.max(defBox.x_max - defBox.x_min, defBox.y_max - defBox.y_min, defBox.z_max - defBox.z_min) / 2;
  const defSphere: ROISphere = queryReq.roi.sphere ?? { cx, cy, cz, radius: r0 };
  if (!queryReq.roi.sphere) queryReq.roi.sphere = defSphere;

  const addSphRow = (label: string, val: number, key: keyof ROISphere) => {
    const inp = document.createElement('input');
    inp.type = 'number'; inp.step = 'any'; inp.value = String(val); inp.className = 'flex-1';
    inp.addEventListener('change', () => { (queryReq.roi.sphere as ROISphere)[key] = Number(inp.value); });
    sphereDiv.appendChild(row(label, inp));
  };
  addSphRow('Center X', defSphere.cx, 'cx');
  addSphRow('Center Y', defSphere.cy, 'cy');
  addSphRow('Center Z', defSphere.cz, 'cz');
  addSphRow('Radius', defSphere.radius, 'radius');
  roiBody.appendChild(sphereDiv);

  // ── ROI presets ─────────────────────────────────────────────────────────────
  const presetDiv = document.createElement('div');
  presetDiv.style.cssText = 'display:flex;flex-direction:column;gap:5px;margin-top:4px;padding-top:6px;border-top:1px solid var(--border)';

  // Save row
  const saveNameInp = document.createElement('input');
  saveNameInp.type = 'text';
  saveNameInp.placeholder = 'Preset name…';
  saveNameInp.className = 'flex-1';

  const savePresetBtn = document.createElement('button');
  savePresetBtn.className = 'btn-sm';
  savePresetBtn.textContent = 'Save';
  savePresetBtn.addEventListener('click', async () => {
    const name = saveNameInp.value.trim();
    if (!name) { toast('Enter a preset name', true); return; }
    try {
      await api.saveRoiPreset(name, queryReq.roi as ROIConfig);
      toast(`ROI preset "${name}" saved`);
      saveNameInp.value = '';
      await refreshPresetList();
    } catch (e) { toast(String(e), true); }
  });

  const saveRow = row('Save as', saveNameInp, savePresetBtn);
  presetDiv.appendChild(saveRow);

  // Load / delete row
  const presetSel = document.createElement('select');
  presetSel.className = 'flex-1';
  const emptyOpt = document.createElement('option');
  emptyOpt.value = ''; emptyOpt.textContent = '— select preset —';
  presetSel.appendChild(emptyOpt);

  async function refreshPresetList() {
    const current = presetSel.value;
    while (presetSel.options.length > 1) presetSel.remove(1);
    try {
      const presets = await api.listRoiPresets();
      for (const p of presets) {
        const opt = document.createElement('option');
        opt.value = p.name; opt.textContent = p.name;
        if (p.name === current) opt.selected = true;
        presetSel.appendChild(opt);
      }
    } catch { /* backend may not be ready */ }
  }
  refreshPresetList();

  const loadPresetBtn = document.createElement('button');
  loadPresetBtn.className = 'btn-sm';
  loadPresetBtn.textContent = 'Load';
  loadPresetBtn.addEventListener('click', async () => {
    const name = presetSel.value;
    if (!name) return;
    try {
      const roi = await api.getRoiPreset(name);
      queryReq.roi = roi;
      rebuildSelf?.();
      toast(`ROI preset "${name}" loaded`);
    } catch (e) { toast(String(e), true); }
  });

  const delPresetBtn = document.createElement('button');
  delPresetBtn.className = 'btn-danger btn-sm';
  delPresetBtn.textContent = '×';
  delPresetBtn.title = 'Delete preset';
  delPresetBtn.addEventListener('click', async () => {
    const name = presetSel.value;
    if (!name) return;
    if (!confirm(`Delete ROI preset "${name}"?`)) return;
    try {
      await api.deleteRoiPreset(name);
      toast(`Deleted "${name}"`);
      await refreshPresetList();
    } catch (e) { toast(String(e), true); }
  });

  const loadRow = row('Preset', presetSel, loadPresetBtn, delPresetBtn);
  presetDiv.appendChild(loadRow);
  roiBody.appendChild(presetDiv);

  return details;
}

function buildRenderSection(): HTMLElement {
  const [details, body] = makeSection('Render options', false);

  body.appendChild(makeCheckbox(false, 'Show axis grid', (v) => renderer.setAxesVisible(v)));

  const fitBtn = document.createElement('button');
  fitBtn.className = 'btn-sm';
  fitBtn.textContent = 'Fit camera';
  fitBtn.style.marginTop = '4px';
  fitBtn.addEventListener('click', () => renderer.fitCamera());
  body.appendChild(fitBtn);

  // Screenshot
  const scaleOpts = ['1×', '2×', '4×'];
  let screenshotScale = 2;
  const scaleSel = makeSelect(scaleOpts, '2×', (v) => { screenshotScale = parseInt(v); });
  scaleSel.style.width = '52px';
  scaleSel.style.flex = 'unset';

  let screenshotTransparent = false;
  const transpCb = makeCheckbox(false, 'Transparent bg', (v) => { screenshotTransparent = v; });

  const shotBtn = document.createElement('button');
  shotBtn.className = 'btn-sm';
  shotBtn.textContent = 'Screenshot';
  shotBtn.style.marginTop = '4px';
  shotBtn.addEventListener('click', async () => {
    shotBtn.disabled = true;
    try {
      const name = activeGraph ? activeGraph.replace('.dgl', '') : 'dglviz';
      const url = await captureFullScreenshot(screenshotScale, screenshotTransparent);
      downloadURL(url, `${name}_${Date.now()}.png`);
    } finally {
      shotBtn.disabled = false;
    }
  });

  const shotRow = row('', shotBtn, scaleSel);
  shotRow.style.marginTop = '4px';
  body.appendChild(shotRow);
  body.appendChild(transpCb);

  return details;
}

// ── Visualization presets (save / load JSON) ──────────────────────────────────

function getRenderState() {
  return { nodeColormap, edgeColormap, pointSize, nodeOpacity, edgeOpacity, solidNodeColor, solidEdgeColor, highlightColor, highlightSize, dimmedOpacity };
}

function savePreset(): void {
  if (!activeGraph) { toast('No graph loaded', true); return; }
  const preset: VisualizationPreset = {
    version: 1,
    graph_name: activeGraph,
    query: JSON.parse(JSON.stringify(queryReq)),  // deep copy
    render: getRenderState(),
  };
  downloadJSON(preset, `${activeGraph.replace('.dgl', '')}_preset.json`);
}

async function loadPreset(file: File): Promise<void> {
  let preset: VisualizationPreset;
  try {
    preset = JSON.parse(await file.text());
  } catch {
    toast('Invalid preset file', true);
    return;
  }
  if (preset.version !== 1) { toast('Unsupported preset version', true); return; }

  // Restore render state
  const r = preset.render;
  nodeColormap = r.nodeColormap;
  edgeColormap = r.edgeColormap;
  pointSize    = r.pointSize;
  nodeOpacity  = r.nodeOpacity;
  edgeOpacity  = r.edgeOpacity;
  solidNodeColor = r.solidNodeColor;
  solidEdgeColor = r.solidEdgeColor;
  highlightColor = r.highlightColor;
  highlightSize  = r.highlightSize;
  dimmedOpacity  = r.dimmedOpacity;

  // Load graph if needed (or switch)
  if (preset.graph_name !== activeGraph) {
    setLoading(`Loading ${preset.graph_name}…`);
    try {
      const info = await api.loadGraph(preset.graph_name);
      activeGraph = preset.graph_name;
      graphInfo = info;
      const fresh = await api.listFiles();
      await renderFilesSection(fresh);
    } catch (e) {
      setLoading(false);
      toast(`Could not load graph "${preset.graph_name}": ${e}`, true);
      return;
    }
    setLoading(false);
  }

  if (!graphInfo) { toast('No graph available', true); return; }

  // Apply preset query then rebuild UI with those values
  Object.assign(queryReq, preset.query);
  buildGraphControls(graphInfo);
  await runQuery();
  toast('Preset loaded');
}

function buildPresetSection(): HTMLElement {
  const [details, body] = makeSection('Visualization preset', false);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-sm';
  saveBtn.textContent = 'Save preset';
  saveBtn.addEventListener('click', savePreset);

  const loadInput = document.createElement('input');
  loadInput.type = 'file';
  loadInput.accept = '.json';
  loadInput.style.display = 'none';
  const loadBtn = document.createElement('button');
  loadBtn.className = 'btn-sm';
  loadBtn.textContent = 'Load preset';
  loadBtn.addEventListener('click', () => loadInput.click());
  loadInput.addEventListener('change', async () => {
    const f = loadInput.files?.[0];
    if (!f) return;
    loadInput.value = '';
    await loadPreset(f);
  });

  const btnRow = row('');
  btnRow.style.gap = '6px';
  btnRow.appendChild(saveBtn);
  btnRow.appendChild(loadBtn);
  btnRow.appendChild(loadInput);
  body.appendChild(btnRow);

  const note = document.createElement('div');
  note.style.cssText = 'font-size:10px;color:var(--text-dim);margin-top:4px';
  note.textContent = 'Graph path is embedded in the preset. On load you can switch to a different file.';
  body.appendChild(note);

  return details;
}

// ── Query + render ────────────────────────────────────────────────────────────

async function runQuery(): Promise<void> {
  if (!activeGraph) return;

  const btn = document.getElementById('redraw-btn') as HTMLButtonElement;
  btn.disabled = true;
  setLoading('Querying…');

  try {
    const result = await api.query(activeGraph, queryReq);

    const inHighlightMode = queryReq.node_filter.enabled && queryReq.node_filter_mode === 'highlight';
    const opts: RenderOptions = {
      nodeCm: nodeColormap, edgeCm: edgeColormap,
      pointSize, nodeOpacity, edgeOpacity,
      solidNodeColor, solidEdgeColor,
      nodeFilterMask: inHighlightMode ? (result.node_filter_mask ?? null) : null,
      highlightColor, highlightSize, dimmedOpacity,
    };
    renderer.update(result, opts);

    const edgeInfo = result.edges.count > 0
      ? ` · ${result.edges.count.toLocaleString()} / ${result.edges.total.toLocaleString()} edges`
      : '';
    setStats(
      `<b>${result.num_nodes_shown.toLocaleString()}</b> / ${result.num_nodes_after_filter.toLocaleString()} nodes shown${edgeInfo}`
    );

    if (result.node_color_range && queryReq.node_color) {
      const title = queryReq.node_color.index !== null
        ? `${queryReq.node_color.key}[${queryReq.node_color.index}]`
        : queryReq.node_color.key;
      updateColorbar(title, result.node_color_range[0], result.node_color_range[1]);
    } else {
      hideColorbar();
    }

    if (result.edges.color_range && queryReq.edge_color) {
      const title = queryReq.edge_color.index !== null
        ? `${queryReq.edge_color.key}[${queryReq.edge_color.index}]`
        : queryReq.edge_color.key;
      updateEdgeColorbar(title, result.edges.color_range[0], result.edges.color_range[1]);
    } else {
      hideEdgeColorbar();
    }
  } catch (e) {
    toast(String(e), true);
  } finally {
    btn.disabled = false;
    setLoading(false);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  setStats('Select a graph file to begin.');
  try {
    const files = await api.listFiles();
    await renderFilesSection(files);
  } catch {
    const container = document.getElementById('files-section')!;
    container.innerHTML =
      '<div style="padding:12px;color:var(--btn-danger);font-size:12px">Cannot reach backend on :8000</div>';
  }
}

init();
