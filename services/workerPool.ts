/**
 * Worker 池管理器
 * 
 * 管理多个 WASM Worker 实例，实现真正的并行矢量化处理
 */

// @ts-ignore - Vite Worker 导入语法
import TracerWorker from './tracer.worker?worker';
import { TracerParams, TracerResult, VectorPath } from '../types';

// Worker 池配置
const MIN_WORKERS = 2;
const MAX_WORKERS = 8;

// Worker 状态
type WorkerState = 'idle' | 'busy' | 'initializing' | 'error';

interface PooledWorker {
    id: number;
    worker: Worker;
    state: WorkerState;
    currentTaskId: string | null;
    threadStatus: { state: string; threads?: number };
}

// 任务定义
interface TraceTask {
    id: string;
    rgbaData: Uint8Array;
    width: number;
    height: number;
    offsetX: number;  // 在原图中的偏移
    offsetY: number;
    params: TracerParams;
    bgColorHex: string;
    scale: number;
    resolve: (result: TracerResult) => void;
    reject: (error: Error) => void;
}

// 事件回调
type ProgressCallback = (completed: number, total: number, partialResult?: TracerResult) => void;
type ThreadStatusCallback = (workerId: number, status: { state: string; threads?: number }) => void;

class WorkerPool {
    private workers: PooledWorker[] = [];
    private taskQueue: TraceTask[] = [];
    private isInitialized = false;
    private initPromise: Promise<void> | null = null;
    private threadStatusCallback: ThreadStatusCallback | null = null;
    private nextTaskId = 0;

    /**
     * 初始化 Worker 池
     */
    async initialize(workerCount?: number): Promise<void> {
        if (this.isInitialized) return;
        if (this.initPromise) return this.initPromise;

        const count = Math.max(MIN_WORKERS, Math.min(MAX_WORKERS,
            workerCount ?? Math.max(2, (navigator.hardwareConcurrency || 4) - 1)
        ));

        console.log(`[WorkerPool] 初始化 ${count} 个 Worker...`);

        this.initPromise = this._createWorkers(count);
        await this.initPromise;
        this.isInitialized = true;
        console.log(`[WorkerPool] ✅ ${count} 个 Worker 就绪`);
    }

    private async _createWorkers(count: number): Promise<void> {
        const createPromises = Array.from({ length: count }, (_, i) =>
            this._createWorker(i)
        );
        await Promise.all(createPromises);
    }

    private async _createWorker(id: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const worker = new TracerWorker({ type: 'module' });

            const pooledWorker: PooledWorker = {
                id,
                worker,
                state: 'initializing',
                currentTaskId: null,
                threadStatus: { state: 'unknown' }
            };

            // 设置消息处理
            worker.onmessage = (e: MessageEvent) => {
                this._handleWorkerMessage(pooledWorker, e);
            };

            worker.onerror = (e) => {
                console.error(`[WorkerPool] Worker ${id} 错误:`, e);
                pooledWorker.state = 'error';
                reject(e);
            };

            this.workers.push(pooledWorker);

            // Worker 创建后立即标记为空闲（WASM 在首次任务时懒加载）
            pooledWorker.state = 'idle';
            resolve();
        });
    }

    private _handleWorkerMessage(pooledWorker: PooledWorker, e: MessageEvent): void {
        const { id, type, result, error, status } = e.data;

        if (type === 'thread-status') {
            pooledWorker.threadStatus = status;
            this.threadStatusCallback?.(pooledWorker.id, status);
            return;
        }

        if (type === 'success' || type === 'error') {
            // 完成任务，查找对应的任务
            const taskIndex = this.taskQueue.findIndex(t => t.id === pooledWorker.currentTaskId);

            if (taskIndex === -1) {
                // 任务可能已被外部管理
                return;
            }

            const task = this.taskQueue.splice(taskIndex, 1)[0];
            pooledWorker.state = 'idle';
            pooledWorker.currentTaskId = null;

            if (type === 'success') {
                task.resolve(result);
            } else {
                task.reject(new Error(error));
            }

            // 处理队列中的下一个任务
            this._processQueue();
        }
    }

    /**
     * 提交分块矢量化任务
     */
    async traceChunk(
        rgbaData: Uint8Array,
        width: number,
        height: number,
        offsetX: number,
        offsetY: number,
        params: TracerParams,
        bgColorHex: string,
        scale: number
    ): Promise<TracerResult> {
        await this.initialize();

        return new Promise((resolve, reject) => {
            const task: TraceTask = {
                id: `task-${this.nextTaskId++}`,
                rgbaData,
                width,
                height,
                offsetX,
                offsetY,
                params,
                bgColorHex,
                scale,
                resolve,
                reject
            };

            this.taskQueue.push(task);
            this._processQueue();
        });
    }

    private _processQueue(): void {
        // 查找空闲 Worker
        const idleWorker = this.workers.find(w => w.state === 'idle');
        if (!idleWorker) return;

        // 查找待处理任务
        const task = this.taskQueue.find(t =>
            !this.workers.some(w => w.currentTaskId === t.id)
        );
        if (!task) return;

        // 分配任务
        idleWorker.state = 'busy';
        idleWorker.currentTaskId = task.id;

        idleWorker.worker.postMessage({
            id: task.id,
            type: 'trace',
            rgbaData: task.rgbaData,
            width: task.width,
            height: task.height,
            params: task.params,
            bgColorHex: task.bgColorHex,
            scale: task.scale
        });
    }

    /**
     * 并行处理图片分块
     */
    async traceParallel(
        imageData: ImageData,
        params: TracerParams,
        bgColorHex: string,
        scale: number,
        onProgress?: ProgressCallback
    ): Promise<TracerResult> {
        await this.initialize();

        const { width, height } = imageData;
        const workerCount = this.workers.length;

        // 计算分块策略
        const chunks = this._calculateChunks(width, height, workerCount);
        console.log(`[WorkerPool] 图片 ${width}x${height} 分成 ${chunks.length} 块并行处理`);

        const startTime = performance.now();
        let completedChunks = 0;
        const allPaths: VectorPath[] = [];

        // 并行处理所有分块
        const chunkPromises = chunks.map(async (chunk, index) => {
            // 提取分块数据
            const chunkData = this._extractChunk(imageData, chunk);

            const result = await this.traceChunk(
                new Uint8Array(chunkData.data.buffer),
                chunk.width,
                chunk.height,
                chunk.x,
                chunk.y,
                params,
                bgColorHex,
                scale
            );

            completedChunks++;

            // 调整路径偏移量
            const adjustedPaths = result.paths.map(path => ({
                ...path,
                x: (path.x || 0) + chunk.x / scale,
                y: (path.y || 0) + chunk.y / scale,
                initialX: (path.initialX || 0) + chunk.x / scale,
                initialY: (path.initialY || 0) + chunk.y / scale
            }));

            onProgress?.(completedChunks, chunks.length, {
                paths: adjustedPaths,
                svgString: '',
                palette: result.palette
            });

            return { paths: adjustedPaths, palette: result.palette };
        });

        const results = await Promise.all(chunkPromises);

        // 合并所有路径
        results.forEach(r => allPaths.push(...r.paths));

        // 合并调色板（去重）
        const paletteMap = new Map<string, typeof results[0]['palette'][0]>();
        results.forEach(r => {
            r.palette.forEach(p => {
                const existing = paletteMap.get(p.hex);
                if (existing) {
                    existing.count += p.count;
                } else {
                    paletteMap.set(p.hex, { ...p });
                }
            });
        });
        const mergedPalette = Array.from(paletteMap.values())
            .sort((a, b) => b.count - a.count);

        const elapsed = performance.now() - startTime;
        console.log(`[WorkerPool] ✅ 并行处理完成，${chunks.length} 块，总耗时 ${elapsed.toFixed(1)}ms`);

        // 生成合并后的 SVG
        const svgString = this._generateMergedSvg(allPaths, width, height, scale);

        return {
            paths: allPaths,
            svgString,
            palette: mergedPalette
        };
    }

    private _calculateChunks(
        width: number,
        height: number,
        workerCount: number
    ): Array<{ x: number; y: number; width: number; height: number }> {
        // 简单的水平分块策略
        // TODO: 可以优化为更智能的分块（考虑图片宽高比）
        const chunks: Array<{ x: number; y: number; width: number; height: number }> = [];

        // 根据图片大小决定分块数量
        const pixelCount = width * height;
        const minChunkPixels = 500000; // 最小 50 万像素/块
        const optimalChunks = Math.max(1, Math.min(workerCount, Math.ceil(pixelCount / minChunkPixels)));

        // 优先水平分割（对于横图）或垂直分割（对于竖图）
        const isLandscape = width > height;
        const splitCount = optimalChunks;

        if (isLandscape) {
            // 水平分割
            const chunkWidth = Math.ceil(width / splitCount);
            for (let i = 0; i < splitCount; i++) {
                const x = i * chunkWidth;
                const w = Math.min(chunkWidth, width - x);
                if (w > 0) {
                    chunks.push({ x, y: 0, width: w, height });
                }
            }
        } else {
            // 垂直分割
            const chunkHeight = Math.ceil(height / splitCount);
            for (let i = 0; i < splitCount; i++) {
                const y = i * chunkHeight;
                const h = Math.min(chunkHeight, height - y);
                if (h > 0) {
                    chunks.push({ x: 0, y, width, height: h });
                }
            }
        }

        return chunks;
    }

    private _extractChunk(
        imageData: ImageData,
        chunk: { x: number; y: number; width: number; height: number }
    ): ImageData {
        const { x, y, width: cw, height: ch } = chunk;
        const { width: iw, data: srcData } = imageData;

        const chunkData = new Uint8ClampedArray(cw * ch * 4);

        for (let row = 0; row < ch; row++) {
            const srcOffset = ((y + row) * iw + x) * 4;
            const dstOffset = row * cw * 4;
            chunkData.set(srcData.slice(srcOffset, srcOffset + cw * 4), dstOffset);
        }

        return new ImageData(chunkData, cw, ch);
    }

    private _generateMergedSvg(
        paths: VectorPath[],
        width: number,
        height: number,
        scale: number
    ): string {
        const pathsStr = paths.map(p => {
            const transform = `translate(${(p.x || 0) * scale},${(p.y || 0) * scale})`;
            return `<path d="${p.d}" fill="${p.fill}" transform="${transform}" />`;
        }).join('\n');

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n${pathsStr}\n</svg>`;
    }

    /**
     * 设置线程状态回调
     */
    onThreadStatus(callback: ThreadStatusCallback): void {
        this.threadStatusCallback = callback;
    }

    /**
     * 获取池状态
     */
    getStatus(): {
        workerCount: number;
        idleCount: number;
        busyCount: number;
        queueLength: number;
    } {
        return {
            workerCount: this.workers.length,
            idleCount: this.workers.filter(w => w.state === 'idle').length,
            busyCount: this.workers.filter(w => w.state === 'busy').length,
            queueLength: this.taskQueue.length
        };
    }

    /**
     * 销毁池
     */
    destroy(): void {
        this.workers.forEach(w => w.worker.terminate());
        this.workers = [];
        this.taskQueue = [];
        this.isInitialized = false;
        this.initPromise = null;
        console.log('[WorkerPool] 已销毁');
    }
}

// 导出单例
export const workerPool = new WorkerPool();
export type { ProgressCallback, ThreadStatusCallback };
