
export interface TracerParams {
  colors: number; // 2-64
  paths: number; // 0-100 (High = tight fit, Low = loose)
  corners: number; // 0-100 (High = sharp, Low = round)
  noise: number; // 0-100 (px area to ignore)
  blur: number; // 0-10 (Pre-processing)
  sampling: number; // 1 = Original, 2 = 2x Upscale, 4 = 4x Upscale
  ignoreWhite: boolean; // Remove background (Boolean toggle)
  smartBackground: boolean; // Flood fill from edges
  colorMode: 'color' | 'grayscale' | 'binary'; // Rendering modes
  autoAntiAlias: boolean; // Morphological smoothing
  backgroundColor?: { r: number; g: number; b: number }; // Target background color
  useWasm?: boolean; // 使用 WASM 后端 (实验性)
}

export interface VectorPath {
  id: string;
  d: string;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  x: number;
  y: number;
  scale?: number; // Optional scaling for WASM upscaled paths
}

export interface PaletteItem {
  hex: string;
  r: number;
  g: number;
  b: number;
  count: number;
  ratio: number; // 0 to 1 (percentage of image)
}

export interface TracerResult {
  paths: VectorPath[];
  svgString: string;
  palette: PaletteItem[];
}

export interface ProcessingStats {
  durationMs: number;
  pathCount: number;
}

export interface ViewportState {
  scale: number;
  x: number;
  y: number;
}

export type ViewMode = 'split' | 'vector' | 'isometric';

export type PresetName = 'clipart' | 'photo' | 'sketch' | 'lineart' | 'poster' | 'default';