import { TracerParams, VectorPath, PaletteItem, TracerResult } from '../types';

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
        _worker = new TracerWorker();
        _worker!.onmessage = (e) => {
            const { id, type, result, error } = e.data;
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
const _scaledImageCache = new Map<number, ImageData>();
const _wasmInputCache = new Map<string, Uint8Array>();

const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

// --- Helpers ---
export const estimateColors = (data: Uint8ClampedArray, pixelCount: number): number => {
    const sampleSize = 10000;
    const step = Math.max(1, Math.floor(pixelCount / sampleSize));
    const colorCounts = new Map<string, number>();
    let validSamples = 0;
    const QUANTIZE = 8;
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
    if (validSamples === 0) return 2;
    const threshold = validSamples * 0.002;
    let distinctColors = 0;
    for (const count of colorCounts.values()) {
        if (count > threshold) distinctColors++;
    }
    if (distinctColors > 64) return 64;
    return Math.max(4, Math.min(distinctColors, 64));
};

export const autoDetectParams = (imageData: ImageData): Partial<TracerParams> => {
    const { width, height, data } = imageData;
    const pixelCount = width * height;
    const estimatedColors = estimateColors(data, pixelCount);
    const isTinyIcon = width < 128 && height < 128;
    const isHuge = pixelCount > 5000000;

    let params: Partial<TracerParams> = {
        colors: estimatedColors,
        blur: 0,
        noise: 2,
        corners: 60,
        paths: 85,
        sampling: 1,
        colorMode: 'color'
    };

    if (isTinyIcon) {
        params.sampling = 2;
        params.paths = 95;
        params.noise = 0;
        params.corners = 80;
    } else if (isHuge) {
        params.sampling = 1;
        params.noise = 5;
    }

    if (estimatedColors < 8) {
        params.corners = 90;
    } else if (estimatedColors >= 32) {
        params.corners = 50;
        params.colors = 64;
        params.noise = 5;
    }
    // console.log("Auto-Detected Params (WASM v2):", params);
    return params;
};

// --- Main Trace Function ---
export const traceImage = async (originalImageData: ImageData, params: TracerParams): Promise<TracerResult> => {
    await yieldToMain();

    try {
        // Optimization: Terminate previous worker if running to prioritize LATEST request
        const worker = getWorker(_isWorkerBusy);

        // 1. Prepare Key Parameters affecting Input Image
        const scale = params.sampling || 1;
        const blur = params.blur || 0;
        const colorMode = params.colorMode === 'binary' ? 'binary' : 'color';

        const cacheKey = `${scale}-${blur}-${colorMode}`;
        let bytes = _wasmInputCache.get(cacheKey);
        let bgColorHex = '#ffffff';

        // Prepare Base Image (Needed for bytes generation AND bg detection)
        let baseImageData = _scaledImageCache.get(scale);

        if (!baseImageData) {
            let targetWidth = originalImageData.width;
            let targetHeight = originalImageData.height;
            if (scale > 1) {
                targetWidth = Math.floor(originalImageData.width * scale);
                targetHeight = Math.floor(originalImageData.height * scale);
            }
            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('无法创建 Canvas');
            ctx.imageSmoothingEnabled = false;

            if (scale !== 1) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = originalImageData.width;
                tempCanvas.height = originalImageData.height;
                const tempCtx = tempCanvas.getContext('2d');
                if (tempCtx) {
                    tempCtx.putImageData(originalImageData, 0, 0);
                    ctx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);
                }
            } else {
                ctx.putImageData(originalImageData, 0, 0);
            }
            baseImageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
            _scaledImageCache.set(scale, baseImageData);
        }

        // Determine BG Color from Base Image
        if (baseImageData && baseImageData.data.length > 0) {
            const r = baseImageData.data[0];
            const g = baseImageData.data[1];
            const b = baseImageData.data[2];
            bgColorHex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
        }

        if (!bytes) {
            // Step B: Apply Blur & Convert to PNG
            const canvas = document.createElement('canvas');
            canvas.width = baseImageData.width;
            canvas.height = baseImageData.height;
            const ctx = canvas.getContext('2d')!;

            if (blur > 0) ctx.filter = `blur(${blur}px)`;

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = baseImageData.width;
            tempCanvas.height = baseImageData.height;
            const tempCtx = tempCanvas.getContext('2d')!;
            tempCtx.putImageData(baseImageData, 0, 0);

            ctx.drawImage(tempCanvas, 0, 0);

            const blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('转换失败')), 'image/png');
            });
            bytes = new Uint8Array(await blob.arrayBuffer());
            _wasmInputCache.set(cacheKey, bytes);
        }

        // --- Offload to Worker ---
        const requestId = `req-${Date.now()}-${Math.random()}`;

        return new Promise((resolve, reject) => {
            _workerCallbacks.set(requestId, { resolve, reject });

            // Send Data (Transferable buffer for performance)
            // We clone bytes via structured clone (default) to keep the cache valid in Main Thread.

            _isWorkerBusy = true;
            worker.postMessage({
                id: requestId,
                type: 'trace',
                buffer: bytes, // Cloned
                params,
                scale,
                bgColorHex // Pass detected BG color
            });
        });

    } catch (error) {
        console.error('Trace Failed:', error);
        throw error;
    }
};