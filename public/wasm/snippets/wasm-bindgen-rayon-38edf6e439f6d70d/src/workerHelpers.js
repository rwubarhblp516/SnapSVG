/*
 * Copyright 2022 Google Inc. All Rights Reserved.
 * Modified for Vite dev server compatibility
 */

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
  const wasmJsUrl = new URL('/wasm/snapsvg_core.js', self.location.origin).href;
  const dynamicImport = new Function('url', 'return import(url)');
  const pkg = await dynamicImport(wasmJsUrl);
  
  await pkg.default(init);
  console.log('[Rayon Worker] 子 Worker 就绪');
  postMessage({ type: 'wasm_bindgen_worker_ready' });
  pkg.wbg_rayon_start_worker(receiver);
});

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

  const workerHelperUrl = new URL('/wasm/snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js', self.location.origin).href;

  const startTime = performance.now();
  _workers = await Promise.all(
    Array.from({ length: numThreads }, async (_, i) => {
      const worker = new Worker(workerHelperUrl, { type: 'module' });
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
