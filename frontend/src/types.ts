export interface CameraState {
  position: [number, number, number];
  target:   [number, number, number];
  near: number;
  far:  number;
  fov:  number;
}

export interface FileEntry {
  name: string;
  size_mb: number;
  loaded: boolean;
}

export interface ColStats {
  min: number;
  max: number;
}

export interface FeatureInfo {
  shape: number[];
  dtype: string;
  min: number;
  max: number;
  is_vector: boolean;
  num_cols: number;
  col_stats?: ColStats[];
}

export interface GraphInfo {
  num_nodes: number;
  num_edges: number;
  ndata: Record<string, FeatureInfo>;
  edata: Record<string, FeatureInfo>;
}

export interface PositionSource {
  key: string;
  x_col: number;
  y_col: number;
  z_col: number;
}

export interface FeatureSelector {
  key: string;
  index: number | null;
}

export interface SimpleFilter {
  key: string;
  index: number | null;
  op: '<' | '<=' | '>' | '>=' | '==' | '!=';
  value: number;
}

export interface FilterConfig {
  enabled: boolean;
  advanced: boolean;
  simple: SimpleFilter | null;
  expression: string | null;
}

export interface ROIBox {
  x_min: number; x_max: number;
  y_min: number; y_max: number;
  z_min: number; z_max: number;
}

export interface ROISphere {
  cx: number; cy: number; cz: number;
  radius: number;
}

export interface ROIConfig {
  enabled: boolean;
  type: 'box' | 'sphere';
  box: ROIBox | null;
  sphere: ROISphere | null;
}

export interface QueryRequest {
  position_source: PositionSource;
  node_color: FeatureSelector | null;
  node_filter: FilterConfig;
  node_filter_mode: 'reduce' | 'highlight';
  node_subsample_factor: number;  // 1 = all nodes, N = keep 1/N
  show_edges: boolean;
  edge_color: FeatureSelector | null;
  edge_filter: FilterConfig;
  edge_subsample_factor: number;  // 1 = all edges, N = keep 1/N
  roi: ROIConfig;
}

export interface EdgeResult {
  src: number[];
  dst: number[];
  colors: number[] | null;
  color_range: [number, number] | null;
  count: number;
  total: number;
}

export interface QueryResponse {
  num_nodes_after_filter: number;
  num_nodes_shown: number;
  positions: [number, number, number][];
  node_colors: number[] | null;
  node_color_range: [number, number] | null;
  node_filter_mask: boolean[] | null;
  node_ids: number[];
  edges: EdgeResult;
}
