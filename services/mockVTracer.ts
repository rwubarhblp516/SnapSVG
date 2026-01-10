import { TracerParams, VectorPath, PaletteItem, TracerResult, ThreadStatus } from '../types';

/**
 * ADVANCED VECTOR TRACER (WORKER PROXY)
 * Main Thread: Image Prep, Caching, Worker Communication
 * Worker Thread: WASM execution, SVG Parsing
 */

// --- Worker Initialization ---
// @ts-ignore
import TracerWorker from './tracer.worker?worker';

let _worker: Worker | null = null;
let _isWorkerBusy = false;
const _workerCallbacks = new Map<string, { resolve: Function, reject: Function }>();
let _workerToken = 0;
type WorkerImageInfo = { id: string; token: number };
type WorkerImageInit = { token: number; promise: Promise<string> };
const _workerImageInfo = new WeakMap<ImageData, WorkerImageInfo>();
const _workerImageInit = new WeakMap<ImageData, WorkerImageInit>();
let _threadStatus: ThreadStatus = { state: 'unknown' };
const _threadStatusListeners = new Set<(status: ThreadStatus) => void>();

const notifyThreadStatus = (status: ThreadStatus) => {
    _threadStatus = { ...status };
    _threadStatusListeners.forEach(listener => listener(_threadStatus));
};

export const getThreadStatus = () => _threadStatus;

export const onThreadStatusChange = (listener: (status: ThreadStatus) => void) => {
    _threadStatusListeners.add(listener);
    listener(_threadStatus);
    return () => {
        _threadStatusListeners.delete(listener);
    };
};

const getWorker = (shouldRestart: boolean = false) => {
    if (shouldRestart && _worker) {
        console.log("Worker is busy/stale, terminating to prioritize new request...", _worker);
        _worker.terminate();
        _worker = null;
        _isWorkerBusy = false;
        // Reject all pending promises
        _workerCallbacks.forEach((cb) => cb.reject(new Error('Cancelled by new request')));
        _workerCallbacks.clear();
    }

    if (!_worker) {
        _worker = new TracerWorker({ type: 'module' });
        _workerToken += 1;
        _worker!.onmessage = (e) => {
            const { id, type, result, error, status } = e.data;
            if (type === 'thread-status') {
                if (status) notifyThreadStatus(status as ThreadStatus);
                return;
            }
            _isWorkerBusy = false; // Mark as free
            const callback = _workerCallbacks.get(id);
            if (callback) {
                if (type === 'success') {
                    callback.resolve(result);
                } else {
                    callback.reject(new Error(error));
                }
                _workerCallbacks.delete(id);
            }
        };
    }
    return _worker!;
};

// --- CACHE STATE ---
type ScaledCacheEntry = { data: ImageData; bgColorHex: string };
const _scaledImageCache = new WeakMap<ImageData, Map<string, ScaledCacheEntry>>();
type TraceCacheEntry = { result: TracerResult; cachedAt: number };
const _traceResultCache = new WeakMap<ImageData, Map<string, TraceCacheEntry>>();
const _traceInFlight = new WeakMap<ImageData, Map<string, Promise<TracerResult>>>();
const TRACE_CACHE_LIMIT = 6;
type CropBounds = { x: number; y: number; width: number; height: number; isCropped: boolean };
const _transparentCropCache = new WeakMap<ImageData, CropBounds>();
const ALPHA_CROP_THRESHOLD = 4;

// 预计算 sRGB -> 线性空间，减少重复的 pow 开销
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < SRGB_TO_LINEAR.length; i++) {
    const c = i / 255;
    SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// --- Helpers ---
const getTraceMap = <T>(store: WeakMap<ImageData, Map<string, T>>, imageData: ImageData) => {
    let map = store.get(imageData);
    if (!map) {
        map = new Map();
        store.set(imageData, map);
    }
    return map;
};

const buildTraceKey = (params: TracerParams, scale: number, effectiveBlur: number) => {
    const paletteKey = params.palette ? params.palette.join(',') : '';
    return [
        scale,
        effectiveBlur,
        params.colors,
        params.paths,
        params.corners,
        params.noise,
        params.colorMode,
        params.autoAntiAlias ? 1 : 0,
        params.ignoreWhite ? 1 : 0,
        params.smartBackground ? 1 : 0,
        params.usePaletteMapping ? 1 : 0,
        paletteKey
    ].join('|');
};

const enforceTraceCacheLimit = (cache: Map<string, TraceCacheEntry>) => {
    while (cache.size > TRACE_CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value;
        if (!oldestKey) return;
        cache.delete(oldestKey);
    }
};

const ensureWorkerImage = async (worker: Worker, imageData: ImageData): Promise<string> => {
    const token = _workerToken;
    const existing = _workerImageInfo.get(imageData);
    if (existing && existing.token === token) return existing.id;

    const pending = _workerImageInit.get(imageData);
    if (pending && pending.token === token) return pending.promise;

    const imageId = `img-${Date.now()}-${Math.random()}`;
    const promise = (async () => {
        if (typeof createImageBitmap !== 'function') {
            throw new Error('createImageBitmap 不可用');
        }
        const bitmap = await createImageBitmap(imageData);
        worker.postMessage({ type: 'clear-images' });
        worker.postMessage({ type: 'set-image', imageId, imageBitmap: bitmap }, [bitmap]);
        _workerImageInfo.set(imageData, { id: imageId, token });
        _workerImageInit.delete(imageData);
        return imageId;
    })();

    _workerImageInit.set(imageData, { token, promise });
    return promise;
};

const getTransparentCropBounds = (imageData: ImageData): CropBounds => {
    const cached = _transparentCropCache.get(imageData);
    if (cached) return cached;

    const { width, height, data } = imageData;
    const rowStride = width * 4;
    let hasTransparentEdge = false;

    // 先检查边缘是否存在透明像素，避免无透明边框时全量扫描
    for (let x = 0; x < width; x++) {
        if (data[(x * 4) + 3] <= ALPHA_CROP_THRESHOLD) {
            hasTransparentEdge = true;
            break;
        }
        if (data[((height - 1) * rowStride) + (x * 4) + 3] <= ALPHA_CROP_THRESHOLD) {
            hasTransparentEdge = true;
            break;
        }
    }

    if (!hasTransparentEdge) {
        for (let y = 0; y < height; y++) {
            const rowStart = y * rowStride;
            if (data[rowStart + 3] <= ALPHA_CROP_THRESHOLD || data[rowStart + ((width - 1) * 4) + 3] <= ALPHA_CROP_THRESHOLD) {
                hasTransparentEdge = true;
                break;
            }
        }
    }

    if (!hasTransparentEdge) {
        const bounds = { x: 0, y: 0, width, height, isCropped: false };
        _transparentCropCache.set(imageData, bounds);
        return bounds;
    }

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
        const rowStart = y * rowStride;
        for (let x = 0; x < width; x++) {
            const alpha = data[rowStart + (x * 4) + 3];
            if (alpha > ALPHA_CROP_THRESHOLD) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
    }

    let bounds: CropBounds;
    if (maxX === -1) {
        bounds = { x: 0, y: 0, width, height, isCropped: false };
    } else {
        const cropWidth = maxX - minX + 1;
        const cropHeight = maxY - minY + 1;
        const isCropped = minX > 0 || minY > 0 || maxX < width - 1 || maxY < height - 1;
        bounds = { x: minX, y: minY, width: cropWidth, height: cropHeight, isCropped };
    }

    _transparentCropCache.set(imageData, bounds);
    return bounds;
};

export const estimateColors = (data: Uint8ClampedArray, pixelCount: number): number => {
    // Legacy wrapper for auto-detect
    const { colorCount } = extractPaletteForAnalysis(data, pixelCount);
    return colorCount;
};

const extractPaletteForAnalysis = (data: Uint8ClampedArray, pixelCount: number): { colorCount: number, palette: PaletteItem[] } => {
    const sampleSize = 15000;
    const step = Math.max(1, Math.floor(pixelCount / sampleSize));
    const colorCounts = new Map<string, number>();
    let validSamples = 0;
    const QUANTIZE = 2;

    for (let i = 0; i < pixelCount; i += step) {
        const idx = i * 4;
        if (data[idx + 3] < 128) continue;
        const r = Math.round(data[idx] / QUANTIZE) * QUANTIZE;
        const g = Math.round(data[idx + 1] / QUANTIZE) * QUANTIZE;
        const b = Math.round(data[idx + 2] / QUANTIZE) * QUANTIZE;
        const key = `${r},${g},${b}`;
        colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
        validSamples++;
    }

    if (validSamples === 0) {
        return { colorCount: 4, palette: [] };
    }

    const palette: PaletteItem[] = [];
    let distinctColors = 0;
    const threshold = validSamples * 0.0005;

    for (const [key, count] of colorCounts.entries()) {
        if (count > threshold) distinctColors++;
        const [r, g, b] = key.split(',').map(Number);
        const hex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
        palette.push({ hex, r, g, b, count, ratio: count / validSamples });
    }

    palette.sort((a, b) => b.count - a.count);

    const cappedCount = Math.max(4, Math.min(distinctColors, 64));

    return { colorCount: cappedCount, palette: palette.slice(0, 64) };
};

export const extractPalette = (data: Uint8ClampedArray, pixelCount: number): { colorCount: number, palette: PaletteItem[] } => {
    const sampleSize = 15000; // Slightly larger sample for better palette
    const step = Math.max(1, Math.floor(pixelCount / sampleSize));
    const colorBins = new Map<string, { count: number; rSum: number; gSum: number; bSum: number }>();
    let validSamples = 0;
    const BIN_QUANTIZE = 4; // Group close colors to reduce near-duplicate palette entries

    for (let i = 0; i < pixelCount; i += step) {
        const idx = i * 4;
        if (data[idx + 3] < 128) continue;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const rQ = Math.round(r / BIN_QUANTIZE) * BIN_QUANTIZE;
        const gQ = Math.round(g / BIN_QUANTIZE) * BIN_QUANTIZE;
        const bQ = Math.round(b / BIN_QUANTIZE) * BIN_QUANTIZE;
        const key = `${rQ},${gQ},${bQ}`;
        const bin = colorBins.get(key);
        if (bin) {
            bin.count += 1;
            bin.rSum += r;
            bin.gSum += g;
            bin.bSum += b;
        } else {
            colorBins.set(key, { count: 1, rSum: r, gSum: g, bSum: b });
        }
        validSamples++;
    }

    if (validSamples === 0) {
        return { colorCount: 4, palette: [] };
    }

    const threshold = validSamples * 0.0005; // 0.05% threshold
    let distinctColors = 0;

    const bins = Array.from(colorBins.values());
    for (const bin of bins) {
        if (bin.count > threshold) distinctColors++;
    }

    bins.sort((a, b) => b.count - a.count);

    const rgbToLab = (r: number, g: number, b: number) => {
        const rLin = SRGB_TO_LINEAR[r];
        const gLin = SRGB_TO_LINEAR[g];
        const bLin = SRGB_TO_LINEAR[b];

        const x = rLin * 0.4124 + gLin * 0.3576 + bLin * 0.1805;
        const y = rLin * 0.2126 + gLin * 0.7152 + bLin * 0.0722;
        const z = rLin * 0.0193 + gLin * 0.1192 + bLin * 0.9505;

        const refX = 0.95047;
        const refY = 1.00000;
        const refZ = 1.08883;

        const f = (t: number) => (t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t + 16 / 116));

        const fx = f(x / refX);
        const fy = f(y / refY);
        const fz = f(z / refZ);

        return {
            l: 116 * fy - 16,
            a: 500 * (fx - fy),
            b: 200 * (fy - fz)
        };
    };

    const labDistanceSq = (c1: { l: number; a: number; b: number }, c2: { l: number; a: number; b: number }) => {
        const dl = c1.l - c2.l;
        const da = c1.a - c2.a;
        const db = c1.b - c2.b;
        return dl * dl + da * da + db * db;
    };

    const toHex = (r: number, g: number, b: number) =>
        "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);

    const merged: { count: number; rSum: number; gSum: number; bSum: number; lab: { l: number; a: number; b: number } }[] = [];
    const MERGE_THRESHOLD = 12;
    const MERGE_THRESHOLD_SQ = MERGE_THRESHOLD * MERGE_THRESHOLD;

    for (const bin of bins) {
        const rAvg = Math.round(bin.rSum / bin.count);
        const gAvg = Math.round(bin.gSum / bin.count);
        const bAvg = Math.round(bin.bSum / bin.count);
        const lab = rgbToLab(rAvg, gAvg, bAvg);

        if (merged.length === 0) {
            merged.push({ ...bin, lab });
            continue;
        }

        let nearestIndex = 0;
        let nearestDistSq = Infinity;
        for (let i = 0; i < merged.length; i++) {
            const distSq = labDistanceSq(lab, merged[i].lab);
            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearestIndex = i;
            }
        }

        if (nearestDistSq < MERGE_THRESHOLD_SQ || merged.length >= 64) {
            const target = merged[nearestIndex];
            target.count += bin.count;
            target.rSum += bin.rSum;
            target.gSum += bin.gSum;
            target.bSum += bin.bSum;
            const r = Math.round(target.rSum / target.count);
            const g = Math.round(target.gSum / target.count);
            const b = Math.round(target.bSum / target.count);
            target.lab = rgbToLab(r, g, b);
        } else {
            merged.push({ ...bin, lab });
        }
    }

    const palette: PaletteItem[] = merged.map(entry => {
        const r = Math.round(entry.rSum / entry.count);
        const g = Math.round(entry.gSum / entry.count);
        const b = Math.round(entry.bSum / entry.count);
        const hex = toHex(r, g, b);
        return { hex, r, g, b, count: entry.count, ratio: entry.count / validSamples };
    });

    palette.sort((a, b) => b.count - a.count);

    // Cap color count return for auto-detect logic (0-64)
    const cappedCount = Math.max(4, Math.min(distinctColors, 64));

    return { colorCount: cappedCount, palette: palette.slice(0, 64) };
};

export const autoDetectParams = (imageData: ImageData): Partial<TracerParams> => {
    const { width, height, data } = imageData;
    const pixelCount = width * height;

    // 1. 分析颜色分布
    const { colorCount, palette } = extractPaletteForAnalysis(data, pixelCount);

    // 2. 图像尺寸分类
    const isTinyIcon = width < 128 && height < 128;
    const isSmallIcon = width < 256 && height < 256;
    const isHuge = pixelCount > 4000000; // > 4MP
    const isLarge = pixelCount > 1000000; // > 1MP

    // 3. 分析图像复杂度（通过边缘检测和颜色渐变）
    let edgePixels = 0;
    let gradientScore = 0;
    const sampleStep = Math.max(1, Math.floor(pixelCount / 10000));

    for (let i = sampleStep; i < pixelCount - width; i += sampleStep) {
        const idx = i * 4;
        const rightIdx = (i + 1) * 4;
        const bottomIdx = (i + width) * 4;

        // 计算与右边和下边像素的颜色差异
        const diffRight = Math.abs(data[idx] - data[rightIdx]) +
            Math.abs(data[idx + 1] - data[rightIdx + 1]) +
            Math.abs(data[idx + 2] - data[rightIdx + 2]);
        const diffBottom = Math.abs(data[idx] - data[bottomIdx]) +
            Math.abs(data[idx + 1] - data[bottomIdx + 1]) +
            Math.abs(data[idx + 2] - data[bottomIdx + 2]);

        const maxDiff = Math.max(diffRight, diffBottom);

        // 边缘像素：颜色差异大于阈值
        if (maxDiff > 30) edgePixels++;

        // 渐变得分：中等差异（柔和过渡）
        if (maxDiff > 5 && maxDiff < 50) gradientScore++;
    }

    const edgeRatio = edgePixels / (pixelCount / sampleStep);
    const gradientRatio = gradientScore / (pixelCount / sampleStep);

    const noiseHint = gradientRatio < 0.35 ? 22 : gradientRatio < 0.5 ? 20 : 20;
    const edgeBoost = edgeRatio > 0.35 ? 4 : edgeRatio > 0.25 ? 2 : 0;
    const noiseSuggested = Math.min(30, Math.max(20, noiseHint + edgeBoost));

    // 4. 分析颜色集中度（前N个颜色占比）
    const top5Ratio = palette.slice(0, 5).reduce((sum, p) => sum + p.ratio, 0);
    const top10Ratio = palette.slice(0, 10).reduce((sum, p) => sum + p.ratio, 0);

    // 5. 判断图像类型
    type ImageType = 'icon' | 'clipart' | 'illustration' | 'photo' | 'complex';
    let imageType: ImageType;

    if (isTinyIcon || (isSmallIcon && colorCount <= 16 && top5Ratio > 0.85)) {
        imageType = 'icon';
    } else if (colorCount <= 12 && top5Ratio > 0.8 && edgeRatio < 0.3) {
        imageType = 'clipart';
    } else if (colorCount <= 32 && top10Ratio > 0.7 && gradientRatio < 0.4) {
        imageType = 'illustration';
    } else if (gradientRatio > 0.5 || colorCount > 48) {
        imageType = 'photo';
    } else {
        imageType = 'complex';
    }

    // 6. 根据图像类型设置参数
    let params: Partial<TracerParams>;

    switch (imageType) {
        case 'icon':
            // 小图标：高upscale，保留锐利边缘，低噪点
            params = {
                colors: Math.min(colorCount, 24),
                blur: 0,
                noise: Math.max(20, noiseSuggested),
                corners: 85,
                paths: 90,
                sampling: 4,
                colorMode: 'color',
                autoAntiAlias: true
            };
            break;

        case 'clipart':
            // 简单剪贴画：适中颜色，平滑边缘
            params = {
                colors: Math.min(colorCount, 16),
                blur: 0,
                noise: Math.max(20, noiseSuggested),
                corners: 60,
                paths: 80,
                sampling: 2,
                colorMode: 'color',
                autoAntiAlias: true
            };
            break;

        case 'illustration':
            // 插画/卡通：保留细节但允许一些简化
            params = {
                colors: Math.min(colorCount, 32),
                blur: 0,
                noise: Math.max(20, noiseSuggested),
                corners: 58,
                paths: 82,
                sampling: 2,
                colorMode: 'color',
                autoAntiAlias: true
            };
            break;

        case 'photo':
            // 照片：高颜色数，注重过渡
            params = {
                colors: 48,
                blur: 1,
                noise: Math.max(20, noiseSuggested),
                corners: 45,
                paths: 78,
                sampling: isLarge ? 1 : 2,
                colorMode: 'color',
                autoAntiAlias: false
            };
            break;

        default: // 'complex'
            // 复杂图像：平衡设置
            params = {
                colors: Math.min(colorCount, 40),
                blur: 0,
                noise: Math.max(20, noiseSuggested),
                corners: 58,
                paths: 80,
                sampling: isHuge ? 1 : 2,
                colorMode: 'color',
                autoAntiAlias: true
            };
    }

    // 7. 针对大图调整（避免过度计算）
    if (isHuge) {
        params.sampling = 1;
        params.noise = Math.max(params.noise || 20, 20);
    }

    // 添加检测到的图像类型描述（用于UI显示）
    const typeLabels: Record<ImageType, string> = {
        'icon': '🎯 小图标',
        'clipart': '✨ 剪贴画',
        'illustration': '🎨 插画/卡通',
        'photo': '📷 照片',
        'complex': '🔮 复杂图像'
    };

    console.log(`[AutoDetect] Type: ${imageType}, Colors: ${colorCount}, EdgeRatio: ${edgeRatio.toFixed(2)}, GradientRatio: ${gradientRatio.toFixed(2)}`);

    // 返回结果，包含检测信息用于 UI 提示
    return {
        ...params,
        _detectedType: typeLabels[imageType],
        _detectedColors: colorCount
    } as Partial<TracerParams> & { _detectedType?: string; _detectedColors?: number };
};

// --- Main Trace Function ---
export const traceImage = async (originalImageData: ImageData, params: TracerParams): Promise<TracerResult> => {
    const cropBounds = getTransparentCropBounds(originalImageData);
    const useCrop = cropBounds.isCropped;
    const cropOffsetX = useCrop ? cropBounds.x : 0;
    const cropOffsetY = useCrop ? cropBounds.y : 0;
    const sourceWidth = useCrop ? cropBounds.width : originalImageData.width;
    const sourceHeight = useCrop ? cropBounds.height : originalImageData.height;
    const originalBgColorHex = originalImageData.data.length >= 3
        ? '#' + ((1 << 24) + (originalImageData.data[0] << 16) + (originalImageData.data[1] << 8) + originalImageData.data[2]).toString(16).slice(1)
        : '#ffffff';
    const canUseWorkerPreprocess = typeof (globalThis as any).OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';

    const requestedScale = params.sampling || 1;
    const pixelCount = originalImageData.width * originalImageData.height;
    const allowUpscale = params.autoAntiAlias && requestedScale === 1 && pixelCount <= 2000000;
    const scale = allowUpscale ? 2 : requestedScale;
    const blur = params.blur || 0;
    const effectiveBlur = blur > 0 ? blur : (params.autoAntiAlias ? (scale > 1 ? 0.4 : 0.8) : 0);
    const traceKey = buildTraceKey(params, scale, effectiveBlur);

    const resultCache = getTraceMap(_traceResultCache, originalImageData);
    const cached = resultCache.get(traceKey);
    if (cached) {
        return cached.result;
    }

    const inFlight = getTraceMap(_traceInFlight, originalImageData);
    const existingPromise = inFlight.get(traceKey);
    if (existingPromise) {
        return existingPromise;
    }

    const tracePromise: Promise<TracerResult> = (async () => {
        try {
            const worker = getWorker(_isWorkerBusy);
            const applyCropOffset = (result: TracerResult) => {
                if (!useCrop) return result;
                return {
                    ...result,
                    paths: result.paths.map(p => ({
                        ...p,
                        x: p.x + cropOffsetX,
                        y: p.y + cropOffsetY,
                        initialX: p.initialX + cropOffsetX,
                        initialY: p.initialY + cropOffsetY
                    }))
                };
            };

            const requestTrace = (payload: Record<string, unknown>, transfer?: Transferable[]) => new Promise<TracerResult>((resolve, reject) => {
                const requestId = `req-${Date.now()}-${Math.random()}`;
                _workerCallbacks.set(requestId, { resolve, reject });
                _isWorkerBusy = true;
                if (transfer && transfer.length > 0) {
                    worker.postMessage({
                        id: requestId,
                        type: 'trace',
                        params: { ...params, palette: params.palette },
                        ...payload
                    }, transfer);
                } else {
                    worker.postMessage({
                        id: requestId,
                        type: 'trace',
                        params: { ...params, palette: params.palette },
                        ...payload
                    });
                }
            });

            if (canUseWorkerPreprocess) {
                try {
                    const imageId = await ensureWorkerImage(worker, originalImageData);
                    const crop = useCrop ? { x: cropOffsetX, y: cropOffsetY, width: sourceWidth, height: sourceHeight } : undefined;
                    const result = await requestTrace({
                        imageId,
                        crop,
                        scale,
                        effectiveBlur,
                        bgColorHex: originalBgColorHex
                    });
                    return applyCropOffset(result);
                } catch (error) {
                    console.warn('Worker 预处理失败，回退主线程路径', error);
                }
            }

            const cacheKey = `${scale}-${effectiveBlur}`;
            let bgColorHex = '#ffffff';
            let baseImageData: ImageData | undefined;
            let imageCache = _scaledImageCache.get(originalImageData);
            if (!imageCache) {
                imageCache = new Map();
                _scaledImageCache.set(originalImageData, imageCache);
            }
            const cachedEntry = imageCache.get(cacheKey);
            if (cachedEntry) {
                baseImageData = cachedEntry.data;
                bgColorHex = cachedEntry.bgColorHex;
            }

            // Step A: 获取/缓存缩放后的 ImageData
            if (!baseImageData) {
                let targetWidth = sourceWidth;
                let targetHeight = sourceHeight;
                if (scale > 1) {
                    targetWidth = Math.floor(sourceWidth * scale);
                    targetHeight = Math.floor(sourceHeight * scale);
                }
                const canvas = document.createElement('canvas');
                canvas.width = targetWidth;
                canvas.height = targetHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('无法创建 Canvas');

                ctx.imageSmoothingEnabled = scale > 1;
                ctx.imageSmoothingQuality = 'high';
                ctx.filter = effectiveBlur > 0 ? `blur(${effectiveBlur}px)` : 'none';

                if (scale !== 1 || effectiveBlur > 0) {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = sourceWidth;
                    tempCanvas.height = sourceHeight;
                    const tempCtx = tempCanvas.getContext('2d');
                    if (!tempCtx) throw new Error('Temp Canvas Error');
                    if (useCrop) {
                        tempCtx.putImageData(originalImageData, -cropOffsetX, -cropOffsetY, cropOffsetX, cropOffsetY, sourceWidth, sourceHeight);
                    } else {
                        tempCtx.putImageData(originalImageData, 0, 0);
                    }
                    ctx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);
                } else {
                    if (useCrop) {
                        ctx.putImageData(originalImageData, -cropOffsetX, -cropOffsetY, cropOffsetX, cropOffsetY, sourceWidth, sourceHeight);
                    } else {
                        ctx.putImageData(originalImageData, 0, 0);
                    }
                }

                baseImageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
                // 获取背景色
                if (baseImageData.data.length > 0) {
                    const r = baseImageData.data[0];
                    const g = baseImageData.data[1];
                    const b = baseImageData.data[2];
                    bgColorHex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
                }
                if (useCrop) {
                    bgColorHex = originalBgColorHex;
                }
                imageCache.set(cacheKey, { data: baseImageData, bgColorHex });
            }
            if (!baseImageData) {
                throw new Error('无法获取缩放后的图像数据');
            }

            try {
                // 高性能路径：直接传输 RGBA 数据，跳过 PNG 编解码
                // 使用 Transferable 进行零拷贝传输
                const rgbaBuffer = new Uint8Array(baseImageData.data.buffer.slice(0));
                const result = await requestTrace({
                    rgbaData: rgbaBuffer,
                    width: baseImageData.width,
                    height: baseImageData.height,
                    scale,
                    bgColorHex
                }, [rgbaBuffer.buffer]);
                return applyCropOffset(result);
            } catch (error) {
                if (params.autoAntiAlias && scale > requestedScale) {
                    return await traceImage(originalImageData, {
                        ...params,
                        autoAntiAlias: false,
                        blur: Math.max(params.blur || 0, 0.8)
                    });
                }
                throw error;
            }

        } catch (error) {
            console.error('Trace Failed:', error);
            throw error;
        }
    })();

    inFlight.set(traceKey, tracePromise);

    try {
        const result = await tracePromise;
        resultCache.set(traceKey, { result, cachedAt: Date.now() });
        enforceTraceCacheLimit(resultCache);
        return result;
    } finally {
        inFlight.delete(traceKey);
    }
};
