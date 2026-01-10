/**
 * 智能任务调度器
 * 
 * 功能：
 * 1. 任务取消 - 当新任务到来时自动取消正在等待的旧任务
 * 2. 去抖动 - 快速参数变化时只处理最后一次
 * 3. 优先级队列 - 支持高优先级任务插队
 */

import { TracerParams, TracerResult } from '../types';

export type TaskPriority = 'low' | 'normal' | 'high';
export type TaskState = 'pending' | 'running' | 'completed' | 'cancelled' | 'error';

interface TraceTask {
    id: string;
    imageId: string;  // 用于识别同一图片的任务
    priority: TaskPriority;
    state: TaskState;
    createdAt: number;
    params: TracerParams;
    onProgress?: (progress: number) => void;
    resolve: (result: TracerResult) => void;
    reject: (error: Error) => void;
}

interface SchedulerOptions {
    debounceMs?: number;      // 去抖动时间（毫秒），默认 150
    maxQueueSize?: number;    // 最大队列长度，默认 3
    cancelOnNewTask?: boolean; // 新任务到来时是否取消旧任务，默认 true
}

class TaskScheduler {
    private queue: TraceTask[] = [];
    private currentTask: TraceTask | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private options: Required<SchedulerOptions>;
    private taskCounter = 0;
    private cancelledIds = new Set<string>();

    constructor(options: SchedulerOptions = {}) {
        this.options = {
            debounceMs: options.debounceMs ?? 150,
            maxQueueSize: options.maxQueueSize ?? 3,
            cancelOnNewTask: options.cancelOnNewTask ?? true,
        };
    }

    /**
     * 提交任务（带去抖动）
     */
    submitDebounced(
        imageId: string,
        params: TracerParams,
        executor: () => Promise<TracerResult>,
        priority: TaskPriority = 'normal',
        onProgress?: (progress: number) => void
    ): Promise<TracerResult> {
        // 取消同一图片的等待中任务
        if (this.options.cancelOnNewTask) {
            this._cancelPendingTasksForImage(imageId);
        }

        return new Promise((resolve, reject) => {
            const task: TraceTask = {
                id: `task-${++this.taskCounter}`,
                imageId,
                priority,
                state: 'pending',
                createdAt: Date.now(),
                params,
                onProgress,
                resolve,
                reject,
            };

            // 清除之前的去抖动定时器
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            // 去抖动：延迟添加到队列
            this.debounceTimer = setTimeout(() => {
                this._addToQueue(task, executor);
            }, this.options.debounceMs);
        });
    }

    /**
     * 立即提交任务（无去抖动）
     */
    submitImmediate(
        imageId: string,
        params: TracerParams,
        executor: () => Promise<TracerResult>,
        priority: TaskPriority = 'high',
        onProgress?: (progress: number) => void
    ): Promise<TracerResult> {
        // 取消同一图片的等待中任务
        if (this.options.cancelOnNewTask) {
            this._cancelPendingTasksForImage(imageId);
        }

        return new Promise((resolve, reject) => {
            const task: TraceTask = {
                id: `task-${++this.taskCounter}`,
                imageId,
                priority,
                state: 'pending',
                createdAt: Date.now(),
                params,
                onProgress,
                resolve,
                reject,
            };

            this._addToQueue(task, executor);
        });
    }

    private _cancelPendingTasksForImage(imageId: string): void {
        const cancelled: string[] = [];

        this.queue = this.queue.filter(task => {
            if (task.imageId === imageId && task.state === 'pending') {
                task.state = 'cancelled';
                task.reject(new Error('Task cancelled by newer request'));
                this.cancelledIds.add(task.id);
                cancelled.push(task.id);
                return false;
            }
            return true;
        });

        if (cancelled.length > 0) {
            console.log(`[Scheduler] 取消了 ${cancelled.length} 个等待中的任务`);
        }
    }

    private async _addToQueue(task: TraceTask, executor: () => Promise<TracerResult>): Promise<void> {
        // 限制队列大小
        while (this.queue.length >= this.options.maxQueueSize) {
            const oldest = this.queue.shift();
            if (oldest && oldest.state === 'pending') {
                oldest.state = 'cancelled';
                oldest.reject(new Error('Task dropped due to queue overflow'));
                this.cancelledIds.add(oldest.id);
            }
        }

        // 按优先级插入
        const priorityOrder: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };
        const insertIndex = this.queue.findIndex(
            t => priorityOrder[t.priority] > priorityOrder[task.priority]
        );

        if (insertIndex === -1) {
            this.queue.push(task);
        } else {
            this.queue.splice(insertIndex, 0, task);
        }

        console.log(`[Scheduler] 任务 ${task.id} 加入队列，优先级: ${task.priority}，队列长度: ${this.queue.length}`);

        // 如果没有正在执行的任务，开始处理
        if (!this.currentTask) {
            this._processNext(executor);
        }
    }

    private async _processNext(executor: () => Promise<TracerResult>): Promise<void> {
        if (this.queue.length === 0) {
            this.currentTask = null;
            return;
        }

        const task = this.queue.shift()!;

        // 检查是否已被取消
        if (this.cancelledIds.has(task.id)) {
            this.cancelledIds.delete(task.id);
            this._processNext(executor);
            return;
        }

        this.currentTask = task;
        task.state = 'running';

        const startTime = performance.now();
        console.log(`[Scheduler] 开始执行任务 ${task.id}`);

        try {
            const result = await executor();

            // 再次检查是否在执行过程中被取消
            if (this.cancelledIds.has(task.id)) {
                this.cancelledIds.delete(task.id);
                task.state = 'cancelled';
                task.reject(new Error('Task cancelled during execution'));
            } else {
                task.state = 'completed';
                const elapsed = performance.now() - startTime;
                console.log(`[Scheduler] 任务 ${task.id} 完成，耗时 ${elapsed.toFixed(1)}ms`);
                task.resolve(result);
            }
        } catch (error) {
            task.state = 'error';
            console.error(`[Scheduler] 任务 ${task.id} 失败:`, error);
            task.reject(error instanceof Error ? error : new Error(String(error)));
        }

        this.currentTask = null;
        this._processNext(executor);
    }

    /**
     * 取消所有等待中的任务
     */
    cancelAll(): void {
        const count = this.queue.length;
        this.queue.forEach(task => {
            if (task.state === 'pending') {
                task.state = 'cancelled';
                task.reject(new Error('All tasks cancelled'));
            }
        });
        this.queue = [];

        if (count > 0) {
            console.log(`[Scheduler] 取消了所有 ${count} 个等待中的任务`);
        }
    }

    /**
     * 获取调度器状态
     */
    getStatus(): {
        queueLength: number;
        isProcessing: boolean;
        currentTaskId: string | null;
    } {
        return {
            queueLength: this.queue.length,
            isProcessing: this.currentTask !== null,
            currentTaskId: this.currentTask?.id ?? null,
        };
    }

    /**
     * 更新配置
     */
    updateOptions(options: Partial<SchedulerOptions>): void {
        this.options = { ...this.options, ...options };
    }
}

// 导出单例
export const taskScheduler = new TaskScheduler();
export type { TraceTask, SchedulerOptions };
