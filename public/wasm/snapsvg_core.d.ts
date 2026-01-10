/* tslint:disable */
/* eslint-disable */

/**
 * 获取版本信息
 */
export function get_version(): string;

/**
 * 初始化 panic hook，便于调试
 */
export function init(): void;

/**
 * 将图片字节数组转换为 SVG 字符串
 * 
 * # 参数
 * - `image_bytes`: 图片的原始字节数据 (PNG/JPEG/WEBP 等格式)
 * - `color_count`: 颜色数量 (2-64)
 * - `path_precision`: 路径精度 (1-10，数值越高越精细)
 * - `corner_threshold`: 角点阈值 (0-180度)
 * - `filter_speckle`: 噪点过滤阈值 (像素面积)
 * - `color_mode`: 颜色模式 ("color", "binary")
 * 
 * # 返回
 * SVG 字符串，失败时返回错误信息
 */
export function trace_image_to_svg(image_bytes: Uint8Array, color_count: number, path_precision: number, corner_threshold: number, filter_speckle: number, color_mode: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly get_version: () => [number, number];
  readonly init: () => void;
  readonly trace_image_to_svg: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
