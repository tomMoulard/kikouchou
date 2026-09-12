//! Turns a trip document into the handful of facts a card shows.
//!
//! The document is a Yjs document, the same one the app edits, stored in
//! `trip_doc_snapshots` and `trip_doc_updates` as base64. It is plaintext today
//! (see the header of `supabase/migrations/20260831170000_trip_sync_tables.sql`),
//! so this service can read it with `yrs`, the Rust port of the same CRDT. The
//! day that decision changes to client-side encryption, this module stops
//! working and the card falls back to the trip row — which is why
//! [`build_trip_preview`] takes an `Option<&Doc>` and never fails.
//!
//! **Guest names never leave this module.** The card and the `og:` tags carry
//! acronyms only. Every link scanner that sees a share URL fetches the preview,
//! and chat apps cache what they fetch; someone pasting a link into a group chat
//! has not consented to six real first names being cached by a link unfurler. An
//! acronym plus a colour is enough to recognise your own trip and not enough to
//! be a roster.

use std::collections::{HashMap, HashSet};

use yrs::{Doc, Map, Out, ReadTxn, Transact};

// ============================================================================
// Types
// ============================================================================

/// One row of the occupancy grid.
#[derive(Debug, Clone, PartialEq)]
pub struct PreviewGuest {
    pub id: String,
    /// Initials, at most three characters. The only form of the name that escapes.
    pub acronym: String,
    /// The guest's own colour from the document, or a palette fallback.
    pub color: String,
}

/// One bar of the occupancy grid: a guest in a room, over a run of nights.
#[derive(Debug, Clone, PartialEq)]
pub struct PreviewStay {
    pub guest_id: String,
    pub room_name: String,
    /// First night, `YYYY-MM-DD`.
    pub start_date: String,
    /// Last night, `YYYY-MM-DD`.
    pub end_date: String,
}

/// Everything the card and the meta tags are drawn from.
#[derive(Debug, Clone, PartialEq)]
pub struct TripPreview {
    pub name: String,
    pub start_date: String,
    pub end_date: String,
    pub guests: Vec<PreviewGuest>,
    pub stays: Vec<PreviewStay>,
    /// How many rooms the trip has, whether or not anybody sleeps in them.
    pub room_count: usize,
}

/// The `trips` row, which is authoritative for the name and the dates.
#[derive(Debug, Clone)]
pub struct TripRow {
    pub name: String,
    pub start_date: String,
    pub end_date: String,
}

// ============================================================================
// Constants
// ============================================================================

/// Root map keys, mirroring `COLLECTION_ROOT` in `src/lib/yjs/doc-model.ts`.
/// The transport and ride roots live in `reminders`.
const GUESTS_ROOT: &str = "guestsById";
const ROOMS_ROOT: &str = "roomsById";
const ASSIGNMENTS_ROOT: &str = "roomAssignmentsById";

/// At most this many characters in an acronym. "Alice + Julie" is `AJ`.
const ACRONYM_MAX_LETTERS: usize = 3;

/// Colours for a guest whose record carries none, or carries something that is
/// not a hex colour. Six, in the order the landing page uses them, so a card
/// drawn from a colourless document still looks like the site.
const FALLBACK_COLORS: [&str; 6] = [
    "#c62828", "#1d4ed8", "#15803d", "#b45309", "#6d28d9", "#be185d",
];

/// Sorts after every real date, so a guest with no room lands at the bottom.
const NO_NIGHT: &str = "~";

// ============================================================================
// Internal helpers
// ============================================================================

/// The string fields of every `Y.Map` in one root map, keyed by the map key.
///
/// A value that is not a map is skipped rather than failing the read, the same
/// rule `readDocCollection` follows in the app: one bad row written by an older
/// peer, or a hostile one, must not take the whole document down. Only strings
/// are collected because every field this service reads is one.
fn collection_rows(doc: &Doc, root: &str) -> Vec<(String, HashMap<String, String>)> {
    let txn = doc.transact();
    let Some(map) = txn.get_map(root) else {
        return Vec::new();
    };

    let mut rows = Vec::new();
    for (id, value) in map.iter(&txn) {
        let Out::YMap(row) = value else {
            continue;
        };
        let fields = row
            .iter(&txn)
            .filter_map(|(field, value)| match value {
                Out::Any(yrs::Any::String(text)) if !text.is_empty() => {
                    Some((field.to_string(), text.to_string()))
                }
                _ => None,
            })
            .collect();
        rows.push((id.to_string(), fields));
    }
    rows
}

fn is_iso_date(value: &str) -> bool {
    crate::dates::parse_iso_date(value).is_some()
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

// ============================================================================
// Public API
// ============================================================================

/// Initials for a display name.
///
/// Splits on whitespace and on the separators people use for a couple sharing
/// one row: `+`, `&`, `/`, `,` and `-`. Each part contributes its first
/// character, uppercased, up to three. A name with no usable character gives
/// `?`, because an empty label draws an empty row and reads as a bug.
pub fn acronym(name: &str) -> String {
    let letters: String = name
        .split(|character: char| {
            character.is_whitespace() || matches!(character, '+' | '&' | '/' | ',' | '-')
        })
        .filter(|part| !part.is_empty())
        // `chars().next()`, never a byte slice: an accented or non-Latin first
        // character is several bytes and cutting it would emit a broken glyph.
        .filter_map(|part| part.chars().next())
        .take(ACRONYM_MAX_LETTERS)
        .flat_map(char::to_uppercase)
        .collect();

    if letters.is_empty() {
        "?".to_owned()
    } else {
        letters
    }
}

/// Reads the guests, the rooms and the stays out of a trip document.
///
/// `doc` is `None` when nothing readable came back, which yields a preview with
/// no occupancy: the card then draws the trip name and dates alone.
pub fn build_trip_preview(doc: Option<&Doc>, trip: &TripRow) -> TripPreview {
    let empty = TripPreview {
        name: trip.name.clone(),
        start_date: trip.start_date.clone(),
        end_date: trip.end_date.clone(),
        guests: Vec::new(),
        stays: Vec::new(),
        room_count: 0,
    };

    let Some(doc) = doc else {
        return empty;
    };

    let guest_rows = collection_rows(doc, GUESTS_ROOT);
    let known_guests: HashSet<&str> = guest_rows.iter().map(|(id, _)| id.as_str()).collect();
    let rooms: HashMap<String, String> = collection_rows(doc, ROOMS_ROOT)
        .into_iter()
        .map(|(id, fields)| {
            let name = fields.get("name").cloned().unwrap_or_default();
            (id, name)
        })
        .collect();

    let mut stays: Vec<PreviewStay> = Vec::new();
    for (_, fields) in collection_rows(doc, ASSIGNMENTS_ROOT) {
        let (Some(guest_id), Some(room_id), Some(start_date), Some(end_date)) = (
            fields.get("personId"),
            fields.get("roomId"),
            fields.get("startDate"),
            fields.get("endDate"),
        ) else {
            continue;
        };
        if !is_iso_date(start_date)
            || !is_iso_date(end_date)
            || end_date < start_date
            || !known_guests.contains(guest_id.as_str())
        {
            continue;
        }

        let room_name = rooms
            .get(room_id)
            .filter(|name| !name.is_empty())
            .cloned()
            // A stay whose room was deleted is still a stay. Dropping it would
            // leave a guest looking homeless on a card that is otherwise right.
            .unwrap_or_else(|| "Room".to_owned());

        stays.push(PreviewStay {
            guest_id: guest_id.clone(),
            room_name,
            start_date: start_date.clone(),
            end_date: end_date.clone(),
        });
    }

    // Guests come out of the document in an arbitrary order. Order by first
    // night instead, so the grid reads as a schedule: whoever arrives first is
    // the top row. Ties break on the acronym, then the id, so two renderings of
    // the same trip agree.
    let mut first_night: HashMap<&str, &str> = HashMap::new();
    for stay in &stays {
        let entry = first_night
            .entry(&stay.guest_id)
            .or_insert(&stay.start_date);
        if stay.start_date.as_str() < *entry {
            *entry = &stay.start_date;
        }
    }

    let mut guests: Vec<PreviewGuest> = guest_rows
        .iter()
        .enumerate()
        .map(|(index, (id, fields))| PreviewGuest {
            id: id.clone(),
            acronym: acronym(fields.get("name").map_or("", String::as_str)),
            color: fields
                .get("color")
                .filter(|color| is_hex_color(color))
                .cloned()
                .unwrap_or_else(|| FALLBACK_COLORS[index % FALLBACK_COLORS.len()].to_owned()),
        })
        .collect();

    guests.sort_by(|left, right| {
        let left_night = first_night
            .get(left.id.as_str())
            .copied()
            .unwrap_or(NO_NIGHT);
        let right_night = first_night
            .get(right.id.as_str())
            .copied()
            .unwrap_or(NO_NIGHT);
        left_night
            .cmp(right_night)
            .then_with(|| left.acronym.cmp(&right.acronym))
            .then_with(|| left.id.cmp(&right.id))
    });

    TripPreview {
        guests,
        stays,
        room_count: rooms.len(),
        ..empty
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{Any, MapPrelim, Transact};

    fn trip() -> TripRow {
        TripRow {
            name: "Summer house".to_owned(),
            start_date: "2026-08-12".to_owned(),
            end_date: "2026-08-18".to_owned(),
        }
    }

    /// Builds a document the way the app writes one: a root map per collection,
    /// each holding one `Y.Map` per row.
    fn doc_with(
        guests: &[(&str, &[(&str, &str)])],
        rooms: &[(&str, &[(&str, &str)])],
        assignments: &[(&str, &[(&str, &str)])],
    ) -> Doc {
        let doc = Doc::new();
        for (root, rows) in [
            (GUESTS_ROOT, guests),
            (ROOMS_ROOT, rooms),
            (ASSIGNMENTS_ROOT, assignments),
        ] {
            let map = doc.get_or_insert_map(root);
            let mut txn = doc.transact_mut();
            for (id, fields) in rows {
                let row = map.insert(&mut txn, (*id).to_owned(), MapPrelim::default());
                for (key, value) in *fields {
                    row.insert(&mut txn, (*key).to_owned(), Any::from(*value));
                }
            }
        }
        doc
    }

    #[test]
    fn turns_names_into_initials() {
        assert_eq!(acronym("Aurélia"), "A");
        assert_eq!(acronym("Alice + Julie"), "AJ");
        assert_eq!(acronym("jean-pierre"), "JP");
        assert_eq!(acronym("Anne Marie Claire Sophie"), "AMC");
        assert_eq!(acronym("  Tom  "), "T");
        assert_eq!(acronym(""), "?");
        assert_eq!(acronym("   "), "?");
    }

    #[test]
    fn keeps_a_multi_byte_first_character_whole() {
        assert_eq!(acronym("émile"), "É");
    }

    #[test]
    fn falls_back_to_the_trip_row_when_there_is_no_document() {
        let preview = build_trip_preview(None, &trip());

        assert_eq!(preview.name, "Summer house");
        assert!(preview.guests.is_empty());
        assert!(preview.stays.is_empty());
        assert_eq!(preview.room_count, 0);
    }

    #[test]
    fn reads_guests_rooms_and_stays_and_never_the_names() {
        let doc = doc_with(
            &[
                ("g1", &[("name", "Aurélia"), ("color", "#c62828")]),
                ("g2", &[("name", "Tom"), ("color", "#1d4ed8")]),
            ],
            &[("r1", &[("name", "Master bedroom")])],
            &[(
                "a1",
                &[
                    ("personId", "g1"),
                    ("roomId", "r1"),
                    ("startDate", "2026-08-12"),
                    ("endDate", "2026-08-18"),
                ],
            )],
        );

        let preview = build_trip_preview(Some(&doc), &trip());

        assert_eq!(
            preview
                .guests
                .iter()
                .map(|guest| guest.acronym.as_str())
                .collect::<Vec<_>>(),
            ["A", "T"]
        );
        assert!(!format!("{preview:?}").contains("Aurélia"));
        assert_eq!(preview.stays.len(), 1);
        assert_eq!(preview.stays[0].room_name, "Master bedroom");
        assert_eq!(preview.room_count, 1);
    }

    #[test]
    fn orders_guests_by_first_night_then_acronym() {
        let doc = doc_with(
            &[
                ("g1", &[("name", "Zoe")]),
                ("g2", &[("name", "Bob")]),
                ("g3", &[("name", "Ana")]),
            ],
            &[("r1", &[("name", "Attic")])],
            &[
                (
                    "a1",
                    &[
                        ("personId", "g1"),
                        ("roomId", "r1"),
                        ("startDate", "2026-08-12"),
                        ("endDate", "2026-08-13"),
                    ],
                ),
                (
                    "a2",
                    &[
                        ("personId", "g2"),
                        ("roomId", "r1"),
                        ("startDate", "2026-08-15"),
                        ("endDate", "2026-08-16"),
                    ],
                ),
            ],
        );

        // g1 arrives first, g2 second, and g3 has no room at all so sorts last.
        assert_eq!(
            build_trip_preview(Some(&doc), &trip())
                .guests
                .iter()
                .map(|guest| guest.acronym.as_str())
                .collect::<Vec<_>>(),
            ["Z", "B", "A"]
        );
    }

    #[test]
    fn skips_rows_a_hostile_or_older_peer_could_have_written() {
        let doc = doc_with(
            &[("g1", &[("name", "Tom")])],
            &[("r1", &[("name", "Attic")])],
            &[
                // Not a date.
                (
                    "a1",
                    &[
                        ("personId", "g1"),
                        ("roomId", "r1"),
                        ("startDate", "soon"),
                        ("endDate", "2026-08-13"),
                    ],
                ),
                // Ends before it starts.
                (
                    "a2",
                    &[
                        ("personId", "g1"),
                        ("roomId", "r1"),
                        ("startDate", "2026-08-14"),
                        ("endDate", "2026-08-12"),
                    ],
                ),
                // A guest that does not exist.
                (
                    "a3",
                    &[
                        ("personId", "ghost"),
                        ("roomId", "r1"),
                        ("startDate", "2026-08-12"),
                        ("endDate", "2026-08-13"),
                    ],
                ),
            ],
        );

        let preview = build_trip_preview(Some(&doc), &trip());

        assert!(preview.stays.is_empty());
        assert_eq!(preview.guests.len(), 1);
    }

    #[test]
    fn names_an_unknown_room_rather_than_dropping_the_stay() {
        let doc = doc_with(
            &[("g1", &[("name", "Tom")])],
            &[],
            &[(
                "a1",
                &[
                    ("personId", "g1"),
                    ("roomId", "gone"),
                    ("startDate", "2026-08-12"),
                    ("endDate", "2026-08-13"),
                ],
            )],
        );

        assert_eq!(
            build_trip_preview(Some(&doc), &trip()).stays[0].room_name,
            "Room"
        );
    }

    #[test]
    fn falls_back_to_the_palette_for_a_missing_or_malformed_colour() {
        let doc = doc_with(
            &[
                ("g1", &[("name", "Tom")]),
                ("g2", &[("name", "Ana"), ("color", "teal")]),
                ("g3", &[("name", "Bo"), ("color", "#15803D")]),
            ],
            &[],
            &[],
        );

        for guest in build_trip_preview(Some(&doc), &trip()).guests {
            assert!(
                is_hex_color(&guest.color),
                "{} is not a colour",
                guest.color
            );
        }
    }
}
