export type ColormapName = 'jet' | 'viridis' | 'inferno' | 'plasma' | 'coolwarm' | 'categorical';

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

// tab10 — for non-negative integer categories
export const CATEGORICAL_PALETTE: RGB[] = [
  [0.122, 0.467, 0.706],
  [1.000, 0.498, 0.055],
  [0.173, 0.627, 0.173],
  [0.839, 0.153, 0.157],
  [0.580, 0.404, 0.741],
  [0.549, 0.337, 0.294],
  [0.890, 0.467, 0.761],
  [0.498, 0.498, 0.498],
  [0.737, 0.741, 0.133],
  [0.090, 0.745, 0.812],
];

// High-contrast neon palette — for negative integer categories
export const CATEGORICAL_PALETTE_NEG: RGB[] = [
  [1.000, 0.000, 0.800],  // hot magenta
  [1.000, 0.920, 0.000],  // bright yellow
  [0.000, 1.000, 0.750],  // cyan-green
  [1.000, 0.380, 0.000],  // hot orange
  [0.400, 1.000, 0.000],  // lime
  [0.000, 0.650, 1.000],  // electric blue
  [1.000, 0.000, 0.380],  // hot pink
  [0.900, 1.000, 0.000],  // yellow-lime
  [0.000, 1.000, 0.380],  // spring green
  [1.000, 0.500, 1.000],  // orchid
];

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

  // Fallback used only for the colorbar preview; actual rendering uses buildCategoricalMapper
  categorical: (t: number): RGB => {
    const idx = Math.round(Math.max(0, Math.min(1, t)) * (CATEGORICAL_PALETTE.length - 1));
    return CATEGORICAL_PALETTE[idx];
  },
};

export const COLORMAP_NAMES: ColormapName[] = ['jet', 'viridis', 'inferno', 'plasma', 'coolwarm', 'categorical'];

/**
 * Builds a categorical colormap function by scanning the actual normalised values
 * and mapping each unique rounded integer to its own palette slot (by sorted rank).
 * Supports any integer values, not just 0-based indices; cycles after 10 categories.
 */
/**
 * Builds a categorical colormap function from actual data values.
 * - Non-negative integers → tab10 palette (by ascending rank: 0, 1, 2, …)
 * - Negative integers → high-contrast neon palette (by descending rank: -1, -2, …)
 * Supports any sparse integer values; cycles after 10 per sign group.
 */
export function buildCategoricalMapper(
  normalizedValues: number[],
  colorRange: [number, number],
): (t: number) => RGB {
  const [vMin, vMax] = colorRange;
  const span = vMax - vMin;

  const negSeen = new Set<number>();
  const posSeen = new Set<number>();
  for (const t of normalizedValues) {
    const raw = Math.round(t * span + vMin);
    if (raw < 0) negSeen.add(raw); else posSeen.add(raw);
  }

  // negatives: -1 first (rank 0), -2 second (rank 1), …
  const negMap = new Map(
    Array.from(negSeen).sort((a, b) => b - a).map((v, i) => [v, i % CATEGORICAL_PALETTE_NEG.length])
  );
  // non-negatives: 0 first, 1 second, …
  const posMap = new Map(
    Array.from(posSeen).sort((a, b) => a - b).map((v, i) => [v, i % CATEGORICAL_PALETTE.length])
  );

  return (t: number): RGB => {
    const raw = Math.round(t * span + vMin);
    if (raw < 0) return CATEGORICAL_PALETTE_NEG[negMap.get(raw) ?? 0];
    return CATEGORICAL_PALETTE[posMap.get(raw) ?? 0];
  };
}

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
