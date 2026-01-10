import { TracerParams, VectorPath, PaletteItem, TracerResult } from '../types';

// Define the worker interface types locally or import if possible
// Since importing types in a worker can be tricky depending on build, 
// we'll try to keep imports minimal or just redefine interfaces if needed.
// But usually Vite supports it.

// Global WASM State in Worker
let wasmInstance: any = null;
type StoredImage = { bitmap: ImageBitmap; width: number; height: number };
type PreprocessCacheEntry = { data: ImageData; cachedAt: number };
const _imageStore = new Map<string, StoredImage>();
const _preprocessCache = new Map<string, Map<string, PreprocessCacheEntry>>();
const PREPROCESS_CACHE_LIMIT = 4;
let _threadPoolInitPromise: Promise<void> | null = null;
let _threadPoolInitialized = false;
let _threadPoolSkipped = false;

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
    if (!module?.initThreadPool) return;
    if (!self.crossOriginIsolated) {
        if (!_threadPoolSkipped) {
            console.warn('Worker: crossOriginIsolated 未启用，无法初始化 WASM 线程池');
            _threadPoolSkipped = true;
        }
        return;
    }
    const hardwareThreads = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0;
    const threadCount = Math.max(1, Math.min(8, (hardwareThreads || 4) - 1));
    if (threadCount <= 1) {
        _threadPoolInitialized = true;
        return;
    }
    _threadPoolInitPromise = module.initThreadPool(threadCount)
        .then(() => {
            _threadPoolInitialized = true;
        })
        .catch((error: unknown) => {
            console.warn('Worker: 线程池初始化失败，将回退单线程', error);
            _threadPoolInitPromise = null;
        });
    await _threadPoolInitPromise;
};

const loadWasmInWorker = async () => {
    if (wasmInstance) return wasmInstance;

    try {
        // Use absolute path for public assets
        // Note: In a Worker, self.location.origin is available.
        const baseUrl = self.location.origin;

        // We use importScripts or dynamic import. 
        // Since we are in a module worker (Vite default), dynamic import works.
        // We directly import the JS glue code.
        const module = await import(/* @vite-ignore */ `${baseUrl}/wasm/snapsvg_core.js`);

        // Fix for "deprecated parameters" warning: pass object with module_or_path
        await module.default({ module_or_path: `${baseUrl}/wasm/snapsvg_core_bg.wasm` });
        await maybeInitThreadPool(module);

        wasmInstance = module;
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

    if (type === 'set-image') {
        if (!imageId || !imageBitmap) {
            console.error('Worker: set-image 缺少必要数据');
            return;
        }
        const entry = _imageStore.get(imageId);
        if (entry) entry.bitmap.close();
        _imageStore.set(imageId, {
            bitmap: imageBitmap as ImageBitmap,
            width: (imageBitmap as ImageBitmap).width,
            height: (imageBitmap as ImageBitmap).height
        });
        _preprocessCache.delete(imageId);
        return;
    }

    if (type === 'trace') {
        try {
            const wasm = await loadWasmInWorker();

            const colorCount = Math.max(2, Math.min(64, params.colors));
            const precisionMax = params.autoAntiAlias ? 5 : 8;
            const pathPrecision = Math.max(1, Math.round((params.paths / 100) * precisionMax));
            const cornerScale = params.autoAntiAlias ? 0.85 : 1;
            const cornerThreshold = Math.round((params.corners / 100) * 180 * cornerScale);
            const filterSpeckle = Math.round(params.noise);
            const colorMode = params.colorMode === 'binary' ? 'binary' : 'color';

            let svgString: string;

            // 优先使用 RGBA 直接传输（高性能模式）
            if (rgbaData && width && height) {
                // 使用新的高性能 API - 跳过 PNG 编解码
                svgString = wasm.trace_rgba_to_svg(
                    rgbaData,
                    width,
                    height,
                    colorCount,
                    pathPrecision,
                    cornerThreshold,
                    filterSpeckle,
                    colorMode
                );
            } else if (imageId) {
                const entry = _imageStore.get(imageId);
                if (!entry) {
                    throw new Error('Worker: 未找到图像缓存');
                }
                const safeScale = typeof scale === 'number' ? scale : 1;
                const blurAmount = typeof effectiveBlur === 'number' ? effectiveBlur : 0;
                const preprocessKey = buildPreprocessKey(safeScale, blurAmount, crop);
                const cachedData = getCachedPreprocess(imageId, preprocessKey);
                const imageData = cachedData || buildImageDataFromBitmap(entry, safeScale, blurAmount, crop);
                if (!cachedData) {
                    setCachedPreprocess(imageId, preprocessKey, imageData);
                }
                const rgbaFromBitmap = new Uint8Array(imageData.data.buffer);
                svgString = wasm.trace_rgba_to_svg(
                    rgbaFromBitmap,
                    imageData.width,
                    imageData.height,
                    colorCount,
                    pathPrecision,
                    cornerThreshold,
                    filterSpeckle,
                    colorMode
                );
            } else if (buffer) {
                // 回退到 PNG 模式（兼容旧调用）
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

            // Parse SVG
            const usePaletteMapping = params.usePaletteMapping === true;
            const targetPalette = usePaletteMapping && params.palette && params.palette.length > 0
                ? params.palette
                : undefined;
            const result = parseSvg(svgString, scale, params.ignoreWhite, params.smartBackground, bgColorHex || '#ffffff', colorCount, targetPalette);

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
    const fillRegex = /fill="([^"]*)"/;
    const dRegex = /d="([^"]*)"/;
    const transformRegex = /transform="translate\(([^,]+),([^)]+)\)"/;
    let pathMatch;
    let pathId = 0;

    const bgColorHexLower = bgColorHex.toLowerCase();

    const isWhiteOrBg = (hex: string) => {
        if (!ignoreWhite) return false;
        const lower = hex.toLowerCase();
        if (lower === '#ffffff') return true;
        if (smartBackground && lower === bgColorHexLower) return true;
        return false;
    };

    // Helper for color distance
    const hexToRgb = (hex: string) => {
        // Handle undefined/null
        if (!hex) return null;

        let c = hex.trim();
        if (c.startsWith('#')) c = c.slice(1);

        // Handle #RGB shorthand
        if (c.length === 3) {
            c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        }

        // Allow valid RRGGBB
        if (c.length !== 6) return null;

        const r = parseInt(c.slice(0, 2), 16);
        const g = parseInt(c.slice(2, 4), 16);
        const b = parseInt(c.slice(4, 6), 16);

        if (isNaN(r) || isNaN(g) || isNaN(b)) return null;

        return { r, g, b };
    };

    const rgbCache = new Map<string, { r: number, g: number, b: number } | null>();
    const getRgb = (hex: string) => {
        const key = hex.toLowerCase();
        if (rgbCache.has(key)) return rgbCache.get(key) as { r: number, g: number, b: number } | null;
        const rgb = hexToRgb(hex);
        rgbCache.set(key, rgb);
        return rgb;
    };

    const getDist = (c1: { r: number, g: number, b: number }, c2: { r: number, g: number, b: number }) => {
        return (c1.r - c2.r) ** 2 + (c1.g - c2.g) ** 2 + (c1.b - c2.b) ** 2;
    };

    // Pre-calculate target RGBs if palette provided
    // Filter out invalid RGBs
    const targetRgbPalette = targetPalette
        ? targetPalette.map(hex => ({ hex, rgb: getRgb(hex) })).filter(item => item.rgb !== null) as { hex: string, rgb: { r: number, g: number, b: number } }[]
        : null;
    const nearestPaletteCache = targetRgbPalette ? new Map<string, string>() : null;

    if (targetRgbPalette) {
        console.log(`[Worker] Smart Filter Active. Target Palette Size: ${targetRgbPalette.length} (Requested: ${maxColors})`);
    } else {
        console.log(`[Worker] Standard Mode (No Target Palette)`);
    }

    while ((pathMatch = pathTagRegex.exec(svgString)) !== null) {
        const attrs = pathMatch[1];
        const fillMatch = fillRegex.exec(attrs);
        const dMatch = dRegex.exec(attrs);
        const transformMatch = transformRegex.exec(attrs);

        if (fillMatch && dMatch) {
            let fill = fillMatch[1];
            const d = dMatch[1];

            if (isWhiteOrBg(fill)) continue;

            // --- STRICT PALETTE REMAPPING (SMART FILTER) ---
            // If targetPalette is provided, we remap EVERY PATH immediately to the nearest target color.
            // This prevents "accumulation of noise" before counting.
            if (targetRgbPalette) {
                const cacheKey = fill.toLowerCase();
                if (nearestPaletteCache!.has(cacheKey)) {
                    fill = nearestPaletteCache!.get(cacheKey) as string;
                } else {
                    const srcRgb = getRgb(fill);
                    let nearestHex = fill;

                    if (srcRgb) {
                        let minDist = Infinity;
                        nearestHex = targetRgbPalette[0].hex;
                        for (const target of targetRgbPalette) {
                            const dist = getDist(srcRgb, target.rgb);
                            if (dist < minDist) {
                                minDist = dist;
                                nearestHex = target.hex;
                            }
                        }
                    }

                    nearestPaletteCache!.set(cacheKey, nearestHex);
                    fill = nearestHex;
                }
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

    // --- FALLBACK: Heuristic Quantization ---
    // Only run this if we didn't use a strict palette, OR if somehow our remapping
    // still resulted in too many colors (unlikely given palette size is enforced by caller).
    // But good as a safety net.
    if (!targetRgbPalette && colorCounts.size > maxColors) {
        // 1. Sort colors by frequency (keep top N)
        const sortedColors = Array.from(colorCounts.entries()).sort((a, b) => b[1] - a[1]);
        const keepColors = new Set(sortedColors.slice(0, maxColors).map(c => c[0]));

        // 2. Build Map for remapping
        const colorMap = new Map<string, string>();

        // Pre-calculate RGB for target palette
        const targetPaletteLocal = Array.from(keepColors)
            .map(hex => ({ hex, rgb: getRgb(hex) }))
            .filter(item => item.rgb !== null) as { hex: string, rgb: { r: number, g: number, b: number } }[];

        // Map every existing color to nearest target
        for (const [hex] of colorCounts) {
            if (keepColors.has(hex)) {
                colorMap.set(hex, hex);
                continue;
            }
            const srcRgb = getRgb(hex);
            if (!srcRgb || targetPaletteLocal.length === 0) {
                colorMap.set(hex, hex);
                continue;
            }
            let minDist = Infinity;
            let nearestHex = targetPaletteLocal[0].hex;
            for (const target of targetPaletteLocal) {
                const d = getDist(srcRgb, target.rgb);
                if (d < minDist) { minDist = d; nearestHex = target.hex; }
            }
            colorMap.set(hex, nearestHex);
        }

        // 3. Update Paths & Re-count
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
        const r = parseInt(hex.slice(1, 3), 16) || 0;
        const g = parseInt(hex.slice(3, 5), 16) || 0;
        const b = parseInt(hex.slice(5, 7), 16) || 0;
        palette.push({ hex, r, g, b, count, ratio: count / (paths.length || 1) });
    }
    palette.sort((a, b) => b.count - a.count);

    return { paths, svgString, palette };
}
