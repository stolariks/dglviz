import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { COLORMAPS, type ColormapName } from './colormap';
import type { QueryResponse } from './types';

export class GraphRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private points: THREE.Points | null = null;
  private lines: THREE.LineSegments | null = null;
  private axesHelper: THREE.AxesHelper;
  private rafId = 0;
  private firstRender = true;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a18);

    this.camera = new THREE.PerspectiveCamera(55, 1, 1e-4, 1e6);
    this.camera.position.set(0, 0, 10);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.screenSpacePanning = true;

    this.axesHelper = new THREE.AxesHelper(1);
    this.scene.add(this.axesHelper);
    this.axesHelper.visible = false;

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
  }

  private _loop(): void {
    this.rafId = requestAnimationFrame(() => this._loop());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private _clear(): void {
    for (const obj of [this.points, this.lines]) {
      if (!obj) continue;
      this.scene.remove(obj);
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        (obj.material as THREE.Material).dispose();
      }
    }
    this.points = null;
    this.lines = null;
  }

  update(data: QueryResponse, cmName: ColormapName, pointSize: number): void {
    this._clear();

    const n = data.positions.length;
    if (n === 0) return;

    const cm = COLORMAPS[cmName];

    // ── Point cloud ────────────────────────────────────────────────────────────
    const posArr = new Float32Array(n * 3);
    const colArr = new Float32Array(n * 3);

    for (let i = 0; i < n; i++) {
      posArr[i * 3]     = data.positions[i][0];
      posArr[i * 3 + 1] = data.positions[i][1];
      posArr[i * 3 + 2] = data.positions[i][2];

      let r: number, g: number, b: number;
      if (data.node_colors !== null) {
        [r, g, b] = cm(data.node_colors[i]);
      } else {
        [r, g, b] = [0.35, 0.65, 1.0];
      }
      colArr[i * 3]     = r;
      colArr[i * 3 + 1] = g;
      colArr[i * 3 + 2] = b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));

    const mat = new THREE.PointsMaterial({
      size: pointSize,
      vertexColors: true,
      sizeAttenuation: false,
    });

    this.points = new THREE.Points(geo, mat);
    this.scene.add(this.points);

    // ── Edges ──────────────────────────────────────────────────────────────────
    const ec = data.edges.count;
    if (ec > 0) {
      const ePosArr = new Float32Array(ec * 6);
      const eColArr = new Float32Array(ec * 6);
      const { src, dst, colors: eColors } = data.edges;

      for (let i = 0; i < ec; i++) {
        const s = src[i];
        const d = dst[i];

        ePosArr[i * 6]     = data.positions[s][0];
        ePosArr[i * 6 + 1] = data.positions[s][1];
        ePosArr[i * 6 + 2] = data.positions[s][2];
        ePosArr[i * 6 + 3] = data.positions[d][0];
        ePosArr[i * 6 + 4] = data.positions[d][1];
        ePosArr[i * 6 + 5] = data.positions[d][2];

        let r: number, g: number, b: number;
        if (eColors !== null) {
          [r, g, b] = cm(eColors[i]);
        } else {
          [r, g, b] = [0.4, 0.4, 0.5];
        }
        eColArr[i * 6]     = r; eColArr[i * 6 + 1] = g; eColArr[i * 6 + 2] = b;
        eColArr[i * 6 + 3] = r; eColArr[i * 6 + 4] = g; eColArr[i * 6 + 5] = b;
      }

      const eGeo = new THREE.BufferGeometry();
      eGeo.setAttribute('position', new THREE.BufferAttribute(ePosArr, 3));
      eGeo.setAttribute('color', new THREE.BufferAttribute(eColArr, 3));

      const eMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        opacity: 0.55,
        transparent: true,
      });

      this.lines = new THREE.LineSegments(eGeo, eMat);
      this.scene.add(this.lines);
    }

    // ── Axes helper ────────────────────────────────────────────────────────────
    const box = new THREE.Box3().setFromBufferAttribute(
      geo.getAttribute('position') as THREE.BufferAttribute
    );
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    this.axesHelper.scale.setScalar(maxDim * 0.15);
    this.axesHelper.position.copy(box.min);

    // ── Auto-fit camera on first render ───────────────────────────────────────
    if (this.firstRender) {
      this.firstRender = false;
      this.fitCamera(box);
    }
  }

  fitCamera(box?: THREE.Box3): void {
    if (!box && this.points) {
      box = new THREE.Box3().setFromBufferAttribute(
        this.points.geometry.getAttribute('position') as THREE.BufferAttribute
      );
    }
    if (!box) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    const dist = maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0, 0, dist * 1.4));
    this.camera.near = dist * 1e-4;
    this.camera.far  = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  setPointSize(size: number): void {
    if (this.points) {
      (this.points.material as THREE.PointsMaterial).size = size;
    }
  }

  setAxesVisible(v: boolean): void {
    this.axesHelper.visible = v;
  }

  setEdgeOpacity(v: number): void {
    if (this.lines) {
      (this.lines.material as THREE.LineBasicMaterial).opacity = v;
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this._clear();
    this.renderer.dispose();
  }
}
