//! Rasterises a card to PNG.
//!
//! PNG, not SVG, and this is not a preference. Facebook, Slack, iMessage,
//! WhatsApp and Twitter all refuse an `og:image` served as `image/svg+xml`:
//! some ignore the tag, some show a broken thumbnail, none render the vector. A
//! card that is not a raster is not a card.
//!
//! `resvg` does the drawing, in process, with no image library and no shell out.
//! It needs fonts, and it will not find any unless something puts them in front
//! of it — a container has no fontconfig by default, and a missing font renders
//! as nothing at all rather than as a fallback. The image installs
//! `fonts-dejavu-core` for exactly this, which is also the font the static
//! `public/og-card.png` is rasterised with on the CI runner, so the two cards
//! set type identically.

use std::sync::{Arc, OnceLock};

use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg::{fontdb, Options, Tree};

use crate::card_svg::{CARD_HEIGHT, CARD_WIDTH};

// ============================================================================
// Types
// ============================================================================

#[derive(Debug)]
pub enum RenderError {
    /// The SVG this service generated will not parse. A bug here, never input.
    Parse(String),
    /// The pixel buffer could not be allocated or encoded.
    Raster(String),
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Parse(message) => write!(out, "card svg did not parse: {message}"),
            Self::Raster(message) => write!(out, "card did not rasterise: {message}"),
        }
    }
}

impl std::error::Error for RenderError {}

// ============================================================================
// Internal helpers
// ============================================================================

/// The font database, built once.
///
/// Scanning the system fonts takes tens of milliseconds and the result never
/// changes inside a container, so it happens on the first card and never again.
fn fonts() -> Arc<fontdb::Database> {
    static FONTS: OnceLock<Arc<fontdb::Database>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let mut database = fontdb::Database::new();
            database.load_system_fonts();
            if database.is_empty() {
                // Worth saying out loud: the cards will render blank, and a
                // blank card looks like a bug in the trip rather than a missing
                // package in the image.
                eprintln!("no fonts found — install fonts-dejavu-core in the image");
            }
            Arc::new(database)
        })
        .clone()
}

// ============================================================================
// Public API
// ============================================================================

/// SVG in, PNG out, at exactly 1200x630.
pub fn rasterise_card(svg: &str) -> Result<Vec<u8>, RenderError> {
    let mut options = Options {
        font_family: "DejaVu Sans".to_owned(),
        ..Options::default()
    };
    options.fontdb = fonts();

    let tree =
        Tree::from_str(svg, &options).map_err(|error| RenderError::Parse(error.to_string()))?;

    let mut pixmap = Pixmap::new(CARD_WIDTH, CARD_HEIGHT)
        .ok_or_else(|| RenderError::Raster("pixmap allocation failed".to_owned()))?;
    resvg::render(&tree, Transform::default(), &mut pixmap.as_mut());

    pixmap
        .encode_png()
        .map_err(|error| RenderError::Raster(error.to_string()))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card_svg::render_card_svg;
    use crate::i18n::Language;
    use crate::trip_preview::{PreviewGuest, PreviewStay, TripPreview};

    fn preview() -> TripPreview {
        TripPreview {
            name: "Summer house".to_owned(),
            start_date: "2026-08-12".to_owned(),
            end_date: "2026-08-18".to_owned(),
            room_count: 3,
            guests: vec![PreviewGuest {
                id: "g1".to_owned(),
                acronym: "AJ".to_owned(),
                color: "#c62828".to_owned(),
            }],
            stays: vec![PreviewStay {
                guest_id: "g1".to_owned(),
                room_name: "Master bedroom".to_owned(),
                start_date: "2026-08-12".to_owned(),
                end_date: "2026-08-18".to_owned(),
            }],
        }
    }

    #[test]
    fn renders_a_real_card_to_a_png_of_the_right_size() {
        let png = rasterise_card(&render_card_svg(&preview(), Language::Fr)).expect("a png");

        // The PNG signature, then the IHDR width and height as big-endian u32s.
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(
            u32::from_be_bytes([png[16], png[17], png[18], png[19]]),
            CARD_WIDTH
        );
        assert_eq!(
            u32::from_be_bytes([png[20], png[21], png[22], png[23]]),
            CARD_HEIGHT
        );
    }

    #[test]
    fn reports_a_broken_document_rather_than_panicking() {
        assert!(matches!(
            rasterise_card("<svg><not closed"),
            Err(RenderError::Parse(_))
        ));
    }
}

// ============================================================================
// Preview helper
// ============================================================================

/// Writes a sample card to a file, so the layout can be looked at.
///
/// `cargo test --features preview -- --ignored render_sample_card` when a
/// coordinate changes. It is ignored by default because nothing should write
/// to disk during an ordinary test run.
#[cfg(test)]
mod preview {
    use super::*;
    use crate::card_svg::render_card_svg;
    use crate::i18n::Language;
    use crate::trip_preview::{PreviewGuest, PreviewStay, TripPreview};

    fn guest(id: &str, acronym: &str, color: &str) -> PreviewGuest {
        PreviewGuest {
            id: id.to_owned(),
            acronym: acronym.to_owned(),
            color: color.to_owned(),
        }
    }

    fn stay(guest_id: &str, room: &str, start: &str, end: &str) -> PreviewStay {
        PreviewStay {
            guest_id: guest_id.to_owned(),
            room_name: room.to_owned(),
            start_date: start.to_owned(),
            end_date: end.to_owned(),
        }
    }

    #[test]
    #[ignore = "writes a file; run it by name when the layout changes"]
    fn render_sample_card() {
        let preview = TripPreview {
            name: "Summer house".to_owned(),
            start_date: "2026-08-12".to_owned(),
            end_date: "2026-08-18".to_owned(),
            room_count: 5,
            guests: vec![
                guest("g1", "A", "#c62828"),
                guest("g2", "T", "#1d4ed8"),
                guest("g3", "AJ", "#15803d"),
                guest("g4", "G", "#b45309"),
                guest("g5", "C", "#6d28d9"),
                guest("g6", "H", "#be185d"),
            ],
            stays: vec![
                stay("g1", "Master bedroom", "2026-08-12", "2026-08-18"),
                stay("g2", "Attic", "2026-08-12", "2026-08-15"),
                stay("g3", "Garden room · 2 people", "2026-08-13", "2026-08-18"),
                stay("g4", "Bunk room", "2026-08-14", "2026-08-16"),
                stay("g5", "Blue room", "2026-08-15", "2026-08-18"),
                stay("g6", "Sofa bed", "2026-08-13", "2026-08-14"),
            ],
        };

        let path = std::env::var("CARD_OUT").unwrap_or_else(|_| "sample-card.png".to_owned());
        let png = rasterise_card(&render_card_svg(&preview, Language::Fr)).expect("a png");
        std::fs::write(&path, png).expect("the sample card is written");
        println!("wrote {path}");
    }
}
