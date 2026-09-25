//! Calendar arithmetic for `YYYY-MM-DD` strings.
//!
//! Every date in a trip document is a calendar day as the guests speak of it,
//! with no time and no zone: the 14th is the 14th in the house. So nothing here
//! ever builds an instant, and nothing here reads the container's timezone. A
//! date is three numbers.
//!
//! The month and weekday names are written out rather than taken from a locale
//! database. Two languages and nineteen words is smaller than the dependency,
//! and it means the card renders the same on a developer's laptop as in the
//! image, where no locale data is installed at all.

use time::{Date, Month};

use crate::i18n::Language;

// ============================================================================
// Constants
// ============================================================================

const WEEKDAYS_EN: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS_FR: [&str; 7] = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

const MONTHS_EN: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const MONTHS_FR: [&str; 12] = [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
];

const SHORT_MONTHS_EN: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const SHORT_MONTHS_FR: [&str; 12] = [
    "janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.",
    "déc.",
];

// ============================================================================
// Internal helpers
// ============================================================================

fn month_index(date: Date) -> usize {
    u8::from(date.month()) as usize - 1
}

fn weekday_name(date: Date, language: Language) -> &'static str {
    let index = date.weekday().number_days_from_monday() as usize;
    match language {
        Language::En => WEEKDAYS_EN[index],
        Language::Fr => WEEKDAYS_FR[index],
    }
}

fn month_name(date: Date, language: Language) -> &'static str {
    match language {
        Language::En => MONTHS_EN[month_index(date)],
        Language::Fr => MONTHS_FR[month_index(date)],
    }
}

fn short_month_name(date: Date, language: Language) -> &'static str {
    match language {
        Language::En => SHORT_MONTHS_EN[month_index(date)],
        Language::Fr => SHORT_MONTHS_FR[month_index(date)],
    }
}

// ============================================================================
// Public API
// ============================================================================

/// Parses `YYYY-MM-DD`, or returns `None` when the string is not a real day.
///
/// `2026-02-31` is rejected rather than rolled into March: a document may carry
/// anything, and a card that silently moves a date is worse than one that omits
/// it.
pub fn parse_iso_date(value: &str) -> Option<Date> {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year: i32 = value.get(0..4)?.parse().ok()?;
    let month: u8 = value.get(5..7)?.parse().ok()?;
    let day: u8 = value.get(8..10)?.parse().ok()?;
    Date::from_calendar_date(year, Month::try_from(month).ok()?, day).ok()
}

/// Formats a date back to `YYYY-MM-DD`.
pub fn to_iso_date(date: Date) -> String {
    format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        u8::from(date.month()),
        date.day()
    )
}

/// Every calendar day from `start` to `end`, inclusive, stopping at `limit`.
///
/// Returns an empty vector when either bound is unusable or the range runs
/// backwards; the caller draws an empty grid rather than guessing.
pub fn date_range(start: &str, end: &str, limit: usize) -> Vec<String> {
    let (Some(from), Some(to)) = (parse_iso_date(start), parse_iso_date(end)) else {
        return Vec::new();
    };
    if to < from {
        return Vec::new();
    }

    let mut days = Vec::new();
    let mut cursor = from;
    while cursor <= to && days.len() < limit {
        days.push(to_iso_date(cursor));
        match cursor.next_day() {
            Some(next) => cursor = next,
            None => break,
        }
    }
    days
}

/// Total days from `start` to `end` inclusive, or 0 when either is unusable.
pub fn day_count(start: &str, end: &str) -> usize {
    let (Some(from), Some(to)) = (parse_iso_date(start), parse_iso_date(end)) else {
        return 0;
    };
    if to < from {
        return 0;
    }
    ((to.to_julian_day() - from.to_julian_day()) + 1) as usize
}

/// A column heading: `Wed 12` in English, `mer. 12` in French.
pub fn format_day_label(date: &str, language: Language) -> String {
    match parse_iso_date(date) {
        Some(day) => format!("{} {}", weekday_name(day, language), day.day()),
        None => date.to_owned(),
    }
}

/// The span a human would say out loud.
///
/// `12–18 August` inside one month, `30 Aug – 2 Sep` across two, and the year
/// appears only when the two ends disagree about it.
pub fn format_date_span(start: &str, end: &str, language: Language) -> String {
    let (Some(from), Some(to)) = (parse_iso_date(start), parse_iso_date(end)) else {
        return String::new();
    };

    if from == to {
        return format!(
            "{} {} {}",
            from.day(),
            month_name(from, language),
            from.year()
        );
    }
    if from.year() != to.year() {
        return format!(
            "{} {} {} – {} {} {}",
            from.day(),
            short_month_name(from, language),
            from.year(),
            to.day(),
            short_month_name(to, language),
            to.year()
        );
    }
    if from.month() != to.month() {
        return format!(
            "{} {} – {} {}",
            from.day(),
            short_month_name(from, language),
            to.day(),
            short_month_name(to, language)
        );
    }
    format!("{}–{} {}", from.day(), to.day(), month_name(from, language))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_real_day_and_rejects_one_that_does_not_exist() {
        assert!(parse_iso_date("2026-08-12").is_some());
        assert!(parse_iso_date("2026-02-31").is_none());
        assert!(parse_iso_date("12/08/2026").is_none());
        assert!(parse_iso_date("").is_none());
        assert!(parse_iso_date("2026-8-12").is_none());
    }

    #[test]
    fn walks_the_days_inclusively() {
        assert_eq!(
            date_range("2026-08-12", "2026-08-14", 8),
            ["2026-08-12", "2026-08-13", "2026-08-14"]
        );
    }

    #[test]
    fn crosses_a_month_boundary() {
        assert_eq!(
            date_range("2026-08-30", "2026-09-01", 8),
            ["2026-08-30", "2026-08-31", "2026-09-01"]
        );
    }

    #[test]
    fn stops_at_the_limit_and_refuses_a_backwards_range() {
        assert_eq!(date_range("2026-08-01", "2026-08-31", 3).len(), 3);
        assert!(date_range("2026-08-14", "2026-08-12", 8).is_empty());
        assert!(date_range("nope", "2026-08-12", 8).is_empty());
    }

    #[test]
    fn counts_both_ends() {
        assert_eq!(day_count("2026-08-12", "2026-08-18"), 7);
        assert_eq!(day_count("2026-08-12", "2026-08-12"), 1);
        assert_eq!(day_count("2026-08-18", "2026-08-12"), 0);
    }

    #[test]
    fn reads_the_day_in_the_callers_language() {
        assert_eq!(format_day_label("2026-08-12", Language::En), "Wed 12");
        assert_eq!(format_day_label("2026-08-12", Language::Fr), "mer. 12");
        assert_eq!(format_day_label("nope", Language::En), "nope");
    }

    #[test]
    fn keeps_one_month_on_one_label() {
        assert_eq!(
            format_date_span("2026-08-12", "2026-08-18", Language::En),
            "12–18 August"
        );
        assert_eq!(
            format_date_span("2026-08-12", "2026-08-18", Language::Fr),
            "12–18 août"
        );
    }

    #[test]
    fn names_both_months_when_the_span_crosses_one() {
        assert_eq!(
            format_date_span("2026-08-30", "2026-09-02", Language::En),
            "30 Aug – 2 Sep"
        );
    }

    #[test]
    fn adds_the_years_when_they_differ() {
        assert_eq!(
            format_date_span("2026-12-30", "2027-01-02", Language::En),
            "30 Dec 2026 – 2 Jan 2027"
        );
    }

    #[test]
    fn says_a_single_day_once_with_its_year() {
        assert_eq!(
            format_date_span("2026-08-12", "2026-08-12", Language::En),
            "12 August 2026"
        );
    }

    #[test]
    fn says_nothing_for_a_date_it_cannot_read() {
        assert_eq!(format_date_span("nope", "2026-08-12", Language::En), "");
    }
}
