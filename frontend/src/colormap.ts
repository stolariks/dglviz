export type ColormapName = 'jet' | 'viridis' | 'inferno' | 'plasma' | 'coolwarm';

type RGB = [number, number, number];
type KeyPoint = [number, RGB];

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
}

function makeColormap(keys: KeyPoint[]): (t: number) => RGB {
  return (t: number): RGB => {
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, c0] = keys[i];
      const [t1, c1] = keys[i + 1];
      if (t <= t1) return lerp(c0, c1, (t - t0) / (t1 - t0));
    }
    return keys[keys.length - 1][1];
  };
}

export const COLORMAPS: Record<ColormapName, (t: number) => RGB> = {
  jet: makeColormap([
    [0.000, [0.000, 0.000, 0.500]],
    [0.125, [0.000, 0.000, 1.000]],
    [0.375, [0.000, 1.000, 1.000]],
    [0.625, [1.000, 1.000, 0.000]],
    [0.875, [1.000, 0.000, 0.000]],
    [1.000, [0.500, 0.000, 0.000]],
  ]),

  viridis: makeColormap([
    [0.000, [0.267, 0.005, 0.329]],
    [0.125, [0.283, 0.141, 0.458]],
    [0.250, [0.254, 0.265, 0.530]],
    [0.375, [0.207, 0.372, 0.553]],
    [0.500, [0.164, 0.471, 0.558]],
    [0.625, [0.128, 0.567, 0.551]],
    [0.750, [0.197, 0.660, 0.498]],
    [0.875, [0.478, 0.752, 0.339]],
    [1.000, [0.993, 0.906, 0.144]],
  ]),

  inferno: makeColormap([
    [0.000, [0.001, 0.001, 0.014]],
    [0.250, [0.222, 0.057, 0.384]],
    [0.500, [0.583, 0.149, 0.338]],
    [0.750, [0.936, 0.429, 0.197]],
    [1.000, [0.988, 1.000, 0.644]],
  ]),

  plasma: makeColormap([
    [0.000, [0.050, 0.030, 0.528]],
    [0.250, [0.459, 0.063, 0.600]],
    [0.500, [0.798, 0.175, 0.450]],
    [0.750, [0.973, 0.463, 0.174]],
    [1.000, [0.940, 0.975, 0.131]],
  ]),

  coolwarm: makeColormap([
    [0.000, [0.230, 0.299, 0.754]],
    [0.250, [0.553, 0.627, 0.895]],
    [0.500, [0.865, 0.865, 0.865]],
    [0.750, [0.957, 0.604, 0.486]],
    [1.000, [0.706, 0.016, 0.150]],
  ]),
};

export const COLORMAP_NAMES: ColormapName[] = ['jet', 'viridis', 'inferno', 'plasma', 'coolwarm'];

export function drawColorbar(canvas: HTMLCanvasElement, cmName: ColormapName): void {
  const ctx = canvas.getContext('2d')!;
  const h = canvas.height;
  const w = canvas.width;
  const cm = COLORMAPS[cmName];
  for (let y = 0; y < h; y++) {
    const t = 1 - y / (h - 1);
    const [r, g, b] = cm(t);
    ctx.fillStyle = `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
    ctx.fillRect(0, y, w, 1);
  }
}
