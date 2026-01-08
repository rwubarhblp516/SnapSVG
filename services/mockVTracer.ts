import { TracerParams, VectorPath } from '../types';

/**
 * ADVANCED VECTOR TRACER v9.0 (Smart Upscale & Sharpen)
 * 
 * Features:
 * ...
 * 8. Internal Upscaling with Unsharp Masking (Sharpening)
 */

interface Point { x: number; y: number; }
interface Rgba { r: number; g: number; b: number; a: number; }

// --- Helpers ---

const rgbToHex = (r: number, g: number, b: number) => {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};

const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

const getPixelDiff = (c1: Rgba, c2: Rgba) => {
    return Math.pow(c1.r - c2.r, 2) + Math.pow(c1.g - c2.g, 2) + Math.pow(c1.b - c2.b, 2);
};

const isNearWhite = (c: Rgba) => {
    return c.r > 250 && c.g > 250 && c.b > 250;
};

// --- Seeded PRNG for Deterministic Results ---
class SeededRandom {
    private seed: number;
    constructor(seed: number) {
        this.seed = seed;
    }
    next(): number {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }
}

// --- Image Scaling Helper ---
const scaleImageData = (imageData: ImageData, scale: number): ImageData => {
    if (scale <= 1) return imageData;

    const { width, height } = imageData;
    const newWidth = Math.floor(width * scale);
    const newHeight = Math.floor(height * scale);
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return imageData;
    
    ctx.putImageData(imageData, 0, 0);
    
    const scaledCanvas = document.createElement('canvas');
    scaledCanvas.width = newWidth;
    scaledCanvas.height = newHeight;
    const scaledCtx = scaledCanvas.getContext('2d');
    if (!scaledCtx) return imageData;
    
    // Use high quality image smoothing (Browser optimized Bi-cubic)
    scaledCtx.imageSmoothingEnabled = true;
    scaledCtx.imageSmoothingQuality = 'high';
    scaledCtx.drawImage(canvas, 0, 0, newWidth, newHeight);
    
    return scaledCtx.getImageData(0, 0, newWidth, newHeight);
};

// --- Sharpening Filter (Convolution) ---
// Mimics "High Res Fix" clarity by enhancing edges before vectorization
const applySharpen = async (data: Uint8ClampedArray, width: number, height: number, amount: number): Promise<Uint8ClampedArray> => {
    if (amount <= 0) return data;

    const w = width;
    const h = height;
    const output = new Uint8ClampedArray(data);
    
    // Simple 3x3 Sharpen Kernel
    // [ 0 -1  0 ]
    // [-1  5 -1 ]  <-- Center weight varies based on 'amount'
    // [ 0 -1  0 ]
    
    // Adjust kernel based on amount (0.0 to 1.0)
    // A standard sharpen kernel has a center of 5 and neighbors of -1 (Sum = 1)
    // We blend original pixel with sharpened pixel
    const mix = amount; 

    for (let y = 1; y < h - 1; y++) {
        if (y % 200 === 0) await yieldToMain(); // Yield for UI responsiveness
        
        const yOffset = y * w;
        const yUpOffset = (y - 1) * w;
        const yDownOffset = (y + 1) * w;

        for (let x = 1; x < w - 1; x++) {
            const idx = (yOffset + x) * 4;

            // Neighbors
            const up = (yUpOffset + x) * 4;
            const down = (yDownOffset + x) * 4;
            const left = (yOffset + (x - 1)) * 4;
            const right = (yOffset + (x + 1)) * 4;

            for (let c = 0; c < 3; c++) { // R, G, B
                const val = data[idx + c];
                const neighbors = data[up + c] + data[down + c] + data[left + c] + data[right + c];
                
                // Laplacian Sharpening Formula: 5*Center - Neighbors
                let sharpened = (5 * val) - neighbors;
                
                // Clamp
                sharpened = Math.min(255, Math.max(0, sharpened));
                
                // Blend back with original to control strength
                output[idx + c] = val * (1 - mix) + sharpened * mix;
            }
            // Alpha remains unchanged
            output[idx + 3] = data[idx + 3];
        }
    }
    return output;
};

// --- Optimized Blur (Separable) ---

const applyBlur = async (data: Uint8ClampedArray, width: number, height: number, radius: number): Promise<Uint8ClampedArray> => {
    if (radius <= 0) return new Uint8ClampedArray(data); 
    
    const temp = new Uint8ClampedArray(data.length);
    const target = new Uint8ClampedArray(data.length);

    // Pass 1: Horizontal
    for (let y = 0; y < height; y++) {
        if (y % 100 === 0) await yieldToMain();
        const yOffset = y * width;
        for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0;
            let count = 0;
            const xMin = Math.max(0, x - radius);
            const xMax = Math.min(width - 1, x + radius);
            for (let k = xMin; k <= xMax; k++) {
                const idx = (yOffset + k) * 4;
                r += data[idx];
                g += data[idx + 1];
                b += data[idx + 2];
                count++;
            }
            const outIdx = (yOffset + x) * 4;
            temp[outIdx] = r / count;
            temp[outIdx + 1] = g / count;
            temp[outIdx + 2] = b / count;
            temp[outIdx + 3] = data[outIdx + 3];
        }
    }

    // Pass 2: Vertical
    for (let x = 0; x < width; x++) {
        if (x % 100 === 0) await yieldToMain();
        for (let y = 0; y < height; y++) {
            let r = 0, g = 0, b = 0;
            let count = 0;
            const yMin = Math.max(0, y - radius);
            const yMax = Math.min(height - 1, y + radius);
            for (let k = yMin; k <= yMax; k++) {
                const idx = (k * width + x) * 4;
                r += temp[idx];
                g += temp[idx + 1];
                b += temp[idx + 2];
                count++;
            }
            const outIdx = (y * width + x) * 4;
            target[outIdx] = r / count;
            target[outIdx + 1] = g / count;
            target[outIdx + 2] = b / count;
            target[outIdx + 3] = temp[outIdx + 3];
        }
    }
    return target;
};

// --- Color Estimation ---
export const estimateColors = (data: Uint8ClampedArray, pixelCount: number): number => {
    const sampleSize = 5000;
    const step = Math.max(1, Math.floor(pixelCount / sampleSize));
    const colorCounts = new Map<string, number>();
    let validSamples = 0;
    const QUANTIZE = 16; 

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
    const threshold = validSamples * 0.005; 
    let distinctColors = 0;
    for (const count of colorCounts.values()) {
        if (count > threshold) distinctColors++;
    }
    return Math.max(4, Math.min(distinctColors, 64)); 
};

// --- Denoise ---
const denoiseLabels = (labels: Uint8Array, width: number, height: number, strength: number): Uint8Array => {
    if (strength === 0) return labels; 
    const newLabels = new Uint8Array(labels);
    const neighborThreshold = strength > 50 ? 5 : 6; 

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = y * width + x;
            const center = labels[i];
            const i_u = i - width;
            const i_d = i + width;
            const neighbors = [
                labels[i_u - 1], labels[i_u], labels[i_u + 1],
                labels[i - 1],               labels[i + 1],
                labels[i_d - 1], labels[i_d], labels[i_d + 1]
            ];
            const counts: Record<number, number> = {};
            counts[center] = 1; 
            let maxCount = 0;
            let maxLabel = center;
            for(let n=0; n<8; n++) {
                const val = neighbors[n];
                const c = (counts[val] || 0) + 1;
                counts[val] = c;
                if (c > maxCount) {
                    maxCount = c;
                    maxLabel = val;
                }
            }
            if (maxLabel !== center && maxCount >= neighborThreshold) {
                newLabels[i] = maxLabel;
            }
        }
    }
    return newLabels;
};

// --- K-Means ---
const runKMeans = async (data: Uint8ClampedArray, pixelCount: number, k: number): Promise<Uint8Array> => {
    const rng = new SeededRandom(12345);

    const sampleSize = 4000;
    const step = Math.max(1, Math.floor(pixelCount / sampleSize));
    const samples: Rgba[] = [];
    
    for (let i = 0; i < pixelCount; i += step) {
        const idx = i * 4;
        if (data[idx + 3] >= 128) {
            samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2], a: 255 });
        }
    }
    
    const safeK = Math.min(k, samples.length);
    if (safeK === 0) {
        // @ts-ignore
        const empty = new Uint8Array(pixelCount);
        // @ts-ignore
        empty.centroids = [];
        return empty;
    }

    const centroids: Rgba[] = [];
    if (samples.length > 0) {
         centroids.push({ ...samples[Math.floor(rng.next() * samples.length)] });
         for(let i=1; i<safeK; i++) {
             let maxDist = -1;
             let bestCand = samples[0];
             for(let candI=0; candI<10; candI++) {
                 const candidate = samples[Math.floor(rng.next() * samples.length)];
                 let distToClosest = Infinity;
                 for(let c of centroids) {
                     const d = getPixelDiff(candidate, c);
                     if(d < distToClosest) distToClosest = d;
                 }
                 if(distToClosest > maxDist) {
                     maxDist = distToClosest;
                     bestCand = candidate;
                 }
             }
             centroids.push({ ...bestCand });
         }
    }

    const iterations = 8;
    for (let iter = 0; iter < iterations; iter++) {
        const sums = new Array(safeK).fill(0).map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
        for (let i = 0; i < samples.length; i++) {
            const p = samples[i];
            let minDist = Infinity;
            let label = 0;
            for (let j = 0; j < safeK; j++) {
                const dist = getPixelDiff(p, centroids[j]);
                if (dist < minDist) { minDist = dist; label = j; }
            }
            sums[label].r += p.r;
            sums[label].g += p.g;
            sums[label].b += p.b;
            sums[label].count++;
        }
        let changed = false;
        for (let j = 0; j < safeK; j++) {
            if (sums[j].count > 0) {
                const newR = Math.floor(sums[j].r / sums[j].count);
                const newG = Math.floor(sums[j].g / sums[j].count);
                const newB = Math.floor(sums[j].b / sums[j].count);
                if (Math.abs(newR - centroids[j].r) > 1 || Math.abs(newG - centroids[j].g) > 1 || Math.abs(newB - centroids[j].b) > 1) {
                   centroids[j] = { r: newR, g: newG, b: newB, a: 255 };
                   changed = true;
                }
            }
        }
        if (!changed) break;
    }
    await yieldToMain();

    const labels = new Uint8Array(pixelCount); 
    const chunkSize = 40000;
    for (let i = 0; i < pixelCount; i += chunkSize) {
        const end = Math.min(i + chunkSize, pixelCount);
        for (let j = i; j < end; j++) {
            const idx = j * 4;
            if (data[idx + 3] < 128) { labels[j] = 255; continue; }
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            let minDist = Infinity;
            let label = 0;
            for (let c = 0; c < safeK; c++) {
                const cent = centroids[c];
                const dist = (r - cent.r)*(r - cent.r) + (g - cent.g)*(g - cent.g) + (b - cent.b)*(b - cent.b);
                if (dist < minDist) { minDist = dist; label = c; }
            }
            labels[j] = label;
        }
        if (i % (chunkSize * 5) === 0) await yieldToMain();
    }
    // @ts-ignore
    labels.centroids = centroids;
    return labels;
};

// --- Smart Background Flood Fill ---
const markBackground = (labels: Uint8Array, width: number, height: number, whiteLabelIds: number[]): void => {
    const queue: number[] = [];
    const visited = new Uint8Array(width * height); 
    const SKIP_LABEL = 255;
    const whiteSet = new Set(whiteLabelIds);

    for (let x = 0; x < width; x++) {
        queue.push(x); 
        queue.push((height - 1) * width + x); 
    }
    for (let y = 1; y < height - 1; y++) {
        queue.push(y * width); 
        queue.push(y * width + (width - 1)); 
    }

    let head = 0;
    while(head < queue.length) {
        const idx = queue[head++];
        if (visited[idx]) continue;
        visited[idx] = 1;

        const label = labels[idx];

        if (whiteSet.has(label)) {
            labels[idx] = SKIP_LABEL;
            const x = idx % width;
            const y = Math.floor(idx / width);
            if (x > 0) queue.push(idx - 1);
            if (x < width - 1) queue.push(idx + 1);
            if (y > 0) queue.push(idx - width);
            if (y < height - 1) queue.push(idx + width);
        }
    }
};

// --- Marching Squares ---
const MS_LOOKUP = [
    [], [[0, 0.5], [0.5, 1]], [[0.5, 1], [1, 0.5]], [[0, 0.5], [1, 0.5]],
    [[0.5, 0], [1, 0.5]], [[0, 0.5], [0.5, 0], [1, 0.5], [0.5, 1]], [[0.5, 0], [0.5, 1]], [[0, 0.5], [0.5, 0]],
    [[0, 0.5], [0.5, 0]], [[0.5, 0], [0.5, 1]], [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]], [[0.5, 0], [1, 0.5]],
    [[0, 0.5], [1, 0.5]], [[1, 0.5], [0.5, 1]], [[0, 0.5], [0.5, 1]], []
];

const calculatePolygonArea = (points: Point[]): number => {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
};

const traceLayer = (labels: Uint8Array, width: number, height: number, targetLabel: number, noiseThreshold: number): Point[][] => {
    const w = width + 2;
    const h = height + 2;
    const grid = new Uint8Array(w * h);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (labels[y * width + x] === targetLabel) {
                grid[(y + 1) * w + (x + 1)] = 1;
            }
        }
    }

    const adj = new Map<string, Point[]>();
    const addEdge = (p1: Point, p2: Point) => {
        const k1 = `${p1.x},${p1.y}`;
        const k2 = `${p2.x},${p2.y}`;
        let n1 = adj.get(k1); if(!n1) { n1 = []; adj.set(k1, n1); } n1.push(p2);
        let n2 = adj.get(k2); if(!n2) { n2 = []; adj.set(k2, n2); } n2.push(p1);
    };

    for (let y = 0; y < h - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
            const index = (grid[y * w + x] << 3) | (grid[y * w + (x + 1)] << 2) | (grid[(y + 1) * w + (x + 1)] << 1) | grid[(y + 1) * w + x];
            if (index === 0 || index === 15) continue;
            const lookups = MS_LOOKUP[index];
            for (let i = 0; i < lookups.length; i += 2) {
                const s = lookups[i];
                const e = lookups[i+1];
                addEdge({ x: x + s[0] - 1, y: y + s[1] - 1 }, { x: x + e[0] - 1, y: y + e[1] - 1 });
            }
        }
    }

    const loops: Point[][] = [];
    while (adj.size > 0) {
        const startKey = adj.keys().next().value;
        const neighbors = adj.get(startKey);
        if (!neighbors || neighbors.length === 0) { adj.delete(startKey); continue; }
        const [sx, sy] = startKey.split(',').map(Number);
        const startPt = { x: sx, y: sy };
        const path = [startPt];
        let curr = startPt;
        let currKey = startKey;
        let next = neighbors.shift()!;
        if (neighbors.length === 0) adj.delete(currKey);

        while (true) {
            path.push(next);
            const nextKey = `${next.x},${next.y}`;
            const nextNeighbors = adj.get(nextKey);
            if (nextNeighbors) {
                const backIdx = nextNeighbors.findIndex(p => p.x === curr.x && p.y === curr.y);
                if (backIdx !== -1) {
                    nextNeighbors.splice(backIdx, 1);
                    if (nextNeighbors.length === 0) adj.delete(nextKey);
                }
            }
            if (next.x === sx && next.y === sy) break;
            curr = next;
            currKey = nextKey;
            const steps = adj.get(currKey);
            if (!steps || steps.length === 0) { adj.delete(currKey); break; }
            next = steps.shift()!;
            if (steps.length === 0) adj.delete(currKey);
        }
        if (path.length > 2) {
             const area = calculatePolygonArea(path);
             if (area > noiseThreshold) loops.push(path);
        }
    }
    return loops;
};

// --- Geometry Smoothing ---
const smoothPath = (points: Point[], pathsParam: number, cornersParam: number, scaleFactor: number): string => {
    if (points.length < 3) return "";
    
    // Normalize Epsilon by Scale Factor
    // Higher resolution needs slightly larger epsilon to ignore pixel steps
    const epsilon = Math.max(0.05, 5.0 * (1 - pathsParam / 100));
    
    const sqDist = (p: Point, a: Point, b: Point) => {
        let x = a.x, y = a.y;
        const dx = b.x - x, dy = b.y - y;
        if (dx !== 0 || dy !== 0) {
            const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
            if (t > 1) { x = b.x; y = b.y; }
            else if (t > 0) { x += dx * t; y += dy * t; }
        }
        const dx2 = p.x - x, dy2 = p.y - y;
        return dx2 * dx2 + dy2 * dy2;
    };

    const simplifyDP = (pts: Point[], eps: number): Point[] => {
        if (pts.length <= 2) return pts;
        let maxSqDist = 0;
        let index = 0;
        const end = pts.length - 1;
        for (let i = 1; i < end; i++) {
            const d = sqDist(pts[i], pts[0], pts[end]);
            if (d > maxSqDist) { index = i; maxSqDist = d; }
        }
        if (maxSqDist > eps * eps) {
            const left = simplifyDP(pts.slice(0, index + 1), eps);
            const right = simplifyDP(pts.slice(index), eps);
            return left.slice(0, left.length - 1).concat(right);
        }
        return [pts[0], pts[end]];
    };

    const simplified = simplifyDP(points, epsilon);
    if (simplified.length < 3) return "";

    const cornerThresholdRad = (1.0 - cornersParam/100) * 2.5 + 0.2; 
    const forceLinear = cornersParam > 60 || pathsParam > 85; // Slightly stricter on high paths

    const coord = (val: number) => {
        // Normalize coordinates back to original scale
        return Number((val / scaleFactor).toFixed(2));
    }

    if (forceLinear) {
        let d = `M ${coord(simplified[0].x)} ${coord(simplified[0].y)}`;
        for (let i = 1; i < simplified.length; i++) {
            d += ` L ${coord(simplified[i].x)} ${coord(simplified[i].y)}`;
        }
        d += " Z";
        return d;
    }

    let d = `M ${coord(simplified[0].x)} ${coord(simplified[0].y)}`;
    for (let i = 0; i < simplified.length; i++) {
        const p0 = simplified[(i - 1 + simplified.length) % simplified.length];
        const p1 = simplified[i];
        const p2 = simplified[(i + 1) % simplified.length];

        const v1x = p0.x - p1.x; const v1y = p0.y - p1.y;
        const v2x = p2.x - p1.x; const v2y = p2.y - p1.y;
        const l1 = Math.sqrt(v1x*v1x + v1y*v1y);
        const l2 = Math.sqrt(v2x*v2x + v2y*v2y);
        const dot = v1x*v2x + v1y*v2y;
        let angle = Math.acos(Math.max(-1, Math.min(1, dot / (l1 * l2))));
        if (isNaN(angle)) angle = Math.PI;

        const deviation = Math.abs(Math.PI - angle);
        const isCorner = deviation > cornerThresholdRad;

        if (isCorner) {
            d += ` L ${coord(p1.x)} ${coord(p1.y)}`;
        } else {
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            if (i === 0) d = `M ${coord((p0.x + p1.x) / 2)} ${coord((p0.y + p1.y) / 2)}`;
            d += ` Q ${coord(p1.x)} ${coord(p1.y)} ${coord(midX)} ${coord(midY)}`;
        }
    }
    d += " Z";
    return d;
}

// --- Main Trace ---
export const traceImage = async (originalImageData: ImageData, params: TracerParams): Promise<{ paths: VectorPath[], svgString: string }> => {
    await yieldToMain();
    
    // 1. Super Sampling (Upscale)
    const samplingScale = params.sampling || 1;
    let imageData = scaleImageData(originalImageData, samplingScale);
    
    // 2. Smart Sharpen (New Step)
    // Only apply if upscaled, to combat blur. 
    // 2x -> 0.4 strength, 4x -> 0.7 strength
    if (samplingScale > 1) {
        const sharpenStrength = samplingScale === 2 ? 0.4 : 0.7;
        // Process sharpening BEFORE simple blur, to define edges first
        const sharpenedData = await applySharpen(imageData.data, imageData.width, imageData.height, sharpenStrength);
        imageData = new ImageData(sharpenedData, imageData.width, imageData.height);
    }
    
    const { width, height, data } = imageData;
    const paths: VectorPath[] = [];

    // 3. Pre-process Blur (Optional, user controlled)
    const blurRadius = (params.blur || 0) * samplingScale;
    const processedData = await applyBlur(data, width, height, blurRadius);

    // 4. Clustering
    const k = Math.max(2, params.colors);
    let labels = await runKMeans(processedData, width * height, k);
    // @ts-ignore
    const centroids = labels.centroids as Rgba[];

    await yieldToMain();
    const scaledNoise = params.noise * (samplingScale * samplingScale);
    labels = denoiseLabels(labels, width, height, params.noise);

    // --- Background Removal Logic ---
    const whiteLabelIds: number[] = [];
    centroids.forEach((c, idx) => {
        if (isNearWhite(c)) whiteLabelIds.push(idx);
    });

    if (params.ignoreWhite && whiteLabelIds.length > 0) {
        if (params.smartBackground) {
            markBackground(labels, width, height, whiteLabelIds);
        } else {
            for(let i=0; i<labels.length; i++) {
                if (whiteLabelIds.includes(labels[i])) labels[i] = 255;
            }
        }
    }

    const layersToTrace = centroids.map((c, i) => ({ id: i, color: c }));
    
    let processedCount = 0;
    for (const layer of layersToTrace) {
        if (processedCount % 1 === 0) await yieldToMain();
        processedCount++;

        const loops = traceLayer(labels, width, height, layer.id, scaledNoise);
        const hexColor = rgbToHex(layer.color.r, layer.color.g, layer.color.b);
        
        loops.forEach((loop, idx) => {
             const pathData = smoothPath(loop, params.paths, params.corners, samplingScale);
             if (pathData) {
                 paths.push({
                     id: `shape-${layer.id}-${idx}`,
                     d: pathData,
                     fill: hexColor,
                     stroke: hexColor, 
                     strokeWidth: 0.25, 
                     x: 0,
                     y: 0
                 });
             }
        });
    }

    const svgString = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${originalImageData.width} ${originalImageData.height}">
        ${paths.map(p => `<path d="${p.d}" fill="${p.fill}" stroke="${p.fill}" stroke-width="0.25" stroke-linejoin="round" />`).join('\n')}
      </svg>
    `;

    return { paths, svgString };
};