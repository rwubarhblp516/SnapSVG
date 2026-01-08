
export interface TracerParams {
  colors: number; // 2-64
  paths: number; // 0-100 (High = tight fit, Low = loose)
  corners: number; // 0-100 (High = sharp, Low = round)
  noise: number; // 0-100 (px area to ignore)
  blur: number; // 0-10 (Pre-processing)
  sampling: number; // New: 1 = Original, 2 = 2x Upscale, 4 = 4x Upscale
  ignoreWhite: boolean; // Remove white background
  smartBackground: boolean; // Flood fill from edges to preserve internal whites
}

export interface VectorPath {
  id: string;
  d: string;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  x: number;
  y: number;
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

export type ViewMode = 'split' | 'overlay' | 'original' | 'vector';

export type PresetName = 'default' | 'high-fidelity' | 'low-fidelity' | '3-colors' | '6-colors' | '16-colors' | 'black-white' | 'sketch';
