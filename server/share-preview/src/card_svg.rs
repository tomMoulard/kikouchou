//! Draws one trip as the 1200x630 card a chat window shows.
//!
//! This is `public/og-card.svg` made dynamic. That file is the landing page hero
//! redrawn at the aspect every consumer of `og:image` is built around, and it is
//! the reference for every coordinate, colour and font size below: Creme
//! paper, Encre text, Prune accent (the brand kit, "Soleil couchant"), the
//! outlined logo lockup in the header, and an app window whose rows are guests
//! and whose columns are days. Someone who saw the site recognises the card; someone who saw the
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
use crate::trip_preview::{TemplatePreview, TripPreview};

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

/// Brand and landing page tokens. Named here so the card and the site cannot
/// drift.
const PAPER: &str = "#f6f0e4";
const WINDOW: &str = "#fffcf5";
const INK: &str = "#2a1d36";
const MUTED: &str = "#554a5e";
const SUBTLE: &str = "#645a6b";
const ACCENT: &str = "#7a3786";
const ACCENT_TINT: &str = "#f0e4ee";
const SURFACE: &str = "#f4ede0";
const BORDER: &str = "#e3d7c2";
const EMPTY_CELL: &str = "#efe6d4";

/// The horizontal logo lockup from the brand kit: the house mark and the
/// wordmark, with the text converted to outlines so the card needs no font for
/// it. Scaled to 40px tall, with its top-left corner at (56, 26).
const LOGO_LOCKUP: &str = r##"<g transform="translate(56 26) scale(0.7) translate(-4 -4)"><path d="M10.76 28Q4 28 9.13 23.6L30.37 5.39Q32 4 33.63 5.39L54.87 23.6Q60 28 53.24 28L10.76 28Z" fill="#F09A36"/><rect x="8" y="32" width="20" height="28" rx="2.5" fill="#E25E4A"/><rect x="32" y="32" width="24" height="12" rx="2.5" fill="#C4436B"/><rect x="32" y="48" width="24" height="12" rx="2.5" fill="#7A3786"/><path d="M72 60V32H78.48V44.27Q80.6 43.47 82.35 42.13Q84.11 40.8 85.44 39.14Q86.76 37.49 87.66 35.65Q88.55 33.82 88.97 32H96.35Q95.82 34.19 94.72 36.27Q93.62 38.36 92.06 40.18Q90.5 42 88.62 43.4Q86.74 44.81 84.64 45.66V46.16Q86.85 46.08 88.46 46.56Q90.07 47.04 91.21 48Q92.35 48.96 93.14 50.31Q93.92 51.65 94.51 53.33L96.79 60H89.5L87.96 54.36Q87.47 52.54 86.62 51.44Q85.77 50.33 84.42 49.83Q83.06 49.32 80.93 49.32H78.48V60H72ZM99.37 60V37.66H105.85V60H99.37ZM102.61 35.04Q100.74 35.04 99.75 34.25Q98.75 33.46 98.75 31.97Q98.75 30.43 99.75 29.64Q100.74 28.85 102.61 28.85Q104.51 28.85 105.51 29.65Q106.5 30.45 106.5 31.96Q106.5 33.44 105.51 34.24Q104.51 35.04 102.61 35.04ZM109.85 60V29.9H116.2V46.31Q117.57 45.49 118.7 44.47Q119.83 43.46 120.72 42.32Q121.61 41.19 122.26 40.01Q122.91 38.83 123.35 37.66H130.77Q130.24 39.31 129.28 40.92Q128.33 42.53 126.97 43.91Q125.6 45.29 123.79 46.32Q121.98 47.36 119.75 47.86V48.42Q122.58 47.94 124.41 48.42Q126.23 48.9 127.34 50.01Q128.45 51.13 129.07 52.66Q129.69 54.19 130.11 55.83L131.07 60H124.04L123.55 57.24Q123.18 55.43 122.65 54.04Q122.13 52.64 121.09 51.83Q120.05 51.03 118.08 51.02L116.2 51.02V60H109.85ZM143.2 60.59Q139.89 60.59 137.35 59.28Q134.81 57.97 133.37 55.35Q131.93 52.74 131.93 48.82Q131.93 44.82 133.4 42.22Q134.86 39.62 137.42 38.35Q139.98 37.07 143.24 37.07Q146.58 37.07 149.12 38.38Q151.66 39.69 153.1 42.29Q154.53 44.9 154.53 48.84Q154.53 52.88 153.05 55.49Q151.56 58.1 148.99 59.34Q146.42 60.59 143.2 60.59ZM143.39 55.81Q144.9 55.81 145.92 55.07Q146.94 54.32 147.47 52.83Q148 51.34 148 49.21Q148 46.94 147.43 45.36Q146.86 43.79 145.77 42.94Q144.69 42.09 143.07 42.09Q141.6 42.09 140.56 42.84Q139.52 43.59 139 45.08Q138.47 46.57 138.47 48.73Q138.47 52.18 139.76 53.99Q141.06 55.81 143.39 55.81ZM164.87 60.59Q161.04 60.59 159.15 57.96Q157.25 55.32 157.25 49.92V37.66H163.75V49.39Q163.75 52.39 164.61 53.75Q165.48 55.12 167.23 55.12Q168.32 55.12 169.17 54.56Q170.01 54.01 170.62 52.96Q171.23 51.9 171.54 50.4Q171.86 48.9 171.87 46.98V37.66H178.35V50.44L178.35 60H173L173 52.29H172.39Q171.92 55.2 170.99 57.03Q170.05 58.87 168.55 59.73Q167.05 60.59 164.87 60.59ZM192.86 60.59Q189.94 60.59 187.78 59.73Q185.62 58.88 184.2 57.33Q182.77 55.77 182.07 53.68Q181.36 51.58 181.36 49.1Q181.36 46.54 182.07 44.37Q182.78 42.2 184.2 40.55Q185.61 38.89 187.74 37.98Q189.87 37.07 192.69 37.07Q195.77 37.07 197.85 38.14Q199.93 39.21 201.04 41.01Q202.15 42.82 202.28 45.07L196.44 46.43Q196.4 44.98 195.88 44.01Q195.37 43.05 194.48 42.59Q193.6 42.12 192.45 42.12Q191.36 42.12 190.52 42.54Q189.68 42.96 189.1 43.81Q188.52 44.67 188.21 45.91Q187.9 47.15 187.9 48.81Q187.9 51.06 188.47 52.61Q189.03 54.17 190.16 54.97Q191.28 55.78 192.94 55.78Q194.59 55.78 195.51 55.06Q196.43 54.35 196.82 53.26Q197.21 52.17 197.21 51.06L202.99 51.92Q202.99 53.64 202.4 55.21Q201.81 56.78 200.57 57.99Q199.33 59.21 197.42 59.9Q195.52 60.59 192.86 60.59ZM205.39 60V46.94L205.39 29.92H211.88V36.33Q211.88 37.19 211.8 38.33Q211.71 39.48 211.55 40.72Q211.39 41.96 211.22 43.17Q211.06 44.37 210.89 45.38H211.61Q212.12 42.65 213.04 40.81Q213.96 38.96 215.48 38.01Q217.01 37.07 219.26 37.07Q223.06 37.07 224.93 39.75Q226.79 42.43 226.79 47.92V60H220.29V48.64Q220.29 45.54 219.41 44.05Q218.54 42.56 216.7 42.56Q215.16 42.56 214.1 43.57Q213.03 44.57 212.46 46.45Q211.89 48.32 211.87 50.94V60H205.39ZM240.78 60.59Q237.47 60.59 234.92 59.28Q232.38 57.97 230.94 55.35Q229.51 52.74 229.51 48.82Q229.51 44.82 230.97 42.22Q232.44 39.62 235 38.35Q237.56 37.07 240.81 37.07Q244.15 37.07 246.7 38.38Q249.24 39.69 250.67 42.29Q252.11 44.9 252.11 48.84Q252.11 52.88 250.62 55.49Q249.14 58.1 246.57 59.34Q244 60.59 240.78 60.59ZM240.96 55.81Q242.47 55.81 243.49 55.07Q244.52 54.32 245.05 52.83Q245.57 51.34 245.57 49.21Q245.57 46.94 245.01 45.36Q244.44 43.79 243.35 42.94Q242.26 42.09 240.64 42.09Q239.17 42.09 238.14 42.84Q237.1 43.59 236.57 45.08Q236.04 46.57 236.04 48.73Q236.04 52.18 237.34 53.99Q238.63 55.81 240.96 55.81ZM262.45 60.59Q258.62 60.59 256.72 57.96Q254.82 55.32 254.82 49.92V37.66H261.33V49.39Q261.33 52.39 262.19 53.75Q263.05 55.12 264.8 55.12Q265.9 55.12 266.74 54.56Q267.59 54.01 268.2 52.96Q268.8 51.9 269.12 50.4Q269.43 48.9 269.45 46.98V37.66H275.92V50.44L275.93 60H270.58L270.57 52.29H269.97Q269.5 55.2 268.56 57.03Q267.63 58.87 266.13 59.73Q264.63 60.59 262.45 60.59Z" fill="#2A1D36"/></g>"##;
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
// Shared furniture
// ============================================================================

/// The Creme ground and the logo.
///
/// Every card this service draws starts here, so an invite card and a template
/// card are recognisably the same object with different contents.
fn draw_backdrop(body: &mut String, headline: &str) {
    let _ = write!(
        body,
        r#"<rect width="{CARD_WIDTH}" height="{CARD_HEIGHT}" fill="{PAPER}"/>"#
    );

    // --- Header: logo, headline, and where this card came from. -------------
    body.push_str(LOGO_LOCKUP);
    text(
        body,
        1144.0,
        62.0,
        "app.kikouchou.app",
        Type::label(22.0, ACCENT).anchor(Anchor::End),
    );
    text(
        body,
        56.0,
        104.0,
        headline,
        Type::label(28.0, MUTED).plain(),
    );
}

/// The app window: its shadow, its rounded title bar, its three dots, and the
/// one line of title across it.
fn draw_window(body: &mut String, title: &str) {
    // --- The app window. ----------------------------------------------------
    let _ = write!(
        body,
        r#"<rect x="76" y="158" width="1048" height="448" rx="24" fill="{INK}" fill-opacity="0.16" filter="url(#cardShadow)"/>"#
    );
    rect(
        body,
        56.0,
        136.0,
        1088.0,
        458.0,
        Box_::new(WINDOW).round(20.0).bordered(BORDER),
    );
    // The second rect squares off the bottom corners the first one rounded, so
    // only the top of the title bar is round.
    rect(
        body,
        57.0,
        137.0,
        1086.0,
        51.0,
        Box_::new(SURFACE).round(19.0),
    );
    rect(body, 57.0, 166.0, 1086.0, 22.0, Box_::new(SURFACE));
    let _ = write!(
        body,
        r#"<line x1="56" y1="188" x2="1144" y2="188" stroke="{BORDER}" stroke-width="1"/>"#
    );
    let _ = write!(
        body,
        r##"<g fill="#cdbd9f"><circle cx="84" cy="162" r="5.5"/><circle cx="102" cy="162" r="5.5"/><circle cx="120" cy="162" r="5.5"/></g>"##
    );

    text(
        body,
        148.0,
        169.0,
        &truncate(title, 19.0, 980.0),
        Type::label(19.0, SUBTLE),
    );
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

    draw_backdrop(&mut body, language.headline());

    let span = format_date_span(&preview.start_date, &preview.end_date, language);
    let window_title = [preview.name.as_str(), span.as_str(), language.timeline()]
        .into_iter()
        .filter(|piece| !piece.is_empty())
        .collect::<Vec<_>>()
        .join(" · ");
    draw_window(&mut body, &window_title);

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
        Box_::new(ACCENT_TINT),
        ACCENT,
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

    wrap_svg(&body)
}

/// Wraps a drawn body in the `svg` element, with the gradients and the shadow
/// filter every card refers to by id.
fn wrap_svg(body: &str) -> String {
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{CARD_WIDTH}" height="{CARD_HEIGHT}" viewBox="0 0 {CARD_WIDTH} {CARD_HEIGHT}" font-family="{FONT_STACK}"><defs><filter id="cardShadow" x="-10%" y="-10%" width="120%" height="140%"><feGaussianBlur stdDeviation="18"/></filter></defs>{body}</svg>"##
    )
}

/// The card behind a template link.
///
/// The same object as an invite card — same ground, same window — with the
/// grid replaced by the three things a template publishes: what it is called,
/// where it is, and how many rooms it has. There is no date row and no guest
/// row, because a template carries neither.
pub fn render_template_card_svg(preview: &TemplatePreview, language: Language) -> String {
    let mut body = String::with_capacity(4096);

    draw_backdrop(&mut body, language.template_headline());
    draw_window(&mut body, &preview.name);

    // --- The name, the place, and one count. --------------------------------
    text(
        &mut body,
        84.0,
        286.0,
        &truncate(&preview.name, 46.0, 1032.0),
        Type::label(46.0, INK).weight(700),
    );

    if let Some(location) = preview.location.as_deref() {
        text(
            &mut body,
            84.0,
            336.0,
            &truncate(location, 26.0, 1032.0),
            Type::label(26.0, MUTED).plain(),
        );
    }

    let rooms = language.rooms(preview.room_count);
    chip(
        &mut body,
        84.0,
        380.0,
        chip_width(&rooms),
        &rooms,
        Box_::new(ACCENT_TINT),
        ACCENT,
    );

    text(
        &mut body,
        84.0,
        468.0,
        &truncate(language.template_description(), 22.0, 1032.0),
        Type::label(22.0, SUBTLE).plain(),
    );

    // --- Footer: whose app this is. -----------------------------------------
    let _ = write!(
        body,
        r#"<line x1="84" y1="540" x2="1116" y2="540" stroke="{BORDER}" stroke-width="1" stroke-dasharray="6 5"/>"#
    );
    text(
        &mut body,
        84.0,
        574.0,
        language.made_with(),
        Type::label(17.0, MUTED),
    );

    wrap_svg(&body)
}

/// Alt text for a template card.
///
/// What the picture shows, and nothing the template did not publish.
pub fn template_card_alt_text(preview: &TemplatePreview, language: Language) -> String {
    match preview.location.as_deref() {
        Some(location) => format!(
            "{} — {location}. {}.",
            preview.name,
            language.rooms(preview.room_count)
        ),
        None => format!("{}. {}.", preview.name, language.rooms(preview.room_count)),
    }
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

    fn template() -> TemplatePreview {
        TemplatePreview {
            name: "Chalet Marmotte".to_owned(),
            location: Some("Chamonix".to_owned()),
            room_count: 3,
        }
    }

    #[test]
    fn draws_a_template_card_of_the_same_size() {
        let svg = render_template_card_svg(&template(), Language::En);

        assert!(svg.starts_with("<svg"));
        assert!(svg.contains(r#"width="1200""#));
        assert!(svg.contains(r#"height="630""#));
        assert!(svg.ends_with("</svg>"));
    }

    #[test]
    fn a_template_card_shows_the_name_the_place_and_the_rooms() {
        let svg = render_template_card_svg(&template(), Language::En);

        assert!(svg.contains("Chalet Marmotte"));
        assert!(svg.contains("Chamonix"));
        assert!(svg.contains("3 rooms"));
        assert!(svg.contains("Made with Kikouchou"));
    }

    #[test]
    fn a_template_card_carries_no_date_and_no_occupancy() {
        let svg = render_template_card_svg(&template(), Language::En);

        // The invite card draws a day axis, a guest count and an occupancy
        // grid. None of the three has any business on a card published to
        // strangers. The word "guests" still appears, in the line that says
        // what the customer has left to fill in.
        assert!(!svg.contains("2026"));
        assert!(!svg.contains("Timeline"));
        assert!(!svg.contains("3 guests"));
    }

    #[test]
    fn a_template_card_escapes_a_name_somebody_typed() {
        let mut preview = template();
        preview.name = "Rock & <Roll>".to_owned();

        let svg = render_template_card_svg(&preview, Language::En);

        assert!(!svg.contains("<Roll>"));
        assert!(svg.contains("&amp;"));
    }

    #[test]
    fn a_template_card_survives_having_no_place() {
        let mut preview = template();
        preview.location = None;

        let svg = render_template_card_svg(&preview, Language::Fr);

        assert!(svg.contains("Chalet Marmotte"));
        assert!(svg.contains("3 chambres"));
    }

    #[test]
    fn template_alt_text_says_what_the_picture_shows() {
        assert_eq!(
            template_card_alt_text(&template(), Language::En),
            "Chalet Marmotte — Chamonix. 3 rooms."
        );
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
