//! Translated cover: the model reads the text printed on the original cover
//! (one vision call, cached per project) and the app draws a new cover — the
//! original art, a dark band at the bottom with the pt-BR title, and a "PT-BR"
//! badge. Sign in with ChatGPT cannot generate or edit images, so the art itself
//! is never changed.

use std::io::Cursor;

use ab_glyph::{point, Font, FontRef, PxScale, ScaleFont};
use base64::Engine as _;
use image::{imageops::FilterType, DynamicImage, GenericImageView, ImageFormat, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::pipeline::clean_output;

static FONT_BYTES: &[u8] = include_bytes!("../../assets/Inter-Bold.ttf");

/// Teal brand accent (`--accent` #00796b).
const ACCENT: [u8; 3] = [0x00, 0x79, 0x6b];

pub const COVER_INSTRUCTIONS: &str =
    "You read book covers for a translation app. Reply with a single JSON object only: no commentary, no code fences.";

pub const COVER_PROMPT: &str = r#"Read the text printed on this book cover (title, subtitle; ignore author names, publisher logos and small print).
Translate the title (and subtitle, if any) into natural Brazilian Portuguese (pt-BR), the way a published translation would title it. Keep proper names.
If the cover title is already in Portuguese, set "already_portuguese": true and copy it unchanged.
If there is no readable title text, set "has_text": false.
Reply exactly as: {"title_original": "...", "title_pt": "...", "subtitle_pt": null, "has_text": true, "already_portuguese": false}"#;

/// What the model read on the cover (cached in `projects.cover_text_json`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoverText {
    #[serde(default)]
    pub title_original: Option<String>,
    #[serde(default)]
    pub title_pt: Option<String>,
    #[serde(default)]
    pub subtitle_pt: Option<String>,
    #[serde(default = "yes")]
    pub has_text: bool,
    #[serde(default)]
    pub already_portuguese: bool,
}

fn yes() -> bool {
    true
}

impl CoverText {
    /// The title to print on the band, if the cover needs one.
    pub fn band_title(&self) -> Option<&str> {
        if !self.has_text || self.already_portuguese {
            return None;
        }
        self.title_pt.as_deref().map(str::trim).filter(|t| !t.is_empty())
    }
}

/// Lenient parse of the model reply (first JSON object).
pub fn parse_cover_text(text: &str) -> Result<CoverText, String> {
    let cleaned = clean_output(text);
    let start = cleaned.find('{').ok_or("resposta sem JSON")?;
    let end = cleaned.rfind('}').ok_or("resposta sem JSON")?;
    let value: Value = serde_json::from_str(&cleaned[start..=end]).map_err(|_| "JSON da capa inválido")?;
    let mut cover: CoverText = serde_json::from_value(value).map_err(|_| "JSON da capa inválido")?;
    let blank = |s: &Option<String>| s.as_deref().map(str::trim).filter(|t| !t.is_empty()).map(str::to_string);
    cover.title_original = blank(&cover.title_original);
    cover.title_pt = blank(&cover.title_pt);
    cover.subtitle_pt = blank(&cover.subtitle_pt);
    if cover.title_pt.is_none() {
        cover.has_text = false;
    }
    Ok(cover)
}

/// The cover as a small JPEG data URL for the vision request (longest side 768 px).
pub fn cover_data_url(bytes: &[u8]) -> Result<String, String> {
    let image = image::load_from_memory(bytes).map_err(|e| format!("capa ilegível: {e}"))?;
    let (w, h) = image.dimensions();
    let image = if w.max(h) > 768 { image.resize(768, 768, FilterType::Triangle) } else { image };
    let mut out = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(image.to_rgb8())
        .write_to(&mut out, ImageFormat::Jpeg)
        .map_err(|e| format!("falha ao preparar a capa: {e}"))?;
    Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.into_inner())))
}

fn font() -> FontRef<'static> {
    FontRef::try_from_slice(FONT_BYTES).expect("embedded font is valid")
}

fn text_width(font: &FontRef<'_>, scale: PxScale, text: &str) -> f32 {
    let scaled = font.as_scaled(scale);
    let mut width = 0.0;
    let mut previous = None;
    for ch in text.chars() {
        let id = scaled.glyph_id(ch);
        if let Some(prev) = previous {
            width += scaled.kern(prev, id);
        }
        width += scaled.h_advance(id);
        previous = Some(id);
    }
    width
}

/// Greedy word wrap; `None` if a single word does not fit.
fn wrap(font: &FontRef<'_>, scale: PxScale, text: &str, max_width: f32) -> Option<Vec<String>> {
    let mut lines: Vec<String> = Vec::new();
    let mut line = String::new();
    for word in text.split_whitespace() {
        let candidate = if line.is_empty() { word.to_string() } else { format!("{line} {word}") };
        if text_width(font, scale, &candidate) <= max_width {
            line = candidate;
        } else {
            if line.is_empty() || text_width(font, scale, word) > max_width {
                return None;
            }
            lines.push(std::mem::replace(&mut line, word.to_string()));
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    Some(lines)
}

fn blend(px: &mut Rgba<u8>, color: [u8; 3], alpha: f32) {
    let a = alpha.clamp(0.0, 1.0);
    for i in 0..3 {
        px[i] = (px[i] as f32 * (1.0 - a) + color[i] as f32 * a).round() as u8;
    }
}

fn draw_text(img: &mut RgbaImage, font: &FontRef<'_>, scale: PxScale, x: f32, baseline: f32, text: &str, color: [u8; 3]) {
    let scaled = font.as_scaled(scale);
    let mut caret = x;
    let mut previous = None;
    for ch in text.chars() {
        let id = scaled.glyph_id(ch);
        if let Some(prev) = previous {
            caret += scaled.kern(prev, id);
        }
        let glyph = id.with_scale_and_position(scale, point(caret, baseline));
        caret += scaled.h_advance(id);
        previous = Some(id);
        if let Some(outlined) = font.outline_glyph(glyph) {
            let bounds = outlined.px_bounds();
            outlined.draw(|gx, gy, coverage| {
                let px = bounds.min.x as i32 + gx as i32;
                let py = bounds.min.y as i32 + gy as i32;
                if px >= 0 && py >= 0 && (px as u32) < img.width() && (py as u32) < img.height() {
                    blend(img.get_pixel_mut(px as u32, py as u32), color, coverage);
                }
            });
        }
    }
}

fn fill_rect(img: &mut RgbaImage, x0: u32, y0: u32, x1: u32, y1: u32, color: [u8; 3], alpha: f32) {
    for y in y0..y1.min(img.height()) {
        for x in x0..x1.min(img.width()) {
            blend(img.get_pixel_mut(x, y), color, alpha);
        }
    }
}

/// Draws the translated cover: original art + (optional) bottom band with the
/// pt-BR title + a "PT-BR" badge. Returns JPEG bytes at the original size.
pub fn render_cover(original: &[u8], title: Option<&str>, subtitle: Option<&str>) -> Result<Vec<u8>, String> {
    let source = image::load_from_memory(original).map_err(|e| format!("capa ilegível: {e}"))?;
    let mut img = source.to_rgba8();
    let (w, h) = img.dimensions();
    let unit = w.min(h) as f32;
    let font = font();
    let margin = (unit * 0.06).round();

    if let Some(title) = title {
        // Fit the title in up to 3 lines, shrinking from ~8% to ~4% of the width.
        let max_width = w as f32 - 2.0 * margin;
        let mut size = unit * 0.085;
        let mut lines = vec![title.to_string()];
        while size > unit * 0.04 {
            if let Some(found) = wrap(&font, PxScale::from(size), title, max_width) {
                if found.len() <= 3 {
                    lines = found;
                    break;
                }
            }
            size *= 0.92;
        }
        let scale = PxScale::from(size);
        let line_h = size * 1.18;
        let sub_size = size * 0.55;
        let sub_lines = subtitle
            .and_then(|s| wrap(&font, PxScale::from(sub_size), s, max_width))
            .map(|mut l| {
                l.truncate(2);
                l
            })
            .unwrap_or_default();
        let text_h = line_h * lines.len() as f32 + sub_size * 1.3 * sub_lines.len() as f32;
        let band_h = (text_h + margin * 2.2).min(h as f32 * 0.45);
        let band_top = h as f32 - band_h;
        // Soft fade above the band, then a solid-ish dark band.
        let fade = margin * 1.5;
        let fade_top = (band_top - fade).max(0.0) as u32;
        for y in fade_top..band_top as u32 {
            let t = (y as f32 - fade_top as f32) / fade.max(1.0);
            fill_rect(&mut img, 0, y, w, y + 1, [10, 12, 14], 0.86 * t);
        }
        fill_rect(&mut img, 0, band_top as u32, w, h, [10, 12, 14], 0.86);
        // Accent rule on top of the band.
        let rule_h = (unit * 0.006).max(2.0) as u32;
        fill_rect(&mut img, margin as u32, band_top as u32 + (margin * 0.6) as u32, margin as u32 + (unit * 0.18) as u32, band_top as u32 + (margin * 0.6) as u32 + rule_h, ACCENT, 1.0);

        let ascent = font.as_scaled(scale).ascent();
        let mut y = band_top + margin * 1.05 + ascent;
        for line in &lines {
            draw_text(&mut img, &font, scale, margin, y, line, [245, 246, 248]);
            y += line_h;
        }
        let sub_scale = PxScale::from(sub_size);
        for line in &sub_lines {
            draw_text(&mut img, &font, sub_scale, margin, y - line_h + sub_size * 1.4, line, [200, 204, 210]);
            y += sub_size * 1.3;
        }
    }

    // "PT-BR" badge, top-left.
    let badge_size = unit * 0.05;
    let badge_scale = PxScale::from(badge_size);
    let pad = badge_size * 0.45;
    let label = "PT-BR";
    let bw = text_width(&font, badge_scale, label) + pad * 2.0;
    let bh = badge_size * 1.55;
    let bx = margin * 0.6;
    let by = margin * 0.6;
    fill_rect(&mut img, bx as u32, by as u32, (bx + bw) as u32, (by + bh) as u32, ACCENT, 0.95);
    let baseline = by + (bh + font.as_scaled(badge_scale).ascent() - font.as_scaled(badge_scale).descent().abs()) / 2.0;
    draw_text(&mut img, &font, badge_scale, bx + pad, baseline, label, [255, 255, 255]);

    let mut out = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(DynamicImage::ImageRgba8(img).to_rgb8())
        .write_to(&mut out, ImageFormat::Jpeg)
        .map_err(|e| format!("falha ao gerar a capa: {e}"))?;
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_png(w: u32, h: u32) -> Vec<u8> {
        let img = RgbaImage::from_fn(w, h, |x, y| Rgba([(x % 255) as u8, (y % 255) as u8, 180, 255]));
        let mut out = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(img).write_to(&mut out, ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn parses_cover_text_leniently() {
        let text = parse_cover_text("```json\n{\"title_original\":\"A Monster Who Levels Up\",\"title_pt\":\"Um Monstro que Sobe de Nível\",\"subtitle_pt\":\"\",\"has_text\":true}\n```").unwrap();
        assert_eq!(text.band_title(), Some("Um Monstro que Sobe de Nível"));
        assert!(text.subtitle_pt.is_none());
        let pt = parse_cover_text("{\"title_original\":\"Um Monstro que Upa\",\"title_pt\":\"Um Monstro que Upa\",\"already_portuguese\":true}").unwrap();
        assert_eq!(pt.band_title(), None, "already Portuguese covers get no band");
        let none = parse_cover_text("{\"has_text\": false}").unwrap();
        assert_eq!(none.band_title(), None);
        assert!(parse_cover_text("nada").is_err());
    }

    #[test]
    fn renders_a_jpeg_of_the_same_size_with_a_dark_band() {
        let png = sample_png(400, 600);
        let out = render_cover(&png, Some("Um Monstro que Sobe de Nível e Outras Histórias Longas"), Some("Volume 1")).unwrap();
        let img = image::load_from_memory_with_format(&out, ImageFormat::Jpeg).unwrap();
        assert_eq!(img.dimensions(), (400, 600));
        // The bottom band is dark, the middle keeps the art.
        let rgb = img.to_rgb8();
        let bottom = rgb.get_pixel(390, 595);
        let middle = rgb.get_pixel(200, 200);
        assert!(bottom.0.iter().map(|&c| c as u32).sum::<u32>() < middle.0.iter().map(|&c| c as u32).sum::<u32>());
        // Badge only (no title) keeps the bottom untouched.
        let badge_only = render_cover(&png, None, None).unwrap();
        let img = image::load_from_memory(&badge_only).unwrap().to_rgb8();
        assert!(img.get_pixel(395, 595).0[2] > 120);
    }

    #[test]
    fn data_url_is_small_jpeg() {
        let url = cover_data_url(&sample_png(1600, 2400)).unwrap();
        assert!(url.starts_with("data:image/jpeg;base64,"));
        let bytes = base64::engine::general_purpose::STANDARD.decode(&url["data:image/jpeg;base64,".len()..]).unwrap();
        let img = image::load_from_memory(&bytes).unwrap();
        assert_eq!(img.dimensions().1, 768);
    }

    /// Manual visual check: OGHMA_COVER_IN=cover.png OGHMA_COVER_OUT=/tmp/x.jpg cargo test render_real -- --ignored
    #[test]
    #[ignore]
    fn render_real_cover() {
        let input = std::env::var("OGHMA_COVER_IN").unwrap();
        let output = std::env::var("OGHMA_COVER_OUT").unwrap();
        let title = std::env::var("OGHMA_COVER_TITLE").unwrap_or_else(|_| "Um Monstro que Sobe de Nível".into());
        let out = render_cover(&std::fs::read(input).unwrap(), Some(&title), None).unwrap();
        std::fs::write(output, out).unwrap();
    }
}
