//! SnapSVG Core - WASM 矢量化引擎
//! 
//! 使用 vtracer 库将位图转换为 SVG 矢量图

use wasm_bindgen::prelude::*;
use vtracer::{Config, ColorMode, Hierarchical, ColorImage};

/// 初始化 panic hook，便于调试
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// 将图片字节数组转换为 SVG 字符串
/// 
/// # 参数
/// - `image_bytes`: 图片的原始字节数据 (PNG/JPEG/WEBP 等格式)
/// - `color_count`: 颜色数量 (2-64)
/// - `path_precision`: 路径精度 (1-10，数值越高越精细)
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
    
    // 使用默认配置并覆盖需要修改的字段
    let config = Config {
        color_mode: mode,
        hierarchical: Hierarchical::Stacked,
        filter_speckle: filter_speckle as usize,
        color_precision: color_count.min(64).max(2) as i32,
        layer_difference: 16,
        corner_threshold: corner_threshold as i32,
        length_threshold: 4.0,
        max_iterations: 10,
        splice_threshold: 45,
        path_precision: Some(path_precision as u32),
        ..Default::default()
    };
    
    // 5. 执行矢量化
    let svg_file = vtracer::convert(color_image, config)
        .map_err(|e| JsValue::from_str(&format!("矢量化失败: {}", e)))?;
    
    // 6. 构建 SVG 字符串
    // SvgPath 实现了 Display trait，可以直接格式化为 <path> 元素
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

/// 获取版本信息
#[wasm_bindgen]
pub fn get_version() -> String {
    format!("snapsvg-core v{}", env!("CARGO_PKG_VERSION"))
}
