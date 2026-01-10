/**
 * 图像采样预缓存器
 * 
 * 功能：
 * 1. 上传图片时并行预计算 1x、2x、4x 的放大图像
 * 2. 缓存放大后的 ImageData
 * 3. 后续切换采样精度时直接使用缓存
 */

// 采样级别定义
export const SAMPLING_LEVELS = [1, 2, 4] as const;
export type SamplingLevel = typeof SAMPLING_LEVELS[number];

// 缓存条目
interface SamplingCacheEntry {
    samplingLevel: SamplingLevel;
    imageData: ImageData;
    width: number;
    height: number;
    createdAt: number;
}

// 预缓存状态
interface PrecacheStatus {
    pending: SamplingLevel[];
    completed: SamplingLevel[];
    failed: SamplingLevel[];
    isComplete: boolean;
}

// 进度回调
type PrecacheProgressCallback = (status: PrecacheStatus) => void;

class SamplingPrecacher {
    // 使用 WeakMap 自动垃圾回收
    private cache = new WeakMap<ImageData, Map<SamplingLevel, SamplingCacheEntry>>();
    private precachePromises = new WeakMap<ImageData, Promise<void>>();
    private progressCallbacks = new WeakMap<ImageData, Set<PrecacheProgressCallback>>();

    /**
     * 检查特定采样级别是否已缓存
     */
    hasCached(originalImageData: ImageData, samplingLevel: SamplingLevel): boolean {
        const cacheMap = this.cache.get(originalImageData);
        return cacheMap?.has(samplingLevel) ?? false;
    }

    /**
     * 获取缓存的放大图像
     */
    getCached(originalImageData: ImageData, samplingLevel: SamplingLevel): ImageData | null {
        const cacheMap = this.cache.get(originalImageData);
        const entry = cacheMap?.get(samplingLevel);
        return entry?.imageData ?? null;
    }

    /**
     * 获取所有已缓存的级别
     */
    getCachedLevels(originalImageData: ImageData): SamplingLevel[] {
        const cacheMap = this.cache.get(originalImageData);
        if (!cacheMap) return [];
        return Array.from(cacheMap.keys());
    }

    /**
     * 启动预缓存（并行计算所有采样级别）
     */
    async precache(
        originalImageData: ImageData,
        blur: number = 0,
        onProgress?: PrecacheProgressCallback
    ): Promise<void> {
        // 检查是否已经在预缓存中
        const existingPromise = this.precachePromises.get(originalImageData);
        if (existingPromise) {
            if (onProgress) {
                this._addProgressCallback(originalImageData, onProgress);
            }
            return existingPromise;
        }

        // 注册进度回调
        if (onProgress) {
            this._addProgressCallback(originalImageData, onProgress);
        }

        // 初始化缓存 Map
        let cacheMap = this.cache.get(originalImageData);
        if (!cacheMap) {
            cacheMap = new Map();
            this.cache.set(originalImageData, cacheMap);
        }

        const status: PrecacheStatus = {
            pending: [...SAMPLING_LEVELS],
            completed: [],
            failed: [],
            isComplete: false
        };

        console.log(`[SamplingPrecacher] 开始预缓存 ${originalImageData.width}x${originalImageData.height} 图像...`);

        const precachePromise = (async () => {
            const startTime = performance.now();

            // 并行计算所有采样级别
            const promises = SAMPLING_LEVELS.map(async (level) => {
                try {
                    // 检查是否已缓存
                    if (cacheMap!.has(level)) {
                        status.pending = status.pending.filter(l => l !== level);
                        status.completed.push(level);
                        this._notifyProgress(originalImageData, status);
                        return;
                    }

                    // 计算放大后的图像
                    const scaledData = await this._scaleImage(originalImageData, level, blur);

                    // 保存到缓存
                    cacheMap!.set(level, {
                        samplingLevel: level,
                        imageData: scaledData,
                        width: scaledData.width,
                        height: scaledData.height,
                        createdAt: Date.now()
                    });

                    // 更新状态
                    status.pending = status.pending.filter(l => l !== level);
                    status.completed.push(level);
                    this._notifyProgress(originalImageData, status);

                    console.log(`[SamplingPrecacher] ${level}x 完成: ${scaledData.width}x${scaledData.height}`);
                } catch (error) {
                    console.error(`[SamplingPrecacher] ${level}x 失败:`, error);
                    status.pending = status.pending.filter(l => l !== level);
                    status.failed.push(level);
                    this._notifyProgress(originalImageData, status);
                }
            });

            await Promise.all(promises);

            status.isComplete = true;
            this._notifyProgress(originalImageData, status);

            const elapsed = performance.now() - startTime;
            console.log(`[SamplingPrecacher] ✅ 预缓存完成！耗时 ${elapsed.toFixed(1)}ms`);
        })();

        this.precachePromises.set(originalImageData, precachePromise);

        try {
            await precachePromise;
        } finally {
            this.precachePromises.delete(originalImageData);
            this.progressCallbacks.delete(originalImageData);
        }
    }

    /**
     * 缩放单张图像
     */
    private async _scaleImage(
        originalImageData: ImageData,
        scale: SamplingLevel,
        blur: number
    ): Promise<ImageData> {
        const { width, height } = originalImageData;
        const targetWidth = width * scale;
        const targetHeight = height * scale;

        // 使用 OffscreenCanvas 如果可用（更快）
        if (typeof OffscreenCanvas !== 'undefined') {
            return this._scaleWithOffscreenCanvas(originalImageData, targetWidth, targetHeight, blur);
        }

        // 回退到普通 Canvas
        return this._scaleWithCanvas(originalImageData, targetWidth, targetHeight, blur);
    }

    private _scaleWithOffscreenCanvas(
        imageData: ImageData,
        targetWidth: number,
        targetHeight: number,
        blur: number
    ): ImageData {
        const { width, height } = imageData;

        // 创建源 Canvas
        const srcCanvas = new OffscreenCanvas(width, height);
        const srcCtx = srcCanvas.getContext('2d');
        if (!srcCtx) throw new Error('无法创建 OffscreenCanvas');
        srcCtx.putImageData(imageData, 0, 0);

        // 创建目标 Canvas
        const dstCanvas = new OffscreenCanvas(targetWidth, targetHeight);
        const dstCtx = dstCanvas.getContext('2d');
        if (!dstCtx) throw new Error('无法创建目标 OffscreenCanvas');

        dstCtx.imageSmoothingEnabled = targetWidth > width;
        if ('imageSmoothingQuality' in dstCtx) {
            dstCtx.imageSmoothingQuality = 'high';
        }
        if (blur > 0 && 'filter' in dstCtx) {
            dstCtx.filter = `blur(${blur}px)`;
        }

        dstCtx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight);

        return dstCtx.getImageData(0, 0, targetWidth, targetHeight);
    }

    private _scaleWithCanvas(
        imageData: ImageData,
        targetWidth: number,
        targetHeight: number,
        blur: number
    ): ImageData {
        const { width, height } = imageData;

        // 创建源 Canvas
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = width;
        srcCanvas.height = height;
        const srcCtx = srcCanvas.getContext('2d');
        if (!srcCtx) throw new Error('无法创建 Canvas');
        srcCtx.putImageData(imageData, 0, 0);

        // 创建目标 Canvas
        const dstCanvas = document.createElement('canvas');
        dstCanvas.width = targetWidth;
        dstCanvas.height = targetHeight;
        const dstCtx = dstCanvas.getContext('2d');
        if (!dstCtx) throw new Error('无法创建目标 Canvas');

        dstCtx.imageSmoothingEnabled = targetWidth > width;
        dstCtx.imageSmoothingQuality = 'high';
        if (blur > 0) {
            dstCtx.filter = `blur(${blur}px)`;
        }

        dstCtx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight);

        return dstCtx.getImageData(0, 0, targetWidth, targetHeight);
    }

    private _addProgressCallback(imageData: ImageData, callback: PrecacheProgressCallback): void {
        let callbacks = this.progressCallbacks.get(imageData);
        if (!callbacks) {
            callbacks = new Set();
            this.progressCallbacks.set(imageData, callbacks);
        }
        callbacks.add(callback);
    }

    private _notifyProgress(imageData: ImageData, status: PrecacheStatus): void {
        const callbacks = this.progressCallbacks.get(imageData);
        if (callbacks) {
            callbacks.forEach(cb => cb({ ...status }));
        }
    }

    /**
     * 清除特定图像的缓存
     */
    clearCache(originalImageData: ImageData): void {
        this.cache.delete(originalImageData);
    }

    /**
     * 获取缓存统计信息
     */
    getStats(originalImageData: ImageData): {
        cached: SamplingLevel[];
        totalBytes: number;
    } {
        const cacheMap = this.cache.get(originalImageData);
        if (!cacheMap) {
            return { cached: [], totalBytes: 0 };
        }

        let totalBytes = 0;
        const cached: SamplingLevel[] = [];

        cacheMap.forEach((entry, level) => {
            cached.push(level);
            totalBytes += entry.imageData.data.length;
        });

        return { cached, totalBytes };
    }
}

// 导出单例
export const samplingPrecacher = new SamplingPrecacher();
export type { SamplingCacheEntry, PrecacheStatus, PrecacheProgressCallback };
