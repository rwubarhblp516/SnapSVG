import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const isDev = mode === 'development';

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless'
      },
      // 确保 WASM 文件有正确的 MIME 类型
      fs: {
        strict: false,
      }
    },
    preview: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless'
      }
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      // 传递开发模式标志给代码
      '__DEV__': JSON.stringify(isDev)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    // 排除 WASM 相关文件的优化，让它们作为静态文件处理
    optimizeDeps: {
      exclude: ['snapsvg_core']
    },
    // 确保 .wasm 文件被识别为资源
    assetsInclude: ['**/*.wasm'],
    build: {
      // 生产构建时的配置
      target: 'esnext',
      rollupOptions: {
        output: {
          // 确保 Worker 文件单独打包
          manualChunks: undefined
        }
      }
    },
    // Worker 配置
    worker: {
      format: 'es',
      plugins: () => [react()]
    }
  };
});
