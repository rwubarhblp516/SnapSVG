//! SnapSVG Core - WASM 矢量化引擎
//! 
//! 使用 vtracer/visioncortex 库将位图转换为 SVG 矢量图
//! 支持 Rayon 并行化以提升大图处理性能

use wasm_bindgen::prelude::*;
use vtracer::{Config, ColorMode, Hierarchical, ColorImage};
use visioncortex::color_clusters::{Runner, RunnerConfig, KeyingAction, HIERARCHICAL_MAX};
use visioncortex::{Color, PathSimplifyMode};
use rayon::prelude::*;
use fastrand;
use std::fmt::Write;

#[cfg(feature = "wasm-threads")]
pub use wasm_bindgen_rayon::init_thread_pool;

#[cfg(feature = "wasm-threads")]
thread_local! {
    static TLS_FORCE: std::cell::Cell<u32> = std::cell::Cell::new(0);
}

/// 初始化 panic hook，便于调试
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
    
    #[cfg(feature = "wasm-threads")]
    TLS_FORCE.with(|f| f.set(1));
}

/// 初始化 WASM 线程池（需要启用 crossOriginIsolated）
#[cfg(not(feature = "wasm-threads"))]
#[wasm_bindgen(js_name = initThreadPool)]
pub async fn init_thread_pool(_worker_count: usize) -> Result<(), JsValue> {
    Err(JsValue::from_str("WASM 线程池未启用（需要 wasm-threads 特性与 atomics 支持）"))
}

/// 获取版本信息
#[wasm_bindgen]
pub fn get_version() -> String {
    format!("snapsvg-core v{} (parallel)", env!("CARGO_PKG_VERSION"))
}

// ============================================================================
// 配置参数转换辅助函数
// ============================================================================

struct TracerConfig {
    filter_speckle: usize,
    color_precision: i32,
    layer_difference: i32,
    corner_threshold: i32,
    length_threshold: f64,
    max_iterations: usize,
    splice_threshold: i32,
    path_precision: Option<u32>,
    mode: PathSimplifyMode,
}

fn build_config(
    color_count: u8,
    path_precision: u8,
    corner_threshold: u8,
    filter_speckle: u32,
) -> TracerConfig {
    let color_count_clamped = color_count.max(2).min(64) as i32;
    
    let layer_diff = if color_count_clamped <= 8 {
        16 - (color_count_clamped - 2)
    } else if color_count_clamped <= 24 {
        10 - (color_count_clamped - 9) / 3
    } else {
        4
    };
    
    TracerConfig {
        filter_speckle: filter_speckle as usize,
        color_precision: 8,
        layer_difference: layer_diff.max(4).min(16),
        corner_threshold: corner_threshold as i32,
        length_threshold: 4.0,
        max_iterations: 10,
        splice_threshold: (125 - (path_precision as i32 * 110 / 100)).max(10).min(135),
        path_precision: Some(2),
        mode: PathSimplifyMode::Spline,
    }
}

// ============================================================================
// 原始版本：使用 vtracer::convert (单线程)
// ============================================================================

/// 将图片字节数组转换为 SVG 字符串（单线程版本）
#[wasm_bindgen]
pub fn trace_image_to_svg(
    image_bytes: &[u8],
    color_count: u8,
    path_precision: u8,
    corner_threshold: u8,
    filter_speckle: u32,
    color_mode: &str,
) -> Result<String, JsValue> {
    fastrand::seed(1);
    
    let img = image::load_from_memory(image_bytes)
        .map_err(|e| JsValue::from_str(&format!("图片解析失败: {}", e)))?;
    
    let width = img.width() as usize;
    let height = img.height() as usize;
    let rgba = img.to_rgba8();
    let pixels: Vec<u8> = rgba.into_raw();
    
    let color_image = ColorImage { pixels, width, height };
    
    let mode = match color_mode {
        "binary" => ColorMode::Binary,
        _ => ColorMode::Color,
    };
    
    let cfg = build_config(color_count, path_precision, corner_threshold, filter_speckle);
    
    let config = Config {
        color_mode: mode,
        hierarchical: Hierarchical::Stacked,
        filter_speckle: cfg.filter_speckle,
        color_precision: cfg.color_precision,
        layer_difference: cfg.layer_difference,
        corner_threshold: cfg.corner_threshold,
        length_threshold: cfg.length_threshold,
        max_iterations: cfg.max_iterations,
        splice_threshold: cfg.splice_threshold,
        path_precision: cfg.path_precision,
        ..Default::default()
    };
    
    let svg_file = vtracer::convert(color_image, config)
        .map_err(|e| JsValue::from_str(&format!("矢量化失败: {}", e)))?;
    
    let paths_str: String = svg_file.paths.iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    
    let svg_string = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {} {}">
{}
</svg>"#,
        width, height, paths_str
    );
    
    Ok(svg_string)
}

/// 高性能版本：直接接收 RGBA 像素数据（单线程）
#[wasm_bindgen]
pub fn trace_rgba_to_svg(
    rgba_data: &[u8],
    width: u32,
    height: u32,
    color_count: u8,
    path_precision: u8,
    corner_threshold: u8,
    filter_speckle: u32,
    color_mode: &str,
) -> Result<String, JsValue> {
    fastrand::seed(1);
    let w = width as usize;
    let h = height as usize;
    
    let expected_len = w * h * 4;
    if rgba_data.len() != expected_len {
        return Err(JsValue::from_str(&format!(
            "RGBA 数据长度不匹配: 期望 {} 字节, 实际 {} 字节",
            expected_len, rgba_data.len()
        )));
    }
    
    let color_image = ColorImage {
        pixels: rgba_data.to_vec(),
        width: w,
        height: h,
    };
    
    let mode = match color_mode {
        "binary" => ColorMode::Binary,
        _ => ColorMode::Color,
    };
    
    let cfg = build_config(color_count, path_precision, corner_threshold, filter_speckle);
    
    let config = Config {
        color_mode: mode,
        hierarchical: Hierarchical::Stacked,
        filter_speckle: cfg.filter_speckle,
        color_precision: cfg.color_precision,
        layer_difference: cfg.layer_difference,
        corner_threshold: cfg.corner_threshold,
        length_threshold: cfg.length_threshold,
        max_iterations: cfg.max_iterations,
        splice_threshold: cfg.splice_threshold,
        path_precision: cfg.path_precision,
        ..Default::default()
    };
    
    let svg_file = vtracer::convert(color_image, config)
        .map_err(|e| JsValue::from_str(&format!("矢量化失败: {}", e)))?;
    
    let paths_str: String = svg_file.paths.iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    
    let svg_string = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {} {}">
{}
</svg>"#,
        w, h, paths_str
    );
    
    Ok(svg_string)
}

// ============================================================================
// 并行版本：使用 visioncortex 底层 API + Rayon
// ============================================================================

/// 并行矢量化：使用 Rayon 在曲线拟合阶段并行处理
/// 
/// 注意：此函数需要线程池已初始化 (initThreadPool)
#[wasm_bindgen]
pub fn trace_rgba_parallel(
    rgba_data: &[u8],
    width: u32,
    height: u32,
    color_count: u8,
    path_precision: u8,
    corner_threshold: u8,
    filter_speckle: u32,
) -> Result<String, JsValue> {
    fastrand::seed(1);
    let w = width as usize;
    let h = height as usize;
    
    let expected_len = w * h * 4;
    if rgba_data.len() != expected_len {
        return Err(JsValue::from_str(&format!(
            "RGBA 数据长度不匹配: 期望 {} 字节, 实际 {} 字节",
            expected_len, rgba_data.len()
        )));
    }
    
    let cfg = build_config(color_count, path_precision, corner_threshold, filter_speckle);
    
    // 创建 ColorImage (visioncortex 版本)
    let color_image = visioncortex::ColorImage {
        pixels: rgba_data.to_vec(),
        width: w,
        height: h,
    };
    
    // 第一阶段：层次聚类 (单线程，这部分难以并行化)
    let runner = Runner::new(
        RunnerConfig {
            diagonal: cfg.layer_difference == 0,
            hierarchical: HIERARCHICAL_MAX,
            batch_size: 25600,
            good_min_area: cfg.filter_speckle,
            good_max_area: w * h,
            // 注意：is_same_color_a 必须小于 8
            is_same_color_a: cfg.color_precision.min(7),
            is_same_color_b: 1,
            deepen_diff: cfg.layer_difference,
            hollow_neighbours: 1,
            key_color: Color::default(),
            keying_action: KeyingAction::Discard,
        },
        color_image,
    );
    
    let clusters = runner.run();
    let view = clusters.view();
    
    // 收集所有需要处理的 cluster 索引
    let cluster_indices: Vec<_> = view.clusters_output.iter().rev().copied().collect();
    
    // 第二阶段：曲线拟合 (并行处理！)
    // 每个 cluster 可以独立处理
    let path_results: Vec<_> = cluster_indices
        .par_iter()  // 🚀 使用 Rayon 并行迭代
        .filter_map(|&cluster_index| {
            let cluster = view.get_cluster(cluster_index);
            let paths = cluster.to_compound_path(
                &view,
                false,  // hole
                cfg.mode,
                cfg.corner_threshold as f64,
                cfg.length_threshold,
                cfg.max_iterations,
                cfg.splice_threshold as f64,
            );
            
            let color = cluster.residue_color();
            Some((paths, color))
        })
        .collect();
    
    // 构建 SVG 字符串 (使用 CompoundPath 的 to_svg_string 方法)
    let mut svg = String::with_capacity(1024 * 64);
    writeln!(svg, r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {} {}">"#, w, h).ok();
    
    for (compound_path, color) in path_results {
        let color_str = format!("#{:02x}{:02x}{:02x}", color.r, color.g, color.b);
        let (path_str, offset) = compound_path.to_svg_string(
            true,  // close path
            visioncortex::PointF64::default(),
            cfg.path_precision,
        );
        if !path_str.is_empty() {
            writeln!(
                svg, 
                r#"<path d="{}" fill="{}" transform="translate({:.2},{:.2})"/>"#,
                path_str, color_str, offset.x, offset.y
            ).ok();
        }
    }
    
    writeln!(svg, "</svg>").ok();
    
    Ok(svg)
}
