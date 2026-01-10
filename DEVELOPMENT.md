# SnapSVG 进阶开发指南

欢迎加入 SnapSVG 的开发。本文档旨在指导开发者如何在本地搭建环境，并详细阐述了如何通过引入 **WebAssembly (WASM)** 将项目性能提升到原生级别的技术路线图。

---

## 1. 基础环境准备 (本地开发)

在开始之前，请确保你的计算机安装了以下工具：

*   **Node.js**: v18.0.0 或更高版本
*   **包管理器**: npm, pnpm 或 yarn
*   **代码编辑器**: VS Code (推荐安装 ESLint, Prettier, Rust-Analyzer 插件)

### 启动项目

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器
npm run dev

# 3. 构建生产版本
npm run build
```

---

## 2. 核心架构现状与瓶颈

当前项目 (`v13.3 High Fidelity`) 使用纯 TypeScript 实现了一套基于 K-Means 聚类和样条拟合的矢量化算法 (`services/mockVTracer.ts`)。

*   **优点**: 零依赖，无需编译 WASM，易于调试，对于 1080p 以下图片表现优异。
*   **瓶颈**:
    *   **CPU 密集型**: JS 是单线程的，处理 4K/8K 图片时会阻塞 UI 线程。
    *   **内存压力**: 大量 `Uint8ClampedArray` 操作容易触发 GC 卡顿。
    *   **数学运算上限**: 复杂的数学运算（如更高级的曲线拟合）在 JS 中效率不如 C++/Rust。

---

## 3. 进阶路线：引入 Rust & WebAssembly (WASM)

这是本项目进阶开发的核心目标：**使用 Rust 重写核心算法，替换 `mockVTracer.ts`。**

### 3.1 环境搭建

你需要安装 Rust 工具链：

1.  **安装 Rust**: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
2.  **安装 wasm-pack**: `curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh`
    *   Windows 用户请访问官网下载 `.exe` 安装包。

### 3.2 目录结构改造建议

建议在项目根目录下创建一个独立的 Rust crate：

```text
SnapSVG/
├── src/               # 现有的 React 前端代码
├── src-rust/          # [新建] Rust 核心代码
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs
├── package.json
└── ...
```

### 3.3 Rust 实现示例

在 `src-rust/Cargo.toml` 中添加依赖：

```toml
[package]
name = "snapsvg-core"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"] # 必须，用于编译为 WASM

[dependencies]
wasm-bindgen = "0.2"
image = "0.24"          # Rust 图片处理库
vtracer = "0.6"         # 业界成熟的 Rust 矢量化库 (强烈推荐基于此库封装)
```

在 `src-rust/src/lib.rs` 中暴露接口：

```rust
use wasm_bindgen::prelude::*;
use vtracer::{Config, convert_image_to_svg};

#[wasm_bindgen]
pub fn trace_image_to_svg(
    image_bytes: &[u8], // 从 JS 传入的图片二进制数据
    colors: u8,
    details: u8,
) -> String {
    // 1. 配置转换参数
    let config = Config {
        color_count: colors,
        hierarchical: "cutout".parse().unwrap(),
        mode: "spline".parse().unwrap(),
        filter_speckle: 4,
        color_precision: 6,
        layer_difference: 16,
        corner_threshold: 60,
        length_threshold: 4.0,
        max_iterations: 10,
        splice_threshold: 45,
        path_precision: Some(details),
        ..Default::default()
    };

    // 2. 调用 vtracer 核心逻辑
    let img = image::load_from_memory(image_bytes).expect("Failed to load image");
    
    // 3. 返回 SVG 字符串
    convert_image_to_svg(img, config).unwrap()
}
```

### 3.4 编译与集成

1.  **编译 WASM**:
    ```bash
    cd src-rust
    wasm-pack build --target web --out-dir ../public/wasm
    ```
    若需要启用多线程（Rayon），请确保服务器启用 `Cross-Origin-Opener-Policy: same-origin` 与 `Cross-Origin-Embedder-Policy: require-corp`，并使用 nightly 工具链构建。

2.  **前端调用 (React)**:
    你需要修改 `App.tsx` 或创建一个新的 `services/wasmTracer.ts`。

    ```typescript
    // services/wasmTracer.ts
    import init, { trace_image_to_svg } from '/wasm/snapsvg_core.js';

    let wasmInitialized = false;

    export const runWasmTracer = async (imageFile: File, params: any) => {
        if (!wasmInitialized) {
            await init();
            wasmInitialized = true;
        }

        const arrayBuffer = await imageFile.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // 调用 Rust 函数 (毫秒级完成)
        const svgString = trace_image_to_svg(uint8Array, params.colors, params.paths);
        
        return svgString;
    };
    ```

---

## 4. 性能优化策略 (Web Worker)

即使使用了 WASM，如果在主线程运行，大图依然可能短暂卡死 UI。最佳实践是将 WASM 放入 **Web Worker** 中运行。

1.  **创建 Worker**: 新建 `src/workers/tracer.worker.ts`。
2.  **加载 WASM**: 在 Worker 内部加载 WASM 模块。
3.  **消息传递**: 主线程通过 `postMessage` 发送图片数据（推荐使用 `Transferable Objects` 传递 ArrayBuffer 以避免拷贝），Worker 处理完后发回 SVG 字符串。

---

## 5. 功能扩展建议

完成 WASM 迁移后，你可以探索以下方向：

1.  **实时预览优化**: 对于 4K 图，先在 WASM 中将图片缩小到 512px 进行快速预览，用户停止拖动滑块后再进行全分辨率计算。
2.  **图层编辑**: 目前 SVG 是作为一个整体字符串返回的。可以在 Rust 端返回 JSON 格式的路径数据 (Path Data)，让前端能单独选中、修改每一个色块的颜色或形状。
3.  **DXF/EPS 导出**: 利用 Rust 生态丰富的库，支持导出 CAD (DXF) 或打印级 (EPS/PDF) 格式。

---

## 6. 贡献与代码规范

*   **TypeScript**: 保持强类型定义，不要使用 `any`。
*   **注释**: 核心算法逻辑必须保留中文注释。
*   **组件**: 保持 UI 组件 (如 Sidebar) 与 逻辑 (Tracer) 分离。

祝你在本地开发愉快，期待 SnapSVG 进化为最强的开源矢量化工具！
