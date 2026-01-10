import { TracerParams, VectorPath, PaletteItem, TracerResult } from '../types';

// Global WASM State in Worker
let wasmInstance: any = null;
type StoredImage = { bitmap: ImageBitmap; width: number; height: number };
type PreprocessCacheEntry = { data: ImageData; cachedAt: number };
const _imageStore = new Map<string, StoredImage>();
const _preprocessCache = new Map<string, Map<string, PreprocessCacheEntry>>();
const PREPROCESS_CACHE_LIMIT = 4;
type ThreadStatusState = 'unknown' | 'enabled' | 'disabled' | 'failed';
type ThreadStatus = { state: ThreadStatusState; threads?: number; reason?: string };

let _threadPoolInitPromise: Promise<void> | null = null;
let _threadPoolInitialized = false;
let _threadPoolSkipped = false;
let _threadStatus: ThreadStatus = { state: 'unknown' };

const reportThreadStatus = (status: ThreadStatus) => {
    const isSame = _threadStatus.state === status.state
        && _threadStatus.threads === status.threads
        && _threadStatus.reason === status.reason;
    if (isSame) return;
    _threadStatus = status;
    self.postMessage({ type: 'thread-status', status });
};

const clearImageStore = () => {
    _imageStore.forEach(entry => entry.bitmap.close());
    _imageStore.clear();
    _preprocessCache.clear();
};

const buildPreprocessKey = (scale: number, effectiveBlur: number, crop?: { x: number; y: number; width: number; height: number }) => {
    const cropKey = crop ? `${crop.x},${crop.y},${crop.width},${crop.height}` : 'full';
    return `${scale}|${effectiveBlur}|${cropKey}`;
};

const getCachedPreprocess = (imageId: string, key: string) => {
    const cache = _preprocessCache.get(imageId);
    if (!cache) return null;
    const entry = cache.get(key);
    if (!entry) return null;
    return entry.data;
};

const setCachedPreprocess = (imageId: string, key: string, data: ImageData) => {
    let cache = _preprocessCache.get(imageId);
    if (!cache) {
        cache = new Map();
        _preprocessCache.set(imageId, cache);
    }
    cache.set(key, { data, cachedAt: Date.now() });
    while (cache.size > PREPROCESS_CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value;
        if (!oldestKey) break;
        cache.delete(oldestKey);
    }
};

const buildImageDataFromBitmap = (entry: StoredImage, scale: number, effectiveBlur: number, crop?: { x: number; y: number; width: number; height: number }) => {
    if (typeof OffscreenCanvas === 'undefined') {
        throw new Error('OffscreenCanvas 不可用');
    }
    const srcX = crop ? crop.x : 0;
    const srcY = crop ? crop.y : 0;
    const srcW = crop ? crop.width : entry.width;
    const srcH = crop ? crop.height : entry.height;

    const targetWidth = Math.max(1, Math.floor(srcW * scale));
    const targetHeight = Math.max(1, Math.floor(srcH * scale));

    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 OffscreenCanvas');

    ctx.imageSmoothingEnabled = scale > 1;
    if ('imageSmoothingQuality' in ctx) {
        ctx.imageSmoothingQuality = 'high';
    }
    if ('filter' in ctx) {
        ctx.filter = effectiveBlur > 0 ? `blur(${effectiveBlur}px)` : 'none';
    }

    ctx.drawImage(entry.bitmap, srcX, srcY, srcW, srcH, 0, 0, targetWidth, targetHeight);
    return ctx.getImageData(0, 0, targetWidth, targetHeight);
};

const maybeInitThreadPool = async (module: any) => {
    if (_threadPoolInitialized) return;
    if (_threadPoolInitPromise) {
        await _threadPoolInitPromise;
        return;
    }
    if (!module?.initThreadPool) {
        reportThreadStatus({ state: 'disabled', reason: 'no-init' });
        return;
    }
    if (!self.crossOriginIsolated) {
        if (!_threadPoolSkipped) {
            console.warn('Worker: crossOriginIsolated 未启用，无法初始化 WASM 线程池');
            _threadPoolSkipped = true;
        }
        reportThreadStatus({ state: 'disabled', reason: 'not-isolated' });
        return;
    }
    const hardwareThreads = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0;
    const threadCount = Math.max(1, Math.min(8, (hardwareThreads || 4) - 1));
    console.log(`[WASM 线程池] 硬件线程: ${hardwareThreads}, 计划使用: ${threadCount} 线程`);
    if (threadCount <= 1) {
        _threadPoolInitialized = true;
        console.log('[WASM 线程池] 单线程模式（线程数不足）');
        reportThreadStatus({ state: 'disabled', threads: threadCount, reason: 'single-thread' });
        return;
    }

    // 创建带超时的 Promise，防止多线程初始化卡死
    const timeoutMs = 5000;
    console.log(`[WASM 线程池] 开始初始化 ${threadCount} 个线程...`);
    const initStart = performance.now();
    const initPromise = module.initThreadPool(threadCount);
    const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Thread pool init timeout')), timeoutMs);
    });

    _threadPoolInitPromise = Promise.race([initPromise, timeoutPromise])
        .then(() => {
            const initTime = (performance.now() - initStart).toFixed(1);
            _threadPoolInitialized = true;
            console.log(`[WASM 线程池] ✅ 初始化成功！${threadCount} 线程就绪，耗时 ${initTime}ms`);
            reportThreadStatus({ state: 'enabled', threads: threadCount });
        })
        .catch((error: unknown) => {
            console.warn('[WASM 线程池] ❌ 初始化失败，回退单线程模式', error);
            _threadPoolInitialized = true; // 标记为已初始化，防止重试
            reportThreadStatus({ state: 'failed', reason: 'init-failed' });
            _threadPoolInitPromise = null;
        });
    await _threadPoolInitPromise;
};

const loadWasmInWorker = async () => {
    if (wasmInstance) return wasmInstance;

    try {
        // 直接使用 fetch 加载 WASM 二进制，完全绕过 JS 模块系统
        const wasmUrl = "/wasm/snapsvg_core_bg.wasm";

        // 动态导入 JS 胶水代码
        // 使用 new Function 完全绕过 Vite 的静态分析
        const jsUrl = new URL("/wasm/snapsvg_core.js", self.location.origin).href;
        const dynamicImport = new Function('url', 'return import(url)');

        let module: any;
        try {
            module = await dynamicImport(jsUrl);
        } catch (importError) {
            console.error("Worker: 动态导入 WASM JS 模块失败", importError);
            throw new Error(`无法加载 WASM 模块: ${importError}`);
        }

        // 初始化 WASM 模块 - 使用完整的 URL
        const fullWasmUrl = new URL(wasmUrl, self.location.origin).href;
        await module.default({ module_or_path: fullWasmUrl });

        // 尝试初始化线程池（可选，失败不影响基本功能）
        try {
            await maybeInitThreadPool(module);
        } catch (threadError) {
            console.warn('Worker: 线程池初始化异常，继续使用单线程模式', threadError);
            reportThreadStatus({ state: 'failed', reason: 'exception' });
        }

        wasmInstance = module;
        console.log('Worker: WASM 模块加载成功');
        return wasmInstance;
    } catch (e) {
        console.error("Worker: Failed to load WASM", e);
        throw e;
    }
};

self.onmessage = async (e: MessageEvent) => {
    const { id, type, buffer, params, scale, bgColorHex, rgbaData, width, height, imageId, crop, effectiveBlur, imageBitmap } = e.data;

    if (type === 'clear-images') {
        clearImageStore();
        return;
    }

    if (type === 'set-image' && imageId && imageBitmap) {
        _imageStore.set(imageId, {
            bitmap: imageBitmap,
            width: imageBitmap.width,
            height: imageBitmap.height
        });
        return;
    }

    if (type === 'trace') {
        try {
            const wasm = await loadWasmInWorker();
            let finalRgbaData = rgbaData;
            let finalWidth = width;
            let finalHeight = height;
            let finalBgColorHex = bgColorHex || '#ffffff';

            // 如果提供了 imageId，则在 Worker 内部进行预处理
            if (imageId && _imageStore.has(imageId)) {
                const entry = _imageStore.get(imageId)!;
                const cacheKey = buildPreprocessKey(scale, effectiveBlur || 0, crop);
                const cached = getCachedPreprocess(imageId, cacheKey);

                if (cached) {
                    finalRgbaData = new Uint8Array(cached.data.buffer);
                    finalWidth = cached.width;
                    finalHeight = cached.height;
                } else {
                    const imageData = buildImageDataFromBitmap(entry, scale, effectiveBlur || 0, crop);
                    finalRgbaData = new Uint8Array(imageData.data.buffer);
                    finalWidth = imageData.width;
                    finalHeight = imageData.height;
                    setCachedPreprocess(imageId, cacheKey, imageData);
                }

                // 为了性能，如果使用了 crop，背景色检测逻辑可能需要调整
                // 这里暂时沿用传入的 bgColorHex 或默认值
            }

            const colorCount = Math.max(2, Math.min(64, params.colors));
            const pathPrecision = Math.max(0, Math.min(100, Math.round(params.paths)));
            const cornerThreshold = Math.round((params.corners / 100) * 180);
            const filterSpeckle = Math.round(params.noise);
            const colorMode = params.colorMode === 'binary' ? 'binary' : 'color';

            let svgString: string;
            const traceStart = performance.now();
            const pixelCount = (finalWidth || 0) * (finalHeight || 0);
            console.log(`[WASM Trace] 开始矢量化: ${finalWidth}x${finalHeight} (${(pixelCount / 1000000).toFixed(2)}M 像素), 颜色=${colorCount}, 模式=${colorMode}`);

            if (finalRgbaData && finalWidth && finalHeight) {
                svgString = wasm.trace_rgba_to_svg(
                    finalRgbaData,
                    finalWidth,
                    finalHeight,
                    colorCount,
                    pathPrecision,
                    cornerThreshold,
                    filterSpeckle,
                    colorMode
                );
            } else if (buffer) {
                svgString = wasm.trace_image_to_svg(
                    buffer,
                    colorCount,
                    pathPrecision,
                    cornerThreshold,
                    filterSpeckle,
                    colorMode
                );
            } else {
                throw new Error('No image data provided');
            }

            const traceTime = performance.now() - traceStart;
            const throughput = pixelCount > 0 ? (pixelCount / traceTime / 1000).toFixed(1) : 'N/A';
            console.log(`[WASM Trace] ✅ 完成！耗时 ${traceTime.toFixed(1)}ms, 吞吐量 ${throughput}K 像素/ms`);

            // Parse SVG
            const usePaletteMapping = params.usePaletteMapping === true;
            const targetPalette = usePaletteMapping && params.palette && params.palette.length > 0
                ? params.palette
                : undefined;

            const result = parseSvg(svgString, scale, params.ignoreWhite, params.smartBackground, finalBgColorHex, colorCount, targetPalette);

            self.postMessage({ id, type: 'success', result });

        } catch (error) {
            console.error("Worker Error:", error);
            self.postMessage({ id, type: 'error', error: String(error) });
        }
    }
};

function parseSvg(svgString: string, scale: number, ignoreWhite: boolean, smartBackground: boolean, bgColorHex: string, maxColors: number, targetPalette?: string[]): TracerResult {
    const paths: VectorPath[] = [];
    const colorCounts = new Map<string, number>();

    const pathTagRegex = /<path\s+([^>]+)\/?>/g;
    let pathMatch;
    let pathId = 0;

    const isWhiteOrBg = (hex: string) => {
        if (!ignoreWhite) return false;
        if (hex.toLowerCase() === '#ffffff') return true;
        if (smartBackground && hex.toLowerCase() === bgColorHex.toLowerCase()) return true;
        return false;
    };

    const hexToRgb = (hex: string) => {
        if (!hex) return null;
        let c = hex.trim();
        if (c.startsWith('#')) c = c.slice(1);
        if (c.length === 3) {
            c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        }
        if (c.length !== 6) return null;
        const r = parseInt(c.slice(0, 2), 16);
        const g = parseInt(c.slice(2, 4), 16);
        const b = parseInt(c.slice(4, 6), 16);
        if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
        return { r, g, b };
    };

    const getDist = (c1: { r: number, g: number, b: number }, c2: { r: number, g: number, b: number }) => {
        return (c1.r - c2.r) ** 2 + (c1.g - c2.g) ** 2 + (c1.b - c2.b) ** 2;
    };

    const targetRgbPalette = targetPalette
        ? targetPalette.map(hex => ({ hex, rgb: hexToRgb(hex) })).filter(item => item.rgb !== null) as { hex: string, rgb: { r: number, g: number, b: number } }[]
        : null;

    while ((pathMatch = pathTagRegex.exec(svgString)) !== null) {
        const attrs = pathMatch[1];
        const fillMatch = attrs.match(/fill="([^"]*)"/);
        const dMatch = attrs.match(/d="([^"]*)"/);
        const transformMatch = attrs.match(/transform="translate\(([^,]+),([^)]+)\)"/);

        if (fillMatch && dMatch) {
            let fill = fillMatch[1];
            const d = dMatch[1];
            if (isWhiteOrBg(fill)) continue;

            if (targetRgbPalette) {
                const srcRgb = hexToRgb(fill);
                let minDist = Infinity;
                let nearestHex = targetRgbPalette[0].hex;
                for (const target of targetRgbPalette) {
                    const dist = getDist(srcRgb!, target.rgb);
                    if (dist < minDist) {
                        minDist = dist;
                        nearestHex = target.hex;
                    }
                }
                fill = nearestHex;
            }

            let x = 0;
            let y = 0;
            if (transformMatch) {
                x = parseFloat(transformMatch[1]);
                y = parseFloat(transformMatch[2]);
            }

            paths.push({
                id: `wasm-${pathId++}`,
                d,
                fill,
                stroke: fill,
                strokeWidth: 0.25 * scale,
                x: x / scale,
                y: y / scale,
                initialX: x / scale,
                initialY: y / scale,
                scale: 1 / scale
            });
            colorCounts.set(fill, (colorCounts.get(fill) || 0) + 1);
        }
    }

    if (!targetRgbPalette && colorCounts.size > maxColors) {
        const sortedColors = Array.from(colorCounts.entries()).sort((a, b) => b[1] - a[1]);
        const keepColors = new Set(sortedColors.slice(0, maxColors).map(c => c[0]));
        const colorMap = new Map<string, string>();
        const targetPaletteLocal = Array.from(keepColors).map(hex => ({ hex, rgb: hexToRgb(hex) }));

        for (const [hex] of colorCounts) {
            if (keepColors.has(hex)) {
                colorMap.set(hex, hex);
                continue;
            }
            const srcRgb = hexToRgb(hex);
            let minDist = Infinity;
            let nearestHex = targetPaletteLocal[0].hex!;
            for (const target of targetPaletteLocal) {
                const d = getDist(srcRgb!, target.rgb!);
                if (d < minDist) { minDist = d; nearestHex = target.hex!; }
            }
            colorMap.set(hex, nearestHex);
        }

        colorCounts.clear();
        paths.forEach(p => {
            const newFill = colorMap.get(p.fill) || p.fill;
            p.fill = newFill;
            p.stroke = newFill;
            colorCounts.set(newFill, (colorCounts.get(newFill) || 0) + 1);
        });
    }

    const palette: PaletteItem[] = [];
    for (const [hex, count] of colorCounts.entries()) {
        const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
        palette.push({ hex, ...rgb, count, ratio: count / (paths.length || 1) });
    }
    palette.sort((a, b) => b.count - a.count);

    return { paths, svgString, palette };
}
