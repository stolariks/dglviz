import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { COLORMAPS, buildCategoricalMapper, type ColormapName } from './colormap';
import type { QueryResponse } from './types';

export interface RenderOptions {
  nodeCm: ColormapName;
  edgeCm: ColormapName;
  pointSize: number;
  nodeOpacity: number;
  edgeOpacity: number;
  solidNodeColor: string;
  solidEdgeColor: string;
  // highlight mode — when nodeFilterMask is non-null, nodes are split into two draws
  nodeFilterMask: boolean[] | null;
  highlightColor: string;   // hex — solid color for nodes that pass the filter
  highlightSize: number;    // point size for highlighted nodes
  dimmedOpacity: number;    // opacity for nodes that don't pass the filter
}

function hexToRGB(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16 & 0xff) / 255, (v >> 8 & 0xff) / 255, (v & 0xff) / 255];
}

function niceTicks(min: number, max: number, target = 5): number[] {
  const range = max - min;
  if (range === 0) return [min];
  const rawStep = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => range / s <= target) ?? mag * 10;
  const start = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) {
    ticks.push(parseFloat(v.toPrecision(10)));
  }
  return ticks;
}

function fmtTick(v: number): string {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e4 || (abs < 1e-2 && abs > 0)) return v.toExponential(1);
  return parseFloat(v.toPrecision(4)).toString();
}

function seg(a: THREE.Vector3, b: THREE.Vector3, color: number): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
}

function label(text: string, cls: string): CSS2DObject {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  return new CSS2DObject(div);
}

export class GraphRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private css2d: CSS2DRenderer;
  private controls: OrbitControls;
  private points: THREE.Points | null = null;
  private pointsHighlight: THREE.Points | null = null;
  private lines: THREE.LineSegments | null = null;
  private axisGrid: THREE.Group | null = null;
  private gridVisible = false;
  private lastBox: THREE.Box3 | null = null;
  private rafId = 0;
  private firstRender = true;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a18);

    this.camera = new THREE.PerspectiveCamera(55, 1, 1e-4, 1e6);
    this.camera.position.set(0, 0, 10);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.css2d = new CSS2DRenderer();
    const cssEl = this.css2d.domElement;
    cssEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none';
    canvas.parentElement!.appendChild(cssEl);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.screenSpacePanning = true;

    const ro = new ResizeObserver(() => this._resize(canvas));
    ro.observe(canvas);
    this._resize(canvas);

    this._loop();
  }

  private _resize(canvas: HTMLCanvasElement): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.css2d.setSize(w, h);
  }

  private _loop(): void {
    this.rafId = requestAnimationFrame(() => this._loop());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.gridVisible) this.css2d.render(this.scene, this.camera);
  }

  private _clear(): void {
    for (const obj of [this.points, this.pointsHighlight, this.lines]) {
      if (!obj) continue;
      this.scene.remove(obj);
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else (obj.material as THREE.Material).dispose();
    }
    this.points = null;
    this.pointsHighlight = null;
    this.lines = null;
  }

  private _clearGrid(): void {
    if (!this.axisGrid) return;
    this.scene.remove(this.axisGrid);
    this.axisGrid.traverse(obj => {
      if (obj instanceof THREE.Line) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.axisGrid = null;
  }

  private _buildGrid(box: THREE.Box3): void {
    this._clearGrid();

    const group = new THREE.Group();
    const { min, max } = box;
    const size = box.getSize(new THREE.Vector3());
    const tl = Math.max(size.length() * 0.015, 1e-9);

    const xTicks = niceTicks(min.x, max.x);
    const yTicks = niceTicks(min.y, max.y);
    const zTicks = niceTicks(min.z, max.z);

    // Bounding box cage
    const cage = new THREE.Box3Helper(box, new THREE.Color(0x223344));
    group.add(cage);

    // Grid lines on the three base faces (faint)
    const gridMat = new THREE.LineBasicMaterial({ color: 0x1a2a3a, transparent: true, opacity: 0.6 });
    const addGrid = (pts: THREE.Vector3[]) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      group.add(new THREE.Line(g, gridMat));
    };
    // XY plane (z = min.z)
    for (const tx of xTicks) addGrid([new THREE.Vector3(tx, min.y, min.z), new THREE.Vector3(tx, max.y, min.z)]);
    for (const ty of yTicks) addGrid([new THREE.Vector3(min.x, ty, min.z), new THREE.Vector3(max.x, ty, min.z)]);
    // XZ plane (y = min.y)
    for (const tx of xTicks) addGrid([new THREE.Vector3(tx, min.y, min.z), new THREE.Vector3(tx, min.y, max.z)]);
    for (const tz of zTicks) addGrid([new THREE.Vector3(min.x, min.y, tz), new THREE.Vector3(max.x, min.y, tz)]);
    // YZ plane (x = min.x)
    for (const ty of yTicks) addGrid([new THREE.Vector3(min.x, ty, min.z), new THREE.Vector3(min.x, ty, max.z)]);
    for (const tz of zTicks) addGrid([new THREE.Vector3(min.x, min.y, tz), new THREE.Vector3(min.x, max.y, tz)]);

    // ── X axis (red) ─────────────────────────────────────────────────────────
    group.add(seg(new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(max.x, min.y, min.z), 0xff4444));
    for (const t of xTicks) {
      group.add(seg(new THREE.Vector3(t, min.y - tl, min.z), new THREE.Vector3(t, min.y + tl, min.z), 0xff4444));
      const lbl = label(fmtTick(t), 'axis-label');
      lbl.position.set(t, min.y - tl * 4, min.z);
      group.add(lbl);
    }
    const xt = label('X', 'axis-title');
    xt.position.set(max.x + tl * 4, min.y, min.z);
    group.add(xt);

    // ── Y axis (green) ───────────────────────────────────────────────────────
    group.add(seg(new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(min.x, max.y, min.z), 0x44cc44));
    for (const t of yTicks) {
      group.add(seg(new THREE.Vector3(min.x - tl, t, min.z), new THREE.Vector3(min.x + tl, t, min.z), 0x44cc44));
      const lbl = label(fmtTick(t), 'axis-label');
      lbl.position.set(min.x - tl * 4, t, min.z);
      group.add(lbl);
    }
    const yt = label('Y', 'axis-title');
    yt.position.set(min.x, max.y + tl * 4, min.z);
    group.add(yt);

    // ── Z axis (blue) ────────────────────────────────────────────────────────
    group.add(seg(new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(min.x, min.y, max.z), 0x4488ff));
    for (const t of zTicks) {
      group.add(seg(new THREE.Vector3(min.x - tl, min.y, t), new THREE.Vector3(min.x + tl, min.y, t), 0x4488ff));
      const lbl = label(fmtTick(t), 'axis-label');
      lbl.position.set(min.x - tl * 4, min.y, t);
      group.add(lbl);
    }
    const zt = label('Z', 'axis-title');
    zt.position.set(min.x, min.y, max.z + tl * 4);
    group.add(zt);

    this.axisGrid = group;
    group.visible = this.gridVisible;
    this.scene.add(group);
  }

  update(data: QueryResponse, opts: RenderOptions): void {
    this._clear();

    const n = data.positions.length;
    if (n === 0) return;

    const nodeCm =
      opts.nodeCm === 'categorical' && data.node_colors !== null && data.node_color_range !== null
        ? buildCategoricalMapper(data.node_colors, data.node_color_range)
        : COLORMAPS[opts.nodeCm];

    const edgeCm =
      opts.edgeCm === 'categorical' && data.edges.colors !== null && data.edges.color_range !== null
        ? buildCategoricalMapper(data.edges.colors, data.edges.color_range)
        : COLORMAPS[opts.edgeCm];

    // ── Point cloud ──────────────────────────────────────────────────────────
    const mask = opts.nodeFilterMask;

    if (mask !== null) {
      // Highlight mode: two separate point clouds — dimmed (background) + highlighted
      const hlRGB = hexToRGB(opts.highlightColor);

      // Count split
      let nDim = 0, nHl = 0;
      for (let i = 0; i < n; i++) mask[i] ? nHl++ : nDim++;

      const dimPos = new Float32Array(nDim * 3), dimCol = new Float32Array(nDim * 3);
      const hlPos  = new Float32Array(nHl  * 3), hlCol  = new Float32Array(nHl  * 3);
      let di = 0, hi = 0;

      for (let i = 0; i < n; i++) {
        const px = data.positions[i][0], py = data.positions[i][1], pz = data.positions[i][2];
        let r: number, g: number, b: number;
        if (data.node_colors !== null) [r, g, b] = nodeCm(data.node_colors[i]);
        else [r, g, b] = hexToRGB(opts.solidNodeColor);

        if (mask[i]) {
          hlPos[hi * 3] = px; hlPos[hi * 3 + 1] = py; hlPos[hi * 3 + 2] = pz;
          hlCol[hi * 3] = hlRGB[0]; hlCol[hi * 3 + 1] = hlRGB[1]; hlCol[hi * 3 + 2] = hlRGB[2];
          hi++;
        } else {
          dimPos[di * 3] = px; dimPos[di * 3 + 1] = py; dimPos[di * 3 + 2] = pz;
          dimCol[di * 3] = r;  dimCol[di * 3 + 1] = g;  dimCol[di * 3 + 2] = b;
          di++;
        }
      }

      // Dimmed background nodes
      if (nDim > 0) {
        const dimGeo = new THREE.BufferGeometry();
        dimGeo.setAttribute('position', new THREE.BufferAttribute(dimPos, 3));
        dimGeo.setAttribute('color',    new THREE.BufferAttribute(dimCol, 3));
        this.points = new THREE.Points(dimGeo, new THREE.PointsMaterial({
          size: opts.pointSize, vertexColors: true, sizeAttenuation: false,
          opacity: opts.dimmedOpacity, transparent: true,
        }));
        this.scene.add(this.points);
      }

      // Highlighted nodes (drawn on top)
      if (nHl > 0) {
        const hlGeo = new THREE.BufferGeometry();
        hlGeo.setAttribute('position', new THREE.BufferAttribute(hlPos, 3));
        hlGeo.setAttribute('color',    new THREE.BufferAttribute(hlCol, 3));
        this.pointsHighlight = new THREE.Points(hlGeo, new THREE.PointsMaterial({
          size: opts.highlightSize, vertexColors: true, sizeAttenuation: false,
          opacity: opts.nodeOpacity, transparent: opts.nodeOpacity < 1,
        }));
        this.scene.add(this.pointsHighlight);
      }
    } else {
      // Normal (reduce) mode — single point cloud
      const posArr = new Float32Array(n * 3);
      const colArr = new Float32Array(n * 3);

      for (let i = 0; i < n; i++) {
        posArr[i * 3]     = data.positions[i][0];
        posArr[i * 3 + 1] = data.positions[i][1];
        posArr[i * 3 + 2] = data.positions[i][2];

        let r: number, g: number, b: number;
        if (data.node_colors !== null) [r, g, b] = nodeCm(data.node_colors[i]);
        else [r, g, b] = hexToRGB(opts.solidNodeColor);
        colArr[i * 3] = r; colArr[i * 3 + 1] = g; colArr[i * 3 + 2] = b;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
      geo.setAttribute('color',    new THREE.BufferAttribute(colArr, 3));

      this.points = new THREE.Points(geo, new THREE.PointsMaterial({
        size: opts.pointSize, vertexColors: true, sizeAttenuation: false,
        opacity: opts.nodeOpacity, transparent: opts.nodeOpacity < 1,
      }));
      this.scene.add(this.points);
    }

    // ── Edges ────────────────────────────────────────────────────────────────
    const ec = data.edges.count;
    if (ec > 0) {
      const ePosArr = new Float32Array(ec * 6);
      const eColArr = new Float32Array(ec * 6);
      const { src, dst, colors: eColors } = data.edges;

      for (let i = 0; i < ec; i++) {
        const s = src[i], d = dst[i];
        ePosArr[i * 6]     = data.positions[s][0];
        ePosArr[i * 6 + 1] = data.positions[s][1];
        ePosArr[i * 6 + 2] = data.positions[s][2];
        ePosArr[i * 6 + 3] = data.positions[d][0];
        ePosArr[i * 6 + 4] = data.positions[d][1];
        ePosArr[i * 6 + 5] = data.positions[d][2];

        let r: number, g: number, b: number;
        if (eColors !== null) { [r, g, b] = edgeCm(eColors[i]); }
        else                  { [r, g, b] = hexToRGB(opts.solidEdgeColor); }
        eColArr[i * 6]     = r; eColArr[i * 6 + 1] = g; eColArr[i * 6 + 2] = b;
        eColArr[i * 6 + 3] = r; eColArr[i * 6 + 4] = g; eColArr[i * 6 + 5] = b;
      }

      const eGeo = new THREE.BufferGeometry();
      eGeo.setAttribute('position', new THREE.BufferAttribute(ePosArr, 3));
      eGeo.setAttribute('color',    new THREE.BufferAttribute(eColArr, 3));

      this.lines = new THREE.LineSegments(eGeo, new THREE.LineBasicMaterial({
        vertexColors: true,
        opacity: opts.edgeOpacity,
        transparent: true,
      }));
      this.scene.add(this.lines);
    }

    // ── Axis grid (always from full positions set) ───────────────────────────
    const allPos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      allPos[i * 3] = data.positions[i][0];
      allPos[i * 3 + 1] = data.positions[i][1];
      allPos[i * 3 + 2] = data.positions[i][2];
    }
    const box = new THREE.Box3().setFromArray(allPos);
    this.lastBox = box;
    this._buildGrid(box);

    if (this.firstRender) {
      this.firstRender = false;
      this.fitCamera(box);
    }
  }

  fitCamera(box?: THREE.Box3): void {
    const b = box ?? this.lastBox;
    if (!b) return;
    const center = b.getCenter(new THREE.Vector3());
    const size   = b.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    const dist   = maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0, 0, dist * 1.4));
    this.camera.near = dist * 1e-4;
    this.camera.far  = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  setPointSize(v: number): void {
    if (this.points) (this.points.material as THREE.PointsMaterial).size = v;
  }

  setNodeOpacity(v: number): void {
    for (const pts of [this.points, this.pointsHighlight]) {
      if (!pts) continue;
      const m = pts.material as THREE.PointsMaterial;
      m.opacity = v; m.transparent = v < 1; m.needsUpdate = true;
    }
  }

  setEdgeOpacity(v: number): void {
    if (this.lines) (this.lines.material as THREE.LineBasicMaterial).opacity = v;
  }

  captureScreenshot(scale = 2, transparent = false): string {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    const prevBg = this.scene.background;
    if (transparent) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    }

    this.renderer.setSize(w * scale, h * scale, false);
    this.renderer.render(this.scene, this.camera);
    const url = canvas.toDataURL('image/png');
    this.renderer.setSize(w, h, false);

    if (transparent) {
      this.scene.background = prevBg;
      this.renderer.setClearColor(0x000000, 1);
    }

    return url;
  }

  setAxesVisible(v: boolean): void {
    this.gridVisible = v;
    if (this.axisGrid) this.axisGrid.visible = v;
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this._clear();
    this._clearGrid();
    this.css2d.domElement.remove();
    this.renderer.dispose();
  }
}
