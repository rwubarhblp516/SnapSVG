//! SnapSVG Core - WASM 矢量化引擎
//! 
//! 使用 vtracer 库将位图转换为 SVG 矢量图

use wasm_bindgen::prelude::*;
use vtracer::{Config, ColorMode, Hierarchical, ColorImage};
use fastrand;

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

/// 将图片字节数组转换为 SVG 字符串
/// 
/// # 参数
/// - `image_bytes`: 图片的原始字节数据 (PNG/JPEG/WEBP 等格式)
/// - `color_count`: 颜色数量 (2-64)
/// - `path_precision`: 路径精度 (1-100)
/// - `corner_threshold`: 角点阈值 (0-180度)
/// - `filter_speckle`: 噪点过滤阈值 (像素面积)
/// - `color_mode`: 颜色模式 ("color", "binary")
/// 
/// # 返回
/// SVG 字符串，失败时返回错误信息
#[wasm_bindgen]
pub fn trace_image_to_svg(
    image_bytes: &[u8],
    color_count: u8,
    path_precision: u8,
    corner_threshold: u8,
    filter_speckle: u32,
    color_mode: &str,
) -> Result<String, JsValue> {
    // Stabilize any internal randomness for repeatable outputs.
    fastrand::seed(1);
    // 1. 解析图片
    let img = image::load_from_memory(image_bytes)
        .map_err(|e| JsValue::from_str(&format!("图片解析失败: {}", e)))?;
    
    let width = img.width() as usize;
    let height = img.height() as usize;
    
    // 2. 转换为 RGBA 像素数据
    let rgba = img.to_rgba8();
    let pixels: Vec<u8> = rgba.into_raw();
    
    // 3. 创建 ColorImage
    let color_image = ColorImage {
        pixels,
        width,
        height,
    };
    
    // 4. 配置 vtracer 参数
    let mode = match color_mode {
        "binary" => ColorMode::Binary,
        _ => ColorMode::Color,
    };
    
    // 颜色参数映射
    let color_count_clamped = color_count.max(2).min(64) as i32;
    let precision = 8;
    
    let layer_diff = if color_count_clamped <= 8 {
        16 - (color_count_clamped - 2)
    } else if color_count_clamped <= 24 {
        10 - (color_count_clamped - 9) / 3
    } else {
        4
    };
    
    let config = Config {
        color_mode: mode,
        hierarchical: Hierarchical::Stacked,
        filter_speckle: filter_speckle as usize,
        color_precision: precision,
        layer_difference: layer_diff.max(4).min(16),
        corner_threshold: corner_threshold as i32,
        length_threshold: 4.0,
        max_iterations: 10,
        // 将 path_precision (0-100) 映射到 splice_threshold (130-15)
        // 数值越高精度越高，意味着合并阈值越低
        splice_threshold: (125 - (path_precision as i32 * 110 / 100)).max(10).min(135),
        path_precision: Some(2), // 默认保持 2 位小数
        ..Default::default()
    };
    
    // 5. 执行矢量化
    let svg_file = vtracer::convert(color_image, config)
        .map_err(|e| JsValue::from_str(&format!("矢量化失败: {}", e)))?;
    
    // 6. 构建 SVG 字符串
    let paths_str: String = svg_file.paths.iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    
    let svg_string = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {} {}">
{}
</svg>"#,
        width,
        height,
        paths_str
    );
    
    Ok(svg_string)
}

/// 高性能版本：直接接收 RGBA 像素数据
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
    
    let color_count_clamped = color_count.max(2).min(64) as i32;
    let precision = 8;
    
    let layer_diff = if color_count_clamped <= 8 {
        16 - (color_count_clamped - 2)
    } else if color_count_clamped <= 24 {
        10 - (color_count_clamped - 9) / 3
    } else {
        4
    };
    
    let config = Config {
        color_mode: mode,
        hierarchical: Hierarchical::Stacked,
        filter_speckle: filter_speckle as usize,
        color_precision: precision,
        layer_difference: layer_diff.max(4).min(16),
        corner_threshold: corner_threshold as i32,
        length_threshold: 4.0,
        max_iterations: 10,
        splice_threshold: (125 - (path_precision as i32 * 110 / 100)).max(10).min(135),
        path_precision: Some(2),
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
        w,
        h,
        paths_str
    );
    
    Ok(svg_string)
}

/// 获取版本信息
#[wasm_bindgen]
pub fn get_version() -> String {
    format!("snapsvg-core v{}", env!("CARGO_PKG_VERSION"))
}
