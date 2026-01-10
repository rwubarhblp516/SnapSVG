import { TracerParams, VectorPath, PaletteItem, TracerResult } from '../types';

// Define the worker interface types locally or import if possible
// Since importing types in a worker can be tricky depending on build, 
// we'll try to keep imports minimal or just redefine interfaces if needed.
// But usually Vite supports it.

// Global WASM State in Worker
let wasmInstance: any = null;

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

        wasmInstance = module;
        return wasmInstance;
    } catch (e) {
        console.error("Worker: Failed to load WASM", e);
        throw e;
    }
};

self.onmessage = async (e: MessageEvent) => {
    const { id, type, buffer, params, scale, bgColorHex } = e.data;

    if (type === 'trace') {
        try {
            const wasm = await loadWasmInWorker();

            const colorCount = Math.max(2, Math.min(64, params.colors));
            const pathPrecision = Math.max(1, Math.round((params.paths / 100) * 8));
            const cornerThreshold = Math.round((params.corners / 100) * 180);
            const filterSpeckle = Math.round(params.noise);
            const colorMode = params.colorMode === 'binary' ? 'binary' : 'color';

            // Run WASM
            const svgString = wasm.trace_image_to_svg(
                buffer,
                colorCount,
                pathPrecision,
                cornerThreshold,
                filterSpeckle,
                colorMode
            );

            // Parse SVG (Heavy CPU task, now safely in worker)
            // Pass the bgColorHex received from main thread
            const result = parseSvg(svgString, scale, params.ignoreWhite, params.smartBackground, bgColorHex || '#ffffff');
            // Wait, for BG detection `ignoreWhite`, we need pixel data.
            // The buffer passed is PNG bytes. We can't easily read pixels from PNG bytes in Worker (no Canvas).
            // Solution: Main thread should pass the `bgColorHex` or `isWhiteOrBg` decision logic?
            // Or better: The main thread should pass the "Detected Background Color" if it extracted it.
            // Or we just stick to "Ignore Pure White" and maybe user-provided hint?
            // In the previous `mockVTracer`, we used: 
            // `cachedImageData.data[0]` to guess background.
            // We should pass this `bgColor` from main thread to worker.

            self.postMessage({ id, type: 'success', result });

        } catch (error) {
            console.error("Worker Error:", error);
            self.postMessage({ id, type: 'error', error: String(error) });
        }
    }
};

function parseSvg(svgString: string, scale: number, ignoreWhite: boolean, smartBackground: boolean, bgColorHex: string): TracerResult {
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

    while ((pathMatch = pathTagRegex.exec(svgString)) !== null) {
        const attrs = pathMatch[1];
        const fillMatch = attrs.match(/fill="([^"]*)"/);
        const dMatch = attrs.match(/d="([^"]*)"/);
        const transformMatch = attrs.match(/transform="translate\(([^,]+),([^)]+)\)"/);

        if (fillMatch && dMatch) {
            const fill = fillMatch[1];
            const d = dMatch[1];

            if (isWhiteOrBg(fill)) continue;

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
                scale: 1 / scale
            });
            colorCounts.set(fill, (colorCounts.get(fill) || 0) + 1);
        }
    }

    const palette: PaletteItem[] = [];
    for (const [hex, count] of colorCounts.entries()) {
        const r = parseInt(hex.slice(1, 3), 16) || 0;
        const g = parseInt(hex.slice(3, 5), 16) || 0;
        const b = parseInt(hex.slice(5, 7), 16) || 0;
        palette.push({ hex, r, g, b, count, ratio: count / colorCounts.size });
    }
    palette.sort((a, b) => b.count - a.count);

    return { paths, svgString, palette };
}
