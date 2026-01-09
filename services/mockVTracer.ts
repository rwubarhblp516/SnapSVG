import { TracerParams, VectorPath } from '../types';

/**
 * ADVANCED VECTOR TRACER v11.2 (Subdivision & High-Density Smoothing)
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

// Check if color is close to target background color
const isBackgroundPixel = (c: Rgba, target: Rgba | undefined) => {
    if (!target) return c.r > 245 && c.g > 245 && c.b > 245; // Default white
    // Euclidean distance threshold approx 20-30
    const dist = Math.sqrt(Math.pow(c.r - target.r, 2) + Math.pow(c.g - target.g, 2) + Math.pow(c.b - target.b, 2));
    return dist < 30; 
};

// Detect dominant color on image perimeter
const detectDominantColor = (data: Uint8ClampedArray, width: number, height: number): Rgba => {
    const counts = new Map<string, number>();
    const check = (i: number) => {
        if (i < 0 || i >= data.length) return;
        const r = data[i], g = data[i+1], b = data[i+2];
        const key = `${r},${g},${b}`;
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    
    // Sample perimeter with step to save time
    const step = 2;
    // Top/Bottom
    for(let x=0; x<width; x+=step) {
        check(x * 4);
        check(((height-1)*width + x) * 4);
    }
    // Left/Right
    for(let y=1; y<height-1; y+=step) {
        check((y*width)*4);
        check((y*width + width-1)*4);
    }

    let max = 0, maxKey = "255,255,255";
    for(const [k, v] of counts) {
        if(v > max) { max = v; maxKey = k; }
    }
    const [r,g,b] = maxKey.split(',').map(Number);
    return { r, g, b, a: 255 };
};

// --- Seeded PRNG ---
class SeededRandom {
    private seed: number;
    constructor(seed: number) { this.seed = seed; }
    next(): number {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }
}

// --- Image Scaling ---
const scaleImageData = (imageData: ImageData, scale: number): ImageData => {
    if (scale === 1) return imageData;
    const { width, height } = imageData;
    const newWidth = Math.floor(width * scale);
    const newHeight = Math.floor(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return imageData;
    ctx.putImageData(imageData, 0, 0);
    const scaledCanvas = document.createElement('canvas');
    scaledCanvas.width = newWidth; scaledCanvas.height = newHeight;
    const scaledCtx = scaledCanvas.getContext('2d');
    if (!scaledCtx) return imageData;
    scaledCtx.imageSmoothingEnabled = true;
    scaledCtx.imageSmoothingQuality = 'high';
    scaledCtx.drawImage(canvas, 0, 0, newWidth, newHeight);
    return scaledCtx.getImageData(0, 0, newWidth, newHeight);
};

// --- Filters: Sharpen ---
const applySharpen = async (data: Uint8ClampedArray, width: number, height: number, amount: number): Promise<Uint8ClampedArray> => {
    if (amount <= 0) return data;
    const output = new Uint8ClampedArray(data);
    const mix = amount; 
    for (let y = 1; y < height - 1; y++) {
        if (y % 200 === 0) await yieldToMain();
        const yOffset = y * width;
        const yUp = (y - 1) * width;
        const yDown = (y + 1) * width;
        for (let x = 1; x < width - 1; x++) {
            const idx = (yOffset + x) * 4;
            const up = (yUp + x) * 4;
            const down = (yDown + x) * 4;
            const left = (yOffset + (x - 1)) * 4;
            const right = (yOffset + (x + 1)) * 4;
            for (let c = 0; c < 3; c++) { 
                const val = data[idx + c];
                const neighbors = data[up + c] + data[down + c] + data[left + c] + data[right + c];
                let sharpened = (5 * val) - neighbors;
                sharpened = Math.min(255, Math.max(0, sharpened));
                output[idx + c] = val * (1 - mix) + sharpened * mix;
            }
            output[idx + 3] = data[idx + 3];
        }
    }
    return output;
};

// --- Filters: Blur ---
const applyBlur = async (data: Uint8ClampedArray, width: number, height: number, radius: number): Promise<Uint8ClampedArray> => {
    if (radius <= 0) return new Uint8ClampedArray(data); 
    const temp = new Uint8ClampedArray(data.length);
    const target = new Uint8ClampedArray(data.length);
    // Horizontal
    for (let y = 0; y < height; y++) {
        if (y % 100 === 0) await yieldToMain();
        const yOffset = y * width;
        for (let x = 0; x < width; x++) {
            let r=0, g=0, b=0, count=0;
            const xMin = Math.max(0, x - radius);
            const xMax = Math.min(width - 1, x + radius);
            for (let k = xMin; k <= xMax; k++) {
                const idx = (yOffset + k) * 4;
                r += data[idx]; g += data[idx+1]; b += data[idx+2]; count++;
            }
            const outIdx = (yOffset + x) * 4;
            temp[outIdx] = r/count; temp[outIdx+1] = g/count; temp[outIdx+2] = b/count; temp[outIdx+3] = data[outIdx+3];
        }
    }
    // Vertical
    for (let x = 0; x < width; x++) {
        if (x % 100 === 0) await yieldToMain();
        for (let y = 0; y < height; y++) {
            let r=0, g=0, b=0, count=0;
            const yMin = Math.max(0, y - radius);
            const yMax = Math.min(height - 1, y + radius);
            for (let k = yMin; k <= yMax; k++) {
                const idx = (k * width + x) * 4;
                r += temp[idx]; g += temp[idx+1]; b += temp[idx+2]; count++;
            }
            const outIdx = (y * width + x) * 4;
            target[outIdx] = r/count; target[outIdx+1] = g/count; target[outIdx+2] = b/count; target[outIdx+3] = temp[outIdx+3];
        }
    }
    return target;
};

// --- Color Modes ---
const applyColorMode = async (data: Uint8ClampedArray, width: number, height: number, mode: 'grayscale' | 'binary'): Promise<Uint8ClampedArray> => {
    const output = new Uint8ClampedArray(data);
    const len = width * height;
    
    // Binary Threshold Calculation
    let threshold = 128;
    if (mode === 'binary') {
        let sum = 0;
        let count = 0;
        for (let i = 0; i < len; i += 10) { 
            const idx = i * 4;
            sum += data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114;
            count++;
        }
        threshold = sum / count;
    }

    for (let i = 0; i < len; i++) {
        if (i % 20000 === 0) await yieldToMain();
        const idx = i * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        if (a < 128) continue;
        const gray = r * 0.299 + g * 0.587 + b * 0.114;

        if (mode === 'grayscale') {
            output[idx] = gray;
            output[idx + 1] = gray;
            output[idx + 2] = gray;
        } else if (mode === 'binary') {
            const val = gray > threshold ? 255 : 0;
            output[idx] = val;
            output[idx + 1] = val;
            output[idx + 2] = val;
        }
    }
    return output;
};

// --- Morphological Anti-Aliasing ---
const applyMajorityFilter = async (labels: Uint8Array, width: number, height: number, iterations: number = 2): Promise<Uint8Array> => {
    let currentLabels = new Uint8Array(labels);
    
    for(let i=0; i<iterations; i++) {
        const nextLabels = new Uint8Array(currentLabels);
        for (let y = 1; y < height - 1; y++) {
            if (y % 200 === 0) await yieldToMain();
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const current = currentLabels[idx];
                const counts: Record<number, number> = {};
                let maxCount = 0;
                let maxLabel = current;
                
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                       const nIdx = (y + dy) * width + (x + dx);
                       const val = currentLabels[nIdx];
                       counts[val] = (counts[val] || 0) + 1;
                       if (counts[val] > maxCount) { maxCount = counts[val]; maxLabel = val; }
                    }
                }
                if (maxLabel !== current && maxCount >= 5) {
                    nextLabels[idx] = maxLabel;
                }
            }
        }
        currentLabels = nextLabels;
    }
    return currentLabels;
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

// --- Denoise ---
const denoiseLabels = (labels: Uint8Array, width: number, height: number, strength: number): Uint8Array => {
    if (strength === 0) return labels; 
    const newLabels = new Uint8Array(labels);
    const neighborThreshold = strength > 50 ? 5 : 6; 
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = y * width + x;
            const center = labels[i];
            const i_u = i - width; const i_d = i + width;
            const neighbors = [labels[i_u - 1], labels[i_u], labels[i_u + 1], labels[i - 1], labels[i + 1], labels[i_d - 1], labels[i_d], labels[i_d + 1]];
            const counts: Record<number, number> = {}; counts[center] = 1; 
            let maxCount = 0; let maxLabel = center;
            for(let n=0; n<8; n++) {
                const val = neighbors[n];
                const c = (counts[val] || 0) + 1; counts[val] = c;
                if (c > maxCount) { maxCount = c; maxLabel = val; }
            }
            if (maxLabel !== center && maxCount >= neighborThreshold) newLabels[i] = maxLabel;
        }
    }
    return newLabels;
};

// --- Background Logic ---
const markBackground = (labels: Uint8Array, width: number, height: number, bgLabelIds: number[]): void => {
    const queue: number[] = [];
    const visited = new Uint8Array(width * height); 
    const SKIP_LABEL = 255;
    const bgSet = new Set(bgLabelIds);

    for (let x = 0; x < width; x++) { queue.push(x); queue.push((height - 1) * width + x); }
    for (let y = 1; y < height - 1; y++) { queue.push(y * width); queue.push(y * width + (width - 1)); }

    let head = 0;
    while(head < queue.length) {
        const idx = queue[head++];
        if (visited[idx]) continue;
        visited[idx] = 1;
        if (bgSet.has(labels[idx])) {
            labels[idx] = SKIP_LABEL;
            const x = idx % width; const y = Math.floor(idx / width);
            if (x > 0) queue.push(idx - 1);
            if (x < width - 1) queue.push(idx + 1);
            if (y > 0) queue.push(idx - width);
            if (y < height - 1) queue.push(idx + width);
        }
    }
};

// --- Marching Squares & Smoothing ---
const MS_LOOKUP = [[], [[0, 0.5], [0.5, 1]], [[0.5, 1], [1, 0.5]], [[0, 0.5], [1, 0.5]],[[0.5, 0], [1, 0.5]], [[0, 0.5], [0.5, 0], [1, 0.5], [0.5, 1]], [[0.5, 0], [0.5, 1]], [[0, 0.5], [0.5, 0]],[[0, 0.5], [0.5, 0]], [[0.5, 0], [0.5, 1]], [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]], [[0.5, 0], [1, 0.5]],[[0, 0.5], [1, 0.5]], [[1, 0.5], [0.5, 1]], [[0, 0.5], [0.5, 1]], []];
const calculatePolygonArea = (points: Point[]): number => {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y; area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
};
const traceLayer = (labels: Uint8Array, width: number, height: number, targetLabel: number, noiseThreshold: number): Point[][] => {
    const w = width + 2; const h = height + 2; const grid = new Uint8Array(w * h);
    for (let y = 0; y < height; y++) { for (let x = 0; x < width; x++) { if (labels[y * width + x] === targetLabel) grid[(y + 1) * w + (x + 1)] = 1; } }
    const adj = new Map<string, Point[]>();
    const addEdge = (p1: Point, p2: Point) => {
        const k1 = `${p1.x},${p1.y}`; const k2 = `${p2.x},${p2.y}`;
        let n1 = adj.get(k1); if(!n1) { n1 = []; adj.set(k1, n1); } n1.push(p2);
        let n2 = adj.get(k2); if(!n2) { n2 = []; adj.set(k2, n2); } n2.push(p1);
    };
    for (let y = 0; y < h - 1; y++) { for (let x = 0; x < w - 1; x++) {
            const index = (grid[y * w + x] << 3) | (grid[y * w + (x + 1)] << 2) | (grid[(y + 1) * w + (x + 1)] << 1) | grid[(y + 1) * w + x];
            if (index === 0 || index === 15) continue;
            const lookups = MS_LOOKUP[index];
            for (let i = 0; i < lookups.length; i += 2) { addEdge({ x: x + lookups[i][0] - 1, y: y + lookups[i][1] - 1 }, { x: x + lookups[i+1][0] - 1, y: y + lookups[i+1][1] - 1 }); }
        }}
    const loops: Point[][] = [];
    while (adj.size > 0) {
        const startKey = adj.keys().next().value; const neighbors = adj.get(startKey);
        if (!neighbors || neighbors.length === 0) { adj.delete(startKey); continue; }
        const [sx, sy] = startKey.split(',').map(Number); const startPt = { x: sx, y: sy }; const path = [startPt];
        let curr = startPt; let currKey = startKey; let next = neighbors.shift()!;
        if (neighbors.length === 0) adj.delete(currKey);
        while (true) {
            path.push(next); const nextKey = `${next.x},${next.y}`; const nextNeighbors = adj.get(nextKey);
            if (nextNeighbors) { const backIdx = nextNeighbors.findIndex(p => p.x === curr.x && p.y === curr.y); if (backIdx !== -1) { nextNeighbors.splice(backIdx, 1); if (nextNeighbors.length === 0) adj.delete(nextKey); } }
            if (next.x === sx && next.y === sy) break;
            curr = next; currKey = nextKey; const steps = adj.get(currKey);
            if (!steps || steps.length === 0) { adj.delete(currKey); break; }
            next = steps.shift()!; if (steps.length === 0) adj.delete(currKey);
        }
        if (path.length > 2) { const area = calculatePolygonArea(path); if (area > noiseThreshold) loops.push(path); }
    }
    return loops;
};

// --- KEY FIX: Iterative Coordinate Smoothing ---
// Physically moves points closer to their neighbors to remove pixel-stair artifacts
const smoothPoints = (points: Point[], iterations: number): Point[] => {
    if (iterations <= 0 || points.length < 3) return points;
    let curr = [...points];
    for(let iter=0; iter<iterations; iter++) {
        const next = [];
        const len = curr.length;
        for(let i=0; i<len; i++) {
            const prevP = curr[(i - 1 + len) % len];
            const currP = curr[i];
            const nextP = curr[(i + 1) % len];
            // Simple box blur on coordinates (Moving Average)
            next.push({
                x: (prevP.x + currP.x + nextP.x) / 3,
                y: (prevP.y + currP.y + nextP.y) / 3
            });
        }
        curr = next;
    }
    return curr;
};

// --- NEW HELPER: Subdivide Points (Increase Density) ---
const subdividePoints = (points: Point[]): Point[] => {
    const newPoints: Point[] = [];
    const len = points.length;
    for (let i = 0; i < len; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % len];
        newPoints.push(p1);
        // Add midpoint
        newPoints.push({
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2
        });
    }
    return newPoints;
};


// UPGRADED SMOOTHING ALGORITHM: Cubic Splines with Corner Detection
const smoothPath = (points: Point[], pathsParam: number, cornersParam: number, scaleFactor: number): string => {
    if (points.length < 3) return "";

    // 1. Pre-simplification (Ramer-Douglas-Peucker)
    // Decreased epsilon to retain more detail initially (was 5.0)
    const baseEpsilon = 2.0 * (1 - pathsParam / 100);
    const epsilon = Math.max(0.1, baseEpsilon);
    
    const sqDist = (p: Point, a: Point, b: Point) => {
        let x = a.x, y = a.y; const dx = b.x - x, dy = b.y - y;
        if (dx !== 0 || dy !== 0) { const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy); if (t > 1) { x = b.x; y = b.y; } else if (t > 0) { x += dx * t; y += dy * t; } }
        return (p.x - x)**2 + (p.y - y)**2;
    };
    const simplifyDP = (pts: Point[], eps: number): Point[] => {
        if (pts.length <= 2) return pts;
        let maxSqDist = 0; let index = 0; const end = pts.length - 1;
        for (let i = 1; i < end; i++) { const d = sqDist(pts[i], pts[0], pts[end]); if (d > maxSqDist) { index = i; maxSqDist = d; } }
        if (maxSqDist > eps * eps) { const left = simplifyDP(pts.slice(0, index + 1), eps); const right = simplifyDP(pts.slice(index), eps); return left.slice(0, left.length - 1).concat(right); }
        return [pts[0], pts[end]];
    };
    
    let simplified = simplifyDP(points, epsilon);
    if (simplified.length < 3) return "";

    // --- NEW STEP: Subdivide (Increase Vertex Count) ---
    // If the path fits loosely, we add more points to allow for smoother curves.
    if (pathsParam < 90) {
        simplified = subdividePoints(simplified);
        // Maybe subdivide again for extra smoothness if desired
        if (pathsParam < 50) {
            simplified = subdividePoints(simplified);
        }
    }

    // --- NEW STEP: Iterative Smoothing to melt pixel stairs ---
    // Increased iterations now that we have more points from subdivision
    const smoothIterations = Math.floor((100 - pathsParam) / 10) + Math.floor((100 - cornersParam) / 20);
    if (smoothIterations > 0) {
        simplified = smoothPoints(simplified, Math.min(5, smoothIterations)); 
    }

    // Helper: Increased precision to 4 decimal places to prevent 3D jitter/offset
    const coord = (val: number) => Number((val / scaleFactor).toFixed(4));

    // Force Linear mode if corners are very high or paths are very strict
    if (cornersParam > 95) {
        let d = `M ${coord(simplified[0].x)} ${coord(simplified[0].y)}`;
        for (let i = 1; i < simplified.length; i++) {
             d += ` L ${coord(simplified[i].x)} ${coord(simplified[i].y)}`; 
        }
        d += " Z"; 
        return d;
    }

    // 2. Identify Corners
    // A point is a corner if the angle is sharp
    const isCorner = new Array(simplified.length).fill(false);
    const cornerThresholdDeg = 180 - (cornersParam * 1.5); // 0->180, 100->30
    const cornerThresholdRad = (cornerThresholdDeg * Math.PI) / 180;

    for(let i=0; i<simplified.length; i++) {
        const prev = simplified[(i - 1 + simplified.length) % simplified.length];
        const curr = simplified[i];
        const next = simplified[(i + 1) % simplified.length];
        
        const a1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
        const a2 = Math.atan2(next.y - curr.y, next.x - curr.x);
        let diff = Math.abs(a1 - a2);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        
        // If the turn is sharper than threshold, it's a corner
        if (Math.PI - diff < cornerThresholdRad) {
            isCorner[i] = true;
        }
    }

    // 3. Generate Cubic Bezier Splines (Catmull-Rom to Bezier)
    let d = `M ${coord(simplified[0].x)} ${coord(simplified[0].y)}`;
    
    // Tension: 0 = loose (Catmull-Rom), 1 = tight (Linear). 
    // High pathsParam -> Higher tension (tighter fit)
    const tension = Math.min(0.8, Math.max(0.2, pathsParam / 150)); 

    for (let i = 0; i < simplified.length; i++) {
        const p0 = simplified[(i - 1 + simplified.length) % simplified.length];
        const p1 = simplified[i];
        const p2 = simplified[(i + 1) % simplified.length];
        const p3 = simplified[(i + 2) % simplified.length];

        // If p1 is a corner, we stop the smooth curve coming into it (treat as line)
        // If p2 is a corner, we stop the smooth curve going out of p1 (treat as line towards p2)
        
        const dist12 = Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2);
        
        // If segment is huge or tiny, or corners involved, use Line
        if (isCorner[i] || isCorner[(i+1)%simplified.length] || dist12 < 1) {
             d += ` L ${coord(p2.x)} ${coord(p2.y)}`;
             continue;
        }

        // Catmull-Rom Control Points
        // cp1 = p1 + (p2 - p0) / 6 * (1-tension)
        // cp2 = p2 - (p3 - p1) / 6 * (1-tension)
        
        const f = (1 - tension) / 6.0;

        let cp1x = p1.x + (p2.x - p0.x) * f;
        let cp1y = p1.y + (p2.y - p0.y) * f;

        let cp2x = p2.x - (p3.x - p1.x) * f;
        let cp2y = p2.y - (p3.y - p1.y) * f;
        
        // Clamp control points to prevent loops on short segments
        if (dist12 < 10) {
             // Fallback to quadratic-like or linear for very short detail segments
             cp1x = p1.x + (p2.x - p1.x) * 0.33;
             cp1y = p1.y + (p2.y - p1.y) * 0.33;
             cp2x = p2.x - (p2.x - p1.x) * 0.33;
             cp2y = p2.y - (p2.y - p1.y) * 0.33;
        }

        d += ` C ${coord(cp1x)} ${coord(cp1y)}, ${coord(cp2x)} ${coord(cp2y)}, ${coord(p2.x)} ${coord(p2.y)}`;
    }

    d += " Z";
    return d;
}

// --- Main Trace ---
export const traceImage = async (originalImageData: ImageData, params: TracerParams): Promise<{ paths: VectorPath[], svgString: string }> => {
    await yieldToMain();
    
    // Performance Guard: Downscale huge images for processing
    const MAX_DIM = 1280;
    let internalScale = 1;
    let processingImageData = originalImageData;

    // Use scale logic only if image is huge
    if (originalImageData.width > MAX_DIM || originalImageData.height > MAX_DIM) {
         internalScale = Math.min(MAX_DIM / originalImageData.width, MAX_DIM / originalImageData.height);
         processingImageData = scaleImageData(originalImageData, internalScale);
    }

    // Apply User Sampling (Upscale) on top of (potentially) downscaled image
    // Note: If user wants 2x, and we downscaled, we effectively process at 2 * internalScale.
    const samplingScale = params.sampling || 1;
    let imageData = scaleImageData(processingImageData, samplingScale);
    
    // Total coordinate scaling factor to map back to original space
    const totalScaleFactor = internalScale * samplingScale;

    if (samplingScale > 1) {
        const sharpenStrength = samplingScale === 2 ? 0.4 : 0.7;
        const sharpenedData = await applySharpen(imageData.data, imageData.width, imageData.height, sharpenStrength);
        imageData = new ImageData(sharpenedData, imageData.width, imageData.height);
    }
    
    const { width, height, data } = imageData;
    const paths: VectorPath[] = [];

    let processedData = data;
    if (params.colorMode !== 'color') {
        processedData = await applyColorMode(data, width, height, params.colorMode);
    }

    const blurRadius = (params.blur || 0) * samplingScale;
    processedData = await applyBlur(processedData, width, height, blurRadius);

    const k = params.colorMode === 'binary' ? 2 : Math.max(2, params.colors);
    let labels = await runKMeans(processedData, width * height, k);
    // @ts-ignore
    const centroids = labels.centroids as Rgba[];

    await yieldToMain();
    
    if (params.autoAntiAlias) {
        labels = await applyMajorityFilter(labels, width, height, 2);
    }
    
    const scaledNoise = params.noise * (samplingScale * samplingScale);
    labels = denoiseLabels(labels, width, height, params.noise);

    // --- Background Removal Logic ---
    let targetBgColor: Rgba | undefined;
    if (params.backgroundColor) {
        targetBgColor = { ...params.backgroundColor, a: 255 };
    } else {
        targetBgColor = detectDominantColor(processedData, width, height);
    }

    const bgLabelIds: number[] = [];
    centroids.forEach((c, idx) => {
        if (isBackgroundPixel(c, targetBgColor)) bgLabelIds.push(idx);
    });

    if (params.ignoreWhite && bgLabelIds.length > 0) {
        if (params.smartBackground) {
            markBackground(labels, width, height, bgLabelIds);
        } else {
            for(let i=0; i<labels.length; i++) {
                if (bgLabelIds.includes(labels[i])) labels[i] = 255;
            }
        }
    }

    // --- Layer Sorting ---
    const labelCounts = new Map<number, number>();
    for(let i=0; i<labels.length; i++) {
        const l = labels[i];
        if (l !== 255) {
             labelCounts.set(l, (labelCounts.get(l) || 0) + 1);
        }
    }

    let layersToTrace = centroids.map((c, i) => ({ 
        id: i, 
        color: c, 
        count: labelCounts.get(i) || 0 
    }));
    
    // Sort: Largest Count (Background) -> First (Bottom of stack)
    layersToTrace.sort((a, b) => b.count - a.count);
    
    let processedCount = 0;
    for (const layer of layersToTrace) {
        if (processedCount % 1 === 0) await yieldToMain();
        processedCount++;
        if (layer.count === 0) continue;

        const loops = traceLayer(labels, width, height, layer.id, scaledNoise);
        const hexColor = rgbToHex(layer.color.r, layer.color.g, layer.color.b);
        
        // --- KEY FIX: Combine all loops for a single layer into ONE path ---
        // This allows SVG 'fill-rule="evenodd"' to correctly handle holes (e.g. gaps in the cat's fur)
        const layerPathParts: string[] = [];
        
        loops.forEach((loop) => {
             const pathData = smoothPath(loop, params.paths, params.corners, totalScaleFactor);
             if (pathData) {
                 layerPathParts.push(pathData);
             }
        });

        if (layerPathParts.length > 0) {
            // Join all sub-paths into one large path string
            const combinedD = layerPathParts.join(' ');
            paths.push({
                id: `layer-${layer.id}`,
                d: combinedD,
                fill: hexColor,
                stroke: hexColor, 
                strokeWidth: 0.25, 
                x: 0,
                y: 0
            });
        }
    }

    // Added fill-rule="evenodd" to the export SVG string
    const svgString = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${originalImageData.width} ${originalImageData.height}">
        ${paths.map(p => `<path d="${p.d}" fill="${p.fill}" stroke="${p.fill}" stroke-width="0.25" stroke-linejoin="round" fill-rule="evenodd" />`).join('\n')}
      </svg>
    `;

    return { paths, svgString };
};