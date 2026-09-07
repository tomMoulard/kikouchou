//! The words on the card and in the meta tags, in each language.
//!
//! A share link carries its language in the path — `/fr/<token>`, `/en/<token>`
//! — because a link preview is drawn once, by a crawler, before any person sees
//! it. The crawler has no preference of its own worth honouring: Slack unfurls a
//! link from a data centre, and `Accept-Language` on that request says nothing
//! about the group chat the card will appear in. The language therefore has to
//! be in the URL, chosen by whoever shares the trip.
//!
//! The strings are written here rather than read from `src/locales`: this
//! service builds and deploys on its own, and a dozen phrases are not worth
//! coupling two builds together. Anything the app already says well is said the
//! same way here — `invités`, `chambres`, `nuits`, `voyage`.

use std::fmt;

// ============================================================================
// Types
// ============================================================================

/// The languages the app ships, and therefore the ones a link may name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    En,
    Fr,
}

/// French, matching `DEFAULT_LANGUAGE` in `src/lib/i18n/index.ts`. A link with
/// no language in its path renders in this one.
pub const DEFAULT_LANGUAGE: Language = Language::Fr;

impl Language {
    /// The path segment and the `lang` attribute: `en` or `fr`.
    pub fn code(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::Fr => "fr",
        }
    }

    /// Narrows a path segment to a language this service renders.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "en" => Some(Self::En),
            "fr" => Some(Self::Fr),
            _ => None,
        }
    }
}

impl fmt::Display for Language {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(self.code())
    }
}

// ============================================================================
// Strings
// ============================================================================

impl Language {
    /// `og:locale`, e.g. `fr_FR`.
    pub fn og_locale(self) -> &'static str {
        match self {
            Self::En => "en_GB",
            Self::Fr => "fr_FR",
        }
    }

    /// The hero headline, printed across the top of the card.
    pub fn headline(self) -> &'static str {
        match self {
            Self::En => "Who sleeps where, and who picks up whom.",
            Self::Fr => "Qui dort où, et qui va chercher qui.",
        }
    }

    /// What the app is, for `og:description` and the foot of the card.
    pub fn description(self) -> &'static str {
        match self {
            Self::En => "Plan a house full of friends: room assignments, arrivals and departures, on one shared calendar.",
            Self::Fr => "Organisez une maisonnée d'amis : attribution des chambres, arrivées et départs, sur un calendrier partagé.",
        }
    }

    /// Window title bar, after the trip name and the dates.
    pub fn timeline(self) -> &'static str {
        match self {
            Self::En => "Timeline",
            Self::Fr => "Planning",
        }
    }

    pub fn guests(self, count: usize) -> String {
        match (self, count) {
            (Self::En, 1) => "1 guest".to_owned(),
            (Self::En, n) => format!("{n} guests"),
            (Self::Fr, 1) => "1 invité".to_owned(),
            (Self::Fr, n) => format!("{n} invités"),
        }
    }

    pub fn rooms(self, count: usize) -> String {
        match (self, count) {
            (Self::En, 1) => "1 room".to_owned(),
            (Self::En, n) => format!("{n} rooms"),
            (Self::Fr, 1) => "1 chambre".to_owned(),
            (Self::Fr, n) => format!("{n} chambres"),
        }
    }

    pub fn nights(self, count: usize) -> String {
        match (self, count) {
            (Self::En, 1) => "1 night".to_owned(),
            (Self::En, n) => format!("{n} nights"),
            (Self::Fr, 1) => "1 nuit".to_owned(),
            (Self::Fr, n) => format!("{n} nuits"),
        }
    }

    pub fn more_guests(self, count: usize) -> String {
        match (self, count) {
            (Self::En, 1) => "+1 more guest".to_owned(),
            (Self::En, n) => format!("+{n} more guests"),
            (Self::Fr, 1) => "+1 invité de plus".to_owned(),
            (Self::Fr, n) => format!("+{n} invités de plus"),
        }
    }

    pub fn more_days(self, count: usize) -> String {
        match (self, count) {
            (Self::En, 1) => "+1 more day".to_owned(),
            (Self::En, n) => format!("+{n} more days"),
            (Self::Fr, 1) => "+1 jour de plus".to_owned(),
            (Self::Fr, n) => format!("+{n} jours de plus"),
        }
    }

    /// Drawn in the grid when the trip has no room assignments yet.
    pub fn no_rooms_yet(self) -> &'static str {
        match self {
            Self::En => "No rooms handed out yet",
            Self::Fr => "Aucune chambre attribuée pour le moment",
        }
    }

    /// The redirect page a person sees for the half second before the app loads.
    pub fn opening(self) -> &'static str {
        match self {
            Self::En => "Opening Kikouchou…",
            Self::Fr => "Ouverture de Kikouchou…",
        }
    }

    pub fn open_trip(self) -> &'static str {
        match self {
            Self::En => "Open the trip",
            Self::Fr => "Ouvrir le voyage",
        }
    }

    /// The page a withdrawn, expired or unknown link gets.
    pub fn gone_title(self) -> &'static str {
        match self {
            Self::En => "This link is no longer valid",
            Self::Fr => "Ce lien n'est plus valable",
        }
    }

    pub fn gone_body(self) -> &'static str {
        match self {
            Self::En => "The share link was withdrawn, has expired, or never existed. Ask whoever sent it for a new one.",
            Self::Fr => "Le lien de partage a été révoqué, a expiré, ou n'a jamais existé. Demandez-en un nouveau à la personne qui vous l'a envoyé.",
        }
    }

    pub fn go_to_app(self) -> &'static str {
        match self {
            Self::En => "Go to Kikouchou",
            Self::Fr => "Aller sur Kikouchou",
        }
    }
}

// ============================================================================
// Negotiation
// ============================================================================

/// Picks a language from an `Accept-Language` header.
///
/// Used only for a link with no language in its path — the older `/{token}`
/// form, which stays supported so links already pasted somewhere keep working.
/// Quality values are honoured; anything unrecognised falls through to
/// [`DEFAULT_LANGUAGE`].
pub fn negotiate_language(header: Option<&str>) -> Language {
    let Some(header) = header else {
        return DEFAULT_LANGUAGE;
    };

    let mut ranked: Vec<(f32, Language)> = header
        .split(',')
        .filter_map(|part| {
            let mut pieces = part.trim().split(';');
            // `fr-CA` and `FR` both mean French here: only the primary subtag is
            // compared, the same rule `lib/i18n/date-locale.ts` follows.
            let tag = pieces
                .next()?
                .trim()
                .split('-')
                .next()?
                .to_ascii_lowercase();
            let quality = pieces
                .find_map(|piece| piece.trim().strip_prefix("q=")?.parse::<f32>().ok())
                .unwrap_or(1.0);
            Some((quality, Language::parse(&tag)?))
        })
        .filter(|(quality, _)| quality.is_finite())
        .collect();

    // `total_cmp` rather than `partial_cmp`: no unwrap, and no panic on a header
    // carrying `q=NaN`.
    ranked.sort_by(|left, right| right.0.total_cmp(&left.0));
    ranked
        .first()
        .map_or(DEFAULT_LANGUAGE, |(_, language)| *language)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admits_what_the_app_ships_and_nothing_else() {
        assert_eq!(Language::parse("fr"), Some(Language::Fr));
        assert_eq!(Language::parse("en"), Some(Language::En));
        assert_eq!(Language::parse("de"), None);
        assert_eq!(Language::parse("card.png"), None);
    }

    #[test]
    fn falls_back_to_the_app_default() {
        assert_eq!(negotiate_language(None), DEFAULT_LANGUAGE);
        assert_eq!(negotiate_language(Some("")), DEFAULT_LANGUAGE);
        assert_eq!(
            negotiate_language(Some("de-DE, ja;q=0.8")),
            DEFAULT_LANGUAGE
        );
    }

    #[test]
    fn honours_quality_values_rather_than_order() {
        assert_eq!(negotiate_language(Some("fr;q=0.2, en;q=0.9")), Language::En);
        assert_eq!(negotiate_language(Some("en;q=0.4, fr;q=0.7")), Language::Fr);
    }

    #[test]
    fn compares_the_primary_subtag_only() {
        assert_eq!(negotiate_language(Some("en-GB,en;q=0.9")), Language::En);
        assert_eq!(negotiate_language(Some("FR-ca")), Language::Fr);
    }

    #[test]
    fn counts_in_the_singular_and_the_plural() {
        assert_eq!(Language::En.guests(1), "1 guest");
        assert_eq!(Language::En.guests(4), "4 guests");
        assert_eq!(Language::Fr.rooms(1), "1 chambre");
        assert_eq!(Language::Fr.rooms(3), "3 chambres");
    }
}
