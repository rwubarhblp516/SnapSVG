/*
 * Copyright 2022 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// [MODIFIED] 使用绝对路径修复 Vite dev server 兼容性问题

function waitForMsgType(target, type) {
  return new Promise(resolve => {
    target.addEventListener('message', function onMsg({ data }) {
      if (data?.type !== type) return;
      target.removeEventListener('message', onMsg);
      resolve(data);
    });
  });
}

waitForMsgType(self, 'wasm_bindgen_worker_init').then(async ({ init, receiver }) => {
  console.log('[Rayon Worker] 子 Worker 启动中...');
  // [MODIFIED] 使用绝对路径替代相对路径 '../../..'
  // 这样可以在 Vite dev server 环境下正确解析模块路径
  const wasmJsUrl = new URL('/wasm/snapsvg_core.js', self.location.origin).href;

  // 使用 new Function 绕过打包器的静态分析
  const dynamicImport = new Function('url', 'return import(url)');
  const pkg = await dynamicImport(wasmJsUrl);

  await pkg.default(init);
  console.log('[Rayon Worker] 子 Worker 就绪');
  postMessage({ type: 'wasm_bindgen_worker_ready' });
  pkg.wbg_rayon_start_worker(receiver);
});

// Note: this is never used, but necessary to prevent a bug in Firefox
// (https://bugzilla.mozilla.org/show_bug.cgi?id=1702191) where it collects
// Web Workers that have a shared WebAssembly memory with the main thread,
// but are not explicitly rooted via a `Worker` instance.
//
// By storing them in a variable, we can keep `Worker` objects around and
// prevent them from getting GC-d.
let _workers;

export async function startWorkers(module, memory, builder) {
  const numThreads = builder.numThreads();
  if (numThreads === 0) {
    throw new Error(`num_threads must be > 0.`);
  }

  console.log(`[Rayon] 正在启动 ${numThreads} 个子 Worker...`);

  const workerInit = {
    type: 'wasm_bindgen_worker_init',
    init: { module_or_path: module, memory },
    receiver: builder.receiver()
  };

  // [MODIFIED] 使用绝对路径创建 Worker
  const workerHelperUrl = new URL('/wasm/snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js', self.location.origin).href;

  const startTime = performance.now();
  _workers = await Promise.all(
    Array.from({ length: numThreads }, async (_, i) => {
      const worker = new Worker(workerHelperUrl, {
        type: 'module'
      });
      worker.postMessage(workerInit);
      await waitForMsgType(worker, 'wasm_bindgen_worker_ready');
      console.log(`[Rayon] 子 Worker ${i + 1}/${numThreads} 已就绪`);
      return worker;
    })
  );

  const elapsed = (performance.now() - startTime).toFixed(1);
  console.log(`[Rayon] ✅ 所有 ${numThreads} 个子 Worker 启动完成，耗时 ${elapsed}ms`);
  builder.build();
}
