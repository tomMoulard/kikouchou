//! Draws one trip as the 1200x630 card a chat window shows.
//!
//! This is `public/og-card.svg` made dynamic. That file is the landing page hero
//! redrawn at the aspect every consumer of `og:image` is built around, and it is
//! the reference for every coordinate, colour and font size below: white
//! surface, slate text, teal accent, the two blurred glows, the 64px grid behind
//! the header, and an app window whose rows are guests and whose columns are
//! days. Someone who saw the site recognises the card; someone who saw the
//! generic card recognises this one as the same card with their own trip in it.
//!
//! Two things differ from the static file, both deliberately.
//!
//! **Rows carry acronyms, not names.** `AJ`, not `Alice + Julie`. The reasoning
//! is in [`crate::trip_preview`]: a card is fetched and cached by every link
//! scanner that sees the URL, and a guest list is not the sharer's to publish.
//!
//! **The layout is measured, not hand-placed.** The static file can put each
//! string at a coordinate somebody checked by eye. A trip has between one and
//! many guests over between one and many days, so the columns are computed and
//! every string is truncated against an estimate of its own width. That estimate
//! is approximate on purpose — see [`text_width`] — and every use of it leaves
//! room to be wrong.

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;

use crate::dates::{date_range, day_count, format_date_span, format_day_label};
use crate::i18n::Language;
use crate::trip_preview::TripPreview;

// ============================================================================
// Constants
// ============================================================================

/// What every `og:image` consumer crops to: 1.91:1.
pub const CARD_WIDTH: u32 = 1200;
pub const CARD_HEIGHT: u32 = 630;

/// The occupancy grid, in the coordinates `public/og-card.svg` uses.
const GRID_LEFT: f64 = 306.0;
const GRID_WIDTH: f64 = 809.0;
const GRID_TOP: f64 = 278.0;
const ROW_STEP: f64 = 42.0;
const ROW_HEIGHT: f64 = 36.0;
/// Gap between two day cells, so a run of nights reads as one bar.
const COLUMN_GAP: f64 = 3.0;

/// Rows and columns the window holds at the sizes above.
///
/// Six rows is what fits between the day axis and the footer rule. Eight columns
/// is where a day cell stops being wide enough for a room name — past that the
/// card shows the first eight and says "+N more days", which for a fortnight in
/// a house is the half of the trip somebody is deciding about.
const MAX_ROWS: usize = 6;
const MAX_COLUMNS: usize = 8;

/// Landing page tokens. Named here so the card and the site cannot drift.
const INK: &str = "#0f172a";
const MUTED: &str = "#55637a";
const SUBTLE: &str = "#64748b";
const TEAL: &str = "#0f766e";
const TEAL_TINT: &str = "#e6f6f4";
const SURFACE: &str = "#f8fafc";
const BORDER: &str = "#e2e8f0";
const EMPTY_CELL: &str = "#f1f5f9";
const WARN_TINT: &str = "#fdead9";
const WARN_INK: &str = "#9a4a05";

/// DejaVu first, because that is the font the image has. See the Dockerfile.
const FONT_STACK: &str = "DejaVu Sans, Inter, Helvetica, Arial, sans-serif";

// ============================================================================
// Internal helpers
// ============================================================================

/// XML-escapes text. Every string on this card was typed by somebody.
fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(character),
        }
    }
    out
}

/// Rough width of a string, in pixels.
///
/// There is no font metric to measure against here: the point of the font stack
/// is that a substitution is survivable. 0.56em per character is measured
/// against DejaVu Sans Bold across the Latin alphabet, and is close enough to
/// decide whether a room name fits inside a bar. Everything that uses it leaves
/// slack, and nothing is centred on it.
fn text_width(value: &str, font_size: f64) -> f64 {
    value.chars().count() as f64 * font_size * 0.56
}

/// Trims to fit, with an ellipsis, or gives back `""` when nothing fits.
fn truncate(value: &str, font_size: f64, max_width: f64) -> String {
    if text_width(value, font_size) <= max_width {
        return value.to_owned();
    }
    let mut characters: Vec<char> = value.chars().collect();
    while !characters.is_empty() {
        characters.pop();
        let candidate = format!("{}…", characters.iter().collect::<String>().trim_end());
        if text_width(&candidate, font_size) <= max_width {
            return candidate;
        }
    }
    String::new()
}

/// A number, printed short: `306` rather than `306.00000000000006`.
fn coord(value: f64) -> String {
    format!("{:.2}", value)
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_owned()
}

#[derive(Clone, Copy, Default)]
enum Anchor {
    #[default]
    Start,
    Middle,
    End,
}

impl Anchor {
    fn attribute(self) -> &'static str {
        match self {
            Self::Start => "",
            Self::Middle => r#" text-anchor="middle""#,
            Self::End => r#" text-anchor="end""#,
        }
    }
}

/// How a string is set. Grouped into one value rather than five arguments, so a
/// call site reads as a sentence and a colour cannot be passed where a size was
/// meant.
#[derive(Clone, Copy)]
struct Type<'a> {
    size: f64,
    fill: &'a str,
    weight: Option<u32>,
    anchor: Anchor,
}

impl<'a> Type<'a> {
    /// The card's ordinary label: semi-bold, left aligned.
    fn label(size: f64, fill: &'a str) -> Self {
        Self {
            size,
            fill,
            weight: Some(600),
            anchor: Anchor::Start,
        }
    }

    fn weight(self, weight: u32) -> Self {
        Self {
            weight: Some(weight),
            ..self
        }
    }

    fn plain(self) -> Self {
        Self {
            weight: None,
            ..self
        }
    }

    fn anchor(self, anchor: Anchor) -> Self {
        Self { anchor, ..self }
    }
}

/// How a box is filled: colour, corner radius, and an optional hairline border.
#[derive(Clone, Copy)]
struct Box_<'a> {
    fill: &'a str,
    radius: f64,
    stroke: Option<&'a str>,
}

impl<'a> Box_<'a> {
    fn new(fill: &'a str) -> Self {
        Self {
            fill,
            radius: 0.0,
            stroke: None,
        }
    }

    fn round(self, radius: f64) -> Self {
        Self { radius, ..self }
    }

    fn bordered(self, stroke: &'a str) -> Self {
        Self {
            stroke: Some(stroke),
            ..self
        }
    }
}

fn text(out: &mut String, x: f64, y: f64, value: &str, style: Type<'_>) {
    if value.is_empty() {
        return;
    }
    let weight = style.weight.map_or(String::new(), |weight| {
        format!(r#" font-weight="{weight}""#)
    });
    let _ = write!(
        out,
        r#"<text x="{}" y="{}" fill="{}" font-size="{}"{weight}{}>{}</text>"#,
        coord(x),
        coord(y),
        style.fill,
        coord(style.size),
        style.anchor.attribute(),
        escape(value),
    );
}

fn rect(out: &mut String, x: f64, y: f64, width: f64, height: f64, style: Box_<'_>) {
    let radius = if style.radius == 0.0 {
        String::new()
    } else {
        format!(r#" rx="{}""#, coord(style.radius))
    };
    let stroke = style.stroke.map_or(String::new(), |stroke| {
        format!(r#" stroke="{stroke}" stroke-width="1""#)
    });
    let _ = write!(
        out,
        r#"<rect x="{}" y="{}" width="{}" height="{}"{radius} fill="{}"{stroke}/>"#,
        coord(x),
        coord(y),
        coord(width),
        coord(height),
        style.fill,
    );
}

/// A rounded pill with centred text, the shape the hero uses for its counts.
fn chip(out: &mut String, x: f64, y: f64, width: f64, label: &str, style: Box_<'_>, color: &str) {
    rect(out, x, y, width, 32.0, style.round(16.0));
    text(
        out,
        x + width / 2.0,
        y + 22.0,
        &truncate(label, 18.0, width - 24.0),
        Type::label(18.0, color).anchor(Anchor::Middle),
    );
}

/// Width for a chip that hugs its label.
fn chip_width(label: &str) -> f64 {
    text_width(label, 18.0).round() + 36.0
}

// ============================================================================
// Public API
// ============================================================================

/// Renders the card for one trip, as a complete SVG document.
pub fn render_card_svg(preview: &TripPreview, language: Language) -> String {
    let days = date_range(&preview.start_date, &preview.end_date, MAX_COLUMNS);
    let total_days = day_count(&preview.start_date, &preview.end_date);
    let hidden_days = total_days.saturating_sub(days.len());
    let guests = &preview.guests[..preview.guests.len().min(MAX_ROWS)];
    let hidden_guests = preview.guests.len() - guests.len();

    let column_step = if days.is_empty() {
        GRID_WIDTH
    } else {
        GRID_WIDTH / days.len() as f64
    };
    let day_index: HashMap<&str, usize> = days
        .iter()
        .enumerate()
        .map(|(index, day)| (day.as_str(), index))
        .collect();

    let mut body = String::with_capacity(8192);

    // --- Background: white, the two hero glows, and the header grid. --------
    let _ = write!(
        body,
        r##"<rect width="{CARD_WIDTH}" height="{CARD_HEIGHT}" fill="#ffffff"/>"##
    );
    let _ = write!(
        body,
        r#"<rect width="{CARD_WIDTH}" height="{CARD_HEIGHT}" fill="url(#glowTeal)"/>"#
    );
    let _ = write!(
        body,
        r#"<rect width="{CARD_WIDTH}" height="{CARD_HEIGHT}" fill="url(#glowIndigo)"/>"#
    );

    let _ = write!(
        body,
        r#"<g stroke="{INK}" stroke-opacity="0.05" stroke-width="1">"#
    );
    let mut x = 64;
    while x < CARD_WIDTH {
        let _ = write!(body, r#"<line x1="{x}" y1="0" x2="{x}" y2="256"/>"#);
        x += 64;
    }
    for y in [64, 128, 192] {
        let _ = write!(
            body,
            r#"<line x1="0" y1="{y}" x2="{CARD_WIDTH}" y2="{y}"/>"#
        );
    }
    body.push_str("</g>");

    // --- Header: wordmark, headline, and where this card came from. ---------
    text(
        &mut body,
        56.0,
        62.0,
        "Kikouchou",
        Type::label(34.0, INK).weight(700),
    );
    text(
        &mut body,
        1144.0,
        62.0,
        "app.kikouchou.app",
        Type::label(22.0, TEAL).anchor(Anchor::End),
    );
    text(
        &mut body,
        56.0,
        104.0,
        language.headline(),
        Type::label(28.0, MUTED).plain(),
    );

    // --- The app window. ----------------------------------------------------
    let _ = write!(
        body,
        r#"<rect x="76" y="158" width="1048" height="448" rx="24" fill="{INK}" fill-opacity="0.16" filter="url(#cardShadow)"/>"#
    );
    rect(
        &mut body,
        56.0,
        136.0,
        1088.0,
        458.0,
        Box_::new("#ffffff").round(20.0).bordered(BORDER),
    );
    // The second rect squares off the bottom corners the first one rounded, so
    // only the top of the title bar is round.
    rect(
        &mut body,
        57.0,
        137.0,
        1086.0,
        51.0,
        Box_::new(SURFACE).round(19.0),
    );
    rect(&mut body, 57.0, 166.0, 1086.0, 22.0, Box_::new(SURFACE));
    let _ = write!(
        body,
        r#"<line x1="56" y1="188" x2="1144" y2="188" stroke="{BORDER}" stroke-width="1"/>"#
    );
    let _ = write!(
        body,
        r##"<g fill="#cbd5e1"><circle cx="84" cy="162" r="5.5"/><circle cx="102" cy="162" r="5.5"/><circle cx="120" cy="162" r="5.5"/></g>"##
    );

    let span = format_date_span(&preview.start_date, &preview.end_date, language);
    let window_title = [preview.name.as_str(), span.as_str(), language.timeline()]
        .into_iter()
        .filter(|piece| !piece.is_empty())
        .collect::<Vec<_>>()
        .join(" · ");
    text(
        &mut body,
        148.0,
        169.0,
        &truncate(&window_title, 19.0, 980.0),
        Type::label(19.0, SUBTLE),
    );

    // --- The two counts above the grid. -------------------------------------
    let guest_label = language.guests(preview.guests.len());
    let night_label = language.nights(total_days.saturating_sub(1));
    let room_label = language.rooms(preview.room_count);

    chip(
        &mut body,
        84.0,
        208.0,
        chip_width(&guest_label).max(196.0),
        &guest_label,
        Box_::new(TEAL_TINT),
        TEAL,
    );

    let right_label = format!("{night_label} · {room_label}");
    let right_width = chip_width(&right_label).max(166.0);
    chip(
        &mut body,
        1116.0 - right_width,
        208.0,
        right_width,
        &right_label,
        Box_::new(SURFACE).bordered(BORDER),
        MUTED,
    );

    // --- Day axis. ----------------------------------------------------------
    for (index, day) in days.iter().enumerate() {
        text(
            &mut body,
            GRID_LEFT + column_step * index as f64 + (column_step - COLUMN_GAP) / 2.0,
            266.0,
            &truncate(&format_day_label(day, language), 17.0, column_step - 8.0),
            Type::label(17.0, SUBTLE).anchor(Anchor::Middle),
        );
    }

    // --- Rows: an acronym, the empty nights, then the bars. -----------------
    let mut bars_by_guest: HashMap<&str, Vec<(usize, usize, &str)>> = HashMap::new();
    let last_day = days.last().map(String::as_str).unwrap_or("");
    let first_day = days.first().map(String::as_str).unwrap_or("");
    for stay in &preview.stays {
        // A stay that starts before the first drawn day still shows, clipped to
        // the window; one lying entirely past it does not.
        let from = day_index
            .get(stay.start_date.as_str())
            .copied()
            .or_else(|| (stay.start_date.as_str() < first_day).then_some(0));
        let to = day_index
            .get(stay.end_date.as_str())
            .copied()
            .or_else(|| (stay.end_date.as_str() > last_day).then(|| days.len().saturating_sub(1)));
        let (Some(from), Some(to)) = (from, to) else {
            continue;
        };
        if to < from || days.is_empty() {
            continue;
        }
        bars_by_guest
            .entry(stay.guest_id.as_str())
            .or_default()
            .push((from, to, stay.room_name.as_str()));
    }

    for (row, guest) in guests.iter().enumerate() {
        let y = GRID_TOP + ROW_STEP * row as f64;
        let mut bars = bars_by_guest
            .get(guest.id.as_str())
            .cloned()
            .unwrap_or_default();
        bars.sort_by_key(|(from, _, _)| *from);

        let covered: HashSet<usize> = bars.iter().flat_map(|(from, to, _)| *from..=*to).collect();

        // Empty nights first, so a bar always draws over them.
        for column in 0..days.len() {
            if !covered.contains(&column) {
                rect(
                    &mut body,
                    GRID_LEFT + column_step * column as f64,
                    y,
                    column_step - COLUMN_GAP,
                    ROW_HEIGHT,
                    Box_::new(EMPTY_CELL).round(6.0),
                );
            }
        }

        for (from, to, room) in bars {
            let x = GRID_LEFT + column_step * from as f64;
            let width = column_step * (to - from + 1) as f64 - COLUMN_GAP;
            rect(
                &mut body,
                x,
                y,
                width,
                ROW_HEIGHT,
                Box_::new(&guest.color).round(6.0),
            );
            text(
                &mut body,
                x + 14.0,
                y + 24.0,
                &truncate(room, 18.0, width - 28.0),
                Type::label(18.0, "#ffffff"),
            );
        }

        let _ = write!(
            body,
            r#"<circle cx="90" cy="{}" r="6" fill="{}"/>"#,
            coord(y + 18.0),
            guest.color
        );
        text(
            &mut body,
            108.0,
            y + 25.0,
            &truncate(&guest.acronym, 20.0, 180.0),
            Type::label(20.0, INK),
        );
    }

    // Nothing to draw: say so rather than leaving a blank window, which reads
    // as a broken card rather than as an empty trip.
    if guests.is_empty() || preview.stays.is_empty() {
        text(
            &mut body,
            GRID_LEFT + GRID_WIDTH / 2.0,
            GRID_TOP + 100.0,
            language.no_rooms_yet(),
            Type::label(22.0, SUBTLE).anchor(Anchor::Middle),
        );
    }

    // --- Footer: what the app is, and what the card had to leave out. -------
    let _ = write!(
        body,
        r#"<line x1="84" y1="540" x2="1116" y2="540" stroke="{BORDER}" stroke-width="1" stroke-dasharray="6 5"/>"#
    );

    let mut footer_right = 1116.0;
    for label in [
        (hidden_guests > 0).then(|| language.more_guests(hidden_guests)),
        (hidden_days > 0).then(|| language.more_days(hidden_days)),
    ]
    .into_iter()
    .flatten()
    {
        let width = chip_width(&label);
        footer_right -= width;
        chip(
            &mut body,
            footer_right,
            552.0,
            width,
            &label,
            Box_::new(WARN_TINT),
            WARN_INK,
        );
        footer_right -= 12.0;
    }

    // 17px rather than the 18 the chips use: the French sentence is 106
    // characters and it has to fit beside whatever overflow chips are there.
    text(
        &mut body,
        84.0,
        574.0,
        &truncate(language.description(), 17.0, footer_right - 96.0),
        Type::label(17.0, MUTED),
    );

    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{CARD_WIDTH}" height="{CARD_HEIGHT}" viewBox="0 0 {CARD_WIDTH} {CARD_HEIGHT}" font-family="{FONT_STACK}"><defs><radialGradient id="glowTeal" gradientUnits="userSpaceOnUse" cx="264" cy="76" r="520"><stop offset="0" stop-color="#14b8a6" stop-opacity="0.22"/><stop offset="1" stop-color="#14b8a6" stop-opacity="0"/></radialGradient><radialGradient id="glowIndigo" gradientUnits="userSpaceOnUse" cx="984" cy="24" r="480"><stop offset="0" stop-color="#6366f1" stop-opacity="0.16"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/></radialGradient><filter id="cardShadow" x="-10%" y="-10%" width="120%" height="140%"><feGaussianBlur stdDeviation="18"/></filter></defs>{body}</svg>"##
    )
}

/// Alt text for the card.
///
/// A screen reader in a chat window reads this and nothing else, so it says what
/// the picture shows rather than naming the file. Acronyms only, for the same
/// reason the card itself carries no names.
pub fn card_alt_text(preview: &TripPreview, language: Language) -> String {
    let span = format_date_span(&preview.start_date, &preview.end_date, language);
    format!(
        "{} — {}. {}, {}.",
        preview.name,
        span,
        language.guests(preview.guests.len()),
        language.rooms(preview.room_count)
    )
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trip_preview::{PreviewGuest, PreviewStay};

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

    fn preview() -> TripPreview {
        TripPreview {
            name: "Summer house".to_owned(),
            start_date: "2026-08-12".to_owned(),
            end_date: "2026-08-18".to_owned(),
            room_count: 3,
            guests: vec![guest("g1", "A", "#c62828"), guest("g2", "T", "#1d4ed8")],
            stays: vec![
                stay("g1", "Master bedroom", "2026-08-12", "2026-08-18"),
                stay("g2", "Attic", "2026-08-13", "2026-08-15"),
            ],
        }
    }

    #[test]
    fn draws_a_1200_by_630_document() {
        let svg = render_card_svg(&preview(), Language::En);

        assert!(svg.starts_with("<svg"));
        assert!(svg.contains(r#"width="1200""#));
        assert!(svg.contains(r#"height="630""#));
        assert!(svg.ends_with("</svg>"));
    }

    #[test]
    fn names_the_trip_the_dates_and_the_rooms() {
        let svg = render_card_svg(&preview(), Language::En);

        assert!(svg.contains("Summer house"));
        assert!(svg.contains("12–18 August"));
        assert!(svg.contains("Master bedroom"));
        assert!(svg.contains("2 guests"));
        assert!(svg.contains("3 rooms"));
    }

    #[test]
    fn paints_each_guest_in_their_own_colour() {
        let svg = render_card_svg(&preview(), Language::En);

        assert!(svg.contains("#c62828"));
        assert!(svg.contains("#1d4ed8"));
    }

    #[test]
    fn speaks_the_language_it_is_asked_for() {
        let svg = render_card_svg(&preview(), Language::Fr);

        assert!(svg.contains("invités"));
        assert!(svg.contains("Qui dort où"));
        assert!(!svg.contains("guests"));
    }

    #[test]
    fn escapes_a_trip_name_that_is_trying_to_be_markup() {
        let nasty = TripPreview {
            name: r#"<script>alert("x")</script>"#.to_owned(),
            ..preview()
        };

        let svg = render_card_svg(&nasty, Language::En);

        assert!(!svg.contains("<script>"));
        assert!(svg.contains("&lt;script&gt;"));
    }

    #[test]
    fn says_how_much_it_left_out() {
        let crowded = TripPreview {
            guests: (0..9)
                .map(|index| guest(&format!("g{index}"), &format!("G{index}"), "#15803d"))
                .collect(),
            end_date: "2026-08-30".to_owned(),
            stays: Vec::new(),
            ..preview()
        };

        let svg = render_card_svg(&crowded, Language::En);

        assert!(svg.contains("+3 more guests"));
        assert!(svg.contains("+11 more days"));
    }

    #[test]
    fn draws_an_empty_trip_as_empty_rather_than_as_broken() {
        let empty = TripPreview {
            guests: Vec::new(),
            stays: Vec::new(),
            room_count: 0,
            ..preview()
        };

        let svg = render_card_svg(&empty, Language::En);

        assert!(svg.contains("No rooms handed out yet"));
        assert!(svg.contains("Summer house"));
    }

    #[test]
    fn survives_a_trip_whose_dates_make_no_sense() {
        let broken = TripPreview {
            start_date: "nope".to_owned(),
            end_date: "also nope".to_owned(),
            stays: Vec::new(),
            ..preview()
        };

        let svg = render_card_svg(&broken, Language::En);

        assert!(svg.contains("Summer house"));
        assert!(svg.ends_with("</svg>"));
    }

    #[test]
    fn clips_a_stay_that_runs_past_the_drawn_window() {
        let long = TripPreview {
            end_date: "2026-08-30".to_owned(),
            stays: vec![stay("g1", "Master bedroom", "2026-08-12", "2026-08-30")],
            ..preview()
        };

        // Eight columns are drawn, and the bar spans all of them rather than
        // being dropped for naming a day the card does not show.
        let svg = render_card_svg(&long, Language::En);

        assert!(svg.contains("Master bedroom"));
        assert!(svg.contains("+11 more days"));
    }

    #[test]
    fn says_what_the_picture_shows() {
        assert_eq!(
            card_alt_text(&preview(), Language::En),
            "Summer house — 12–18 August. 2 guests, 3 rooms."
        );
    }
}
