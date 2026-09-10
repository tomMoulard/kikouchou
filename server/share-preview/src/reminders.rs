//! Which reminders a subscription is due, and the words each one carries.
//!
//! Three kinds and no more, decided on 2026-09-10: the trip starts, your own
//! arrival is coming up, a pickup you are part of is due. Everything here is a
//! pure function of a trip document, a subscription row and a clock, so the
//! rules are tested without a database, a network or a push service.
//!
//! The document is the same Yjs document the app edits, rebuilt by
//! `trip_source` and read here the way `trip_preview` reads it: one root map per
//! collection, one `Y.Map` per row, and a row that does not have the shape the
//! app writes is skipped rather than trusted. Guest names never leave this
//! module either — a reminder names a place and a time, never a person.
//!
//! Times: a transport's `datetime` and a ride's `meetDatetime` are instants
//! (RFC 3339, written by the app in UTC). This service does not know the
//! house's time zone, so no reminder prints a clock time. "Tomorrow" is decided
//! on the UTC calendar at an evening hour the configuration names; "in about
//! 2 h" is a duration and needs no zone at all.

use std::collections::HashMap;

use serde::Deserialize;
use time::format_description::well_known::Rfc3339;
use time::{Date, Duration, OffsetDateTime};
use yrs::{Any, Doc, Map, Out, ReadTxn, Transact};

use crate::dates::parse_iso_date;
use crate::i18n::Language;
use crate::trip_preview::TripRow;

// ============================================================================
// Types
// ============================================================================

/// The three things worth a push.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ReminderKind {
    /// The trip begins tomorrow (or today, if the evening tick was missed).
    TripStart,
    /// This guest's own arrival is tomorrow (or later today).
    OwnArrival,
    /// A ride this guest drives or rides in leaves within the window.
    Pickup,
}

impl ReminderKind {
    pub const ALL: [ReminderKind; 3] = [Self::TripStart, Self::OwnArrival, Self::Pickup];

    /// The `reminder_log.kind` value, and the `kind` property on every event.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TripStart => "trip_start",
            Self::OwnArrival => "own_arrival",
            Self::Pickup => "pickup",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == value)
    }

    /// The PostHog feature flag that switches this kind off.
    pub fn flag_key(self) -> &'static str {
        match self {
            Self::TripStart => "reminder-trip-start",
            Self::OwnArrival => "reminder-own-arrival",
            Self::Pickup => "reminder-pickup",
        }
    }
}

/// One row of `push_subscriptions`, as PostgREST returns it to the sender.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Subscription {
    pub id: String,
    pub trip_id: String,
    pub person_id: Option<String>,
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub locale: String,
    pub analytics_id: Option<String>,
}

impl Subscription {
    pub fn language(&self) -> Language {
        Language::parse(&self.locale).unwrap_or(crate::i18n::DEFAULT_LANGUAGE)
    }
}

/// A guest's arrival leg.
#[derive(Debug, Clone, PartialEq)]
pub struct Arrival {
    /// The transport id: the reminder's subject.
    pub id: String,
    pub person_id: String,
    pub at: OffsetDateTime,
    pub location: String,
}

/// A car journey, with everyone in it.
#[derive(Debug, Clone, PartialEq)]
pub struct RideFacts {
    /// The ride id (or, for a legacy one-passenger ride, the transport id).
    pub id: String,
    /// When the car must be at the meeting point.
    pub meet_at: OffsetDateTime,
    /// Minutes before `meet_at` that the driver sets off.
    pub lead_minutes: i64,
    pub location: String,
    pub driver_id: Option<String>,
    pub passenger_ids: Vec<String>,
}

/// What the sender needs to know about one trip.
#[derive(Debug, Clone, PartialEq)]
pub struct TripFacts {
    pub name: String,
    pub start_date: Option<Date>,
    pub arrivals: Vec<Arrival>,
    pub rides: Vec<RideFacts>,
}

/// When "now" is, and the two knobs the rules turn on.
#[derive(Debug, Clone, Copy)]
pub struct Clock {
    pub now: OffsetDateTime,
    /// The UTC hour from which "tomorrow" reminders go out. 17 is 18:00 or
    /// 19:00 in France, depending on the season.
    pub eve_hour_utc: u8,
    /// How far ahead a pickup is announced.
    pub pickup_window: Duration,
}

/// A reminder that is due now, with its text already written.
#[derive(Debug, Clone, PartialEq)]
pub struct DueReminder {
    pub kind: ReminderKind,
    /// What it is about: the start date, a transport id, a ride id. With the
    /// subscription and the kind, the key of `reminder_log`.
    pub subject: String,
    pub title: String,
    pub body: String,
    /// App-relative, no leading slash: what `sw-notifications.js` resolves
    /// against the registration scope when the notification is tapped.
    pub url: String,
}

// ============================================================================
// Constants
// ============================================================================

/// Root map keys, mirroring `COLLECTION_ROOT` in `src/lib/yjs/doc-model.ts`.
const TRANSPORT_ROOT: &str = "transportById";
const RIDES_ROOT: &str = "ridesById";

/// `DEFAULT_LEAD_TIME_MINUTES` in `src/types/index.ts`: what a ride means when
/// it names no lead time of its own.
const DEFAULT_LEAD_MINUTES: i64 = 30;

/// A lead time the app would never write. Anything past it is a corrupt row.
const MAX_LEAD_MINUTES: i64 = 24 * 60;

// ============================================================================
// Reading the document
// ============================================================================

/// Every field of every `Y.Map` in one root map, keyed by the map key.
///
/// Like `trip_preview::collection_rows`, but keeping numbers and booleans too:
/// `needsPickup` is a boolean and `leadTimeMinutes` a number. A value that is
/// not a map is skipped, the rule `readDocCollection` follows in the app.
fn rows_of(doc: &Doc, root: &str) -> Vec<(String, HashMap<String, Any>)> {
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
                Out::Any(any) => Some((field.to_string(), any)),
                _ => None,
            })
            .collect();
        rows.push((id.to_string(), fields));
    }
    rows
}

fn text<'a>(fields: &'a HashMap<String, Any>, key: &str) -> Option<&'a str> {
    match fields.get(key) {
        Some(Any::String(value)) if !value.is_empty() => Some(value.as_ref()),
        _ => None,
    }
}

fn number(fields: &HashMap<String, Any>, key: &str) -> Option<f64> {
    match fields.get(key) {
        Some(Any::Number(value)) => Some(*value),
        Some(Any::BigInt(value)) => Some(*value as f64),
        _ => None,
    }
}

fn instant(fields: &HashMap<String, Any>, key: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(text(fields, key)?, &Rfc3339).ok()
}

/// The lead time a ride row carries, or the app's default.
fn lead_minutes(fields: &HashMap<String, Any>) -> i64 {
    match number(fields, "leadTimeMinutes") {
        Some(value) if value.is_finite() && value >= 0.0 && value <= MAX_LEAD_MINUTES as f64 => {
            value.round() as i64
        }
        _ => DEFAULT_LEAD_MINUTES,
    }
}

/// Reads the arrivals and the rides out of a trip document.
///
/// `doc` is `None` when nothing readable came back; the trip then has a start
/// date and nothing else worth a reminder.
pub fn read_trip_facts(doc: Option<&Doc>, trip: &TripRow) -> TripFacts {
    let mut facts = TripFacts {
        name: trip.name.clone(),
        start_date: parse_iso_date(&trip.start_date),
        arrivals: Vec::new(),
        rides: Vec::new(),
    };

    let Some(doc) = doc else {
        return facts;
    };

    let transports = rows_of(doc, TRANSPORT_ROOT);

    // Passengers are a scalar on the leg, not an array on the ride — see the
    // note on `Transport.rideId` in `src/types/index.ts`.
    let mut passengers_by_ride: HashMap<String, Vec<String>> = HashMap::new();

    for (id, fields) in &transports {
        let (Some(person_id), Some(at)) = (text(fields, "personId"), instant(fields, "datetime"))
        else {
            continue;
        };
        let location = text(fields, "location").unwrap_or_default().to_owned();

        if text(fields, "type") == Some("arrival") {
            facts.arrivals.push(Arrival {
                id: id.clone(),
                person_id: person_id.to_owned(),
                at,
                location: location.clone(),
            });
        }

        if let Some(ride_id) = text(fields, "rideId") {
            passengers_by_ride
                .entry(ride_id.to_owned())
                .or_default()
                .push(person_id.to_owned());
        } else if let Some(driver_id) = text(fields, "driverId") {
            // A leg from before rides existed: one driver, one passenger,
            // meeting at the leg's own time and place. Read as a ride, never
            // upgraded into one (that would launder one device's guess into
            // the shared document) — the same reading `resolveRides()` makes
            // in the app.
            facts.rides.push(RideFacts {
                id: id.clone(),
                meet_at: at,
                lead_minutes: DEFAULT_LEAD_MINUTES,
                location,
                driver_id: Some(driver_id.to_owned()),
                passenger_ids: vec![person_id.to_owned()],
            });
        }
    }

    for (id, fields) in rows_of(doc, RIDES_ROOT) {
        let Some(meet_at) = instant(&fields, "meetDatetime") else {
            continue;
        };
        facts.rides.push(RideFacts {
            passenger_ids: passengers_by_ride.remove(&id).unwrap_or_default(),
            id,
            meet_at,
            lead_minutes: lead_minutes(&fields),
            location: text(&fields, "location").unwrap_or_default().to_owned(),
            driver_id: text(&fields, "driverId").map(str::to_owned),
        });
    }

    facts
}

// ============================================================================
// The rules
// ============================================================================

/// Whether `day` is what "tomorrow" means at this tick, or "today" as a catch-up.
///
/// `Some(true)` means tomorrow, announced from the evening hour on; `Some(false)`
/// means today, for a device that was unreachable the evening before — better
/// a reminder on the morning of than none. `None` means not yet, or gone.
fn eve_or_day_of(day: Date, clock: &Clock) -> Option<bool> {
    let today = clock.now.date();
    if day == today.next_day()? && clock.now.hour() >= clock.eve_hour_utc {
        return Some(true);
    }
    if day == today {
        return Some(false);
    }
    None
}

/// A duration as a person would say it: "45 min", "2 h", "2 h 30".
fn about(duration: Duration, language: Language) -> String {
    let minutes = duration.whole_minutes().max(0);
    let hours = minutes / 60;
    let rest = minutes % 60;
    match (hours, rest, language) {
        (0, m, _) => format!("{m} min"),
        (h, 0, _) => format!("{h} h"),
        (h, m, _) => format!("{h} h {m:02}"),
    }
}

/// The reminders a subscription is due right now.
///
/// `person_id` is the guest the device said it is; without one only the trip's
/// own start qualifies, because nothing else in the document is *theirs*.
pub fn due_reminders(
    facts: &TripFacts,
    person_id: Option<&str>,
    language: Language,
    clock: &Clock,
) -> Vec<DueReminder> {
    let mut due = Vec::new();
    let url = "";

    if let Some(start) = facts.start_date {
        if let Some(tomorrow) = eve_or_day_of(start, clock) {
            due.push(DueReminder {
                kind: ReminderKind::TripStart,
                subject: start.to_string(),
                title: text_trip_start_title(language, tomorrow),
                body: text_trip_start_body(language, &facts.name),
                url: url.to_owned(),
            });
        }
    }

    let Some(person_id) = person_id else {
        return due;
    };

    for arrival in facts.arrivals.iter().filter(|a| a.person_id == person_id) {
        let Some(tomorrow) = eve_or_day_of(arrival.at.date(), clock) else {
            continue;
        };
        // "Later today" only while it is still ahead.
        if !tomorrow && arrival.at <= clock.now {
            continue;
        }
        due.push(DueReminder {
            kind: ReminderKind::OwnArrival,
            subject: arrival.id.clone(),
            title: text_arrival_title(language, tomorrow),
            body: text_arrival_body(language, &arrival.location, &facts.name),
            url: url.to_owned(),
        });
    }

    for ride in &facts.rides {
        let driving = ride.driver_id.as_deref() == Some(person_id);
        let riding = ride.passenger_ids.iter().any(|id| id == person_id);
        if !driving && !riding {
            continue;
        }
        // The driver is told when to set off; a passenger when to be there.
        let moment = if driving {
            ride.meet_at - Duration::minutes(ride.lead_minutes)
        } else {
            ride.meet_at
        };
        if moment < clock.now || moment >= clock.now + clock.pickup_window {
            continue;
        }
        let in_about = about(moment - clock.now, language);
        due.push(DueReminder {
            kind: ReminderKind::Pickup,
            subject: ride.id.clone(),
            title: text_pickup_title(language, driving),
            body: text_pickup_body(language, driving, &ride.location, &in_about),
            url: url.to_owned(),
        });
    }

    due
}

// ============================================================================
// Text
// ============================================================================

fn text_trip_start_title(language: Language, tomorrow: bool) -> String {
    match (language, tomorrow) {
        (Language::En, true) => "Your trip starts tomorrow".to_owned(),
        (Language::En, false) => "Your trip starts today".to_owned(),
        (Language::Fr, true) => "Votre séjour commence demain".to_owned(),
        (Language::Fr, false) => "Votre séjour commence aujourd'hui".to_owned(),
    }
}

fn text_trip_start_body(language: Language, trip_name: &str) -> String {
    match language {
        Language::En => format!("{trip_name}: see who arrives when, and who sleeps where."),
        Language::Fr => format!("{trip_name} : qui arrive quand, et qui dort où."),
    }
}

fn text_arrival_title(language: Language, tomorrow: bool) -> String {
    match (language, tomorrow) {
        (Language::En, true) => "You arrive tomorrow".to_owned(),
        (Language::En, false) => "You arrive today".to_owned(),
        (Language::Fr, true) => "Vous arrivez demain".to_owned(),
        (Language::Fr, false) => "Vous arrivez aujourd'hui".to_owned(),
    }
}

fn text_arrival_body(language: Language, location: &str, trip_name: &str) -> String {
    match (language, location.is_empty()) {
        (Language::En, false) => format!("{location} — check your ride to {trip_name}."),
        (Language::En, true) => format!("Check your ride to {trip_name}."),
        (Language::Fr, false) => format!("{location} : vérifiez votre trajet vers {trip_name}."),
        (Language::Fr, true) => format!("Vérifiez votre trajet vers {trip_name}."),
    }
}

fn text_pickup_title(language: Language, driving: bool) -> String {
    match (language, driving) {
        (Language::En, true) => "Time to leave soon".to_owned(),
        (Language::En, false) => "Your ride is coming".to_owned(),
        (Language::Fr, true) => "Départ bientôt".to_owned(),
        (Language::Fr, false) => "Votre trajet approche".to_owned(),
    }
}

fn text_pickup_body(language: Language, driving: bool, location: &str, in_about: &str) -> String {
    let place = if location.is_empty() {
        None
    } else {
        Some(location)
    };
    match (language, driving, place) {
        (Language::En, true, Some(place)) => {
            format!("Set off for the pickup at {place} in about {in_about}.")
        }
        (Language::En, true, None) => format!("Set off for the pickup in about {in_about}."),
        (Language::En, false, Some(place)) => {
            format!("The car meets you at {place} in about {in_about}.")
        }
        (Language::En, false, None) => format!("The car meets you in about {in_about}."),
        (Language::Fr, true, Some(place)) => {
            format!("Partez pour {place} dans environ {in_about}.")
        }
        (Language::Fr, true, None) => format!("Partez dans environ {in_about}."),
        (Language::Fr, false, Some(place)) => {
            format!("La voiture vous attend à {place} dans environ {in_about}.")
        }
        (Language::Fr, false, None) => format!("La voiture arrive dans environ {in_about}."),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{MapPrelim, Transact};

    fn trip() -> TripRow {
        TripRow {
            name: "Brittany".to_owned(),
            start_date: "2026-07-15".to_owned(),
            end_date: "2026-07-22".to_owned(),
        }
    }

    fn at(stamp: &str) -> OffsetDateTime {
        OffsetDateTime::parse(stamp, &Rfc3339).expect("a fixed instant")
    }

    fn clock(stamp: &str) -> Clock {
        Clock {
            now: at(stamp),
            eve_hour_utc: 17,
            pickup_window: Duration::hours(3),
        }
    }

    /// One `Y.Map` per row, the way the app writes them, with typed fields.
    fn doc_with(
        transports: &[(&str, &[(&str, Any)])],
        rides: &[(&str, &[(&str, Any)])],
    ) -> Doc {
        let doc = Doc::new();
        for (root, rows) in [(TRANSPORT_ROOT, transports), (RIDES_ROOT, rides)] {
            let map = doc.get_or_insert_map(root);
            let mut txn = doc.transact_mut();
            for (id, fields) in rows {
                let row = map.insert(&mut txn, (*id).to_owned(), MapPrelim::default());
                for (key, value) in *fields {
                    row.insert(&mut txn, (*key).to_owned(), value.clone());
                }
            }
        }
        doc
    }

    fn s(value: &str) -> Any {
        Any::from(value)
    }

    fn arrival_leg(person: &str, when: &str, ride: Option<&str>) -> Vec<(&'static str, Any)> {
        let mut fields = vec![
            ("personId", s(person)),
            ("type", s("arrival")),
            ("datetime", s(when)),
            ("location", s("Rennes station")),
            ("needsPickup", Any::Bool(true)),
        ];
        if let Some(ride) = ride {
            fields.push(("rideId", s(ride)));
        }
        fields
    }

    #[test]
    fn kinds_round_trip_through_their_names() {
        for kind in ReminderKind::ALL {
            assert_eq!(ReminderKind::parse(kind.as_str()), Some(kind));
        }
        assert_eq!(ReminderKind::parse("marketing"), None);
    }

    #[test]
    fn reads_arrivals_rides_and_passengers_out_of_the_document() {
        let alice = arrival_leg("alice", "2026-07-15T14:30:00Z", Some("ride-1"));
        let bob = arrival_leg("bob", "2026-07-15T14:35:00Z", Some("ride-1"));
        let doc = doc_with(
            &[("t-alice", &alice), ("t-bob", &bob)],
            &[(
                "ride-1",
                &[
                    ("direction", s("pickup")),
                    ("meetDatetime", s("2026-07-15T14:40:00Z")),
                    ("location", s("Rennes station")),
                    ("leadTimeMinutes", Any::Number(45.0)),
                    ("driverId", s("carol")),
                ],
            )],
        );

        let facts = read_trip_facts(Some(&doc), &trip());

        assert_eq!(facts.start_date, parse_iso_date("2026-07-15"));
        assert_eq!(facts.arrivals.len(), 2);
        assert_eq!(facts.rides.len(), 1);
        let ride = &facts.rides[0];
        assert_eq!(ride.driver_id.as_deref(), Some("carol"));
        assert_eq!(ride.lead_minutes, 45);
        let mut passengers = ride.passenger_ids.clone();
        passengers.sort();
        assert_eq!(passengers, ["alice", "bob"]);
    }

    #[test]
    fn reads_a_legacy_leg_with_a_driver_as_a_one_passenger_ride() {
        let mut leg = arrival_leg("alice", "2026-07-15T14:30:00Z", None);
        leg.push(("driverId", s("carol")));
        let doc = doc_with(&[("t-alice", &leg)], &[]);

        let facts = read_trip_facts(Some(&doc), &trip());

        assert_eq!(facts.rides.len(), 1);
        assert_eq!(facts.rides[0].id, "t-alice");
        assert_eq!(facts.rides[0].passenger_ids, ["alice"]);
        assert_eq!(facts.rides[0].lead_minutes, DEFAULT_LEAD_MINUTES);
    }

    #[test]
    fn skips_rows_without_a_readable_instant_and_absurd_lead_times() {
        let broken = vec![("personId", s("alice")), ("type", s("arrival")), ("datetime", s("soon"))];
        let doc = doc_with(
            &[("t-1", &broken)],
            &[(
                "ride-1",
                &[
                    ("meetDatetime", s("2026-07-15T14:40:00Z")),
                    ("leadTimeMinutes", Any::Number(-5.0)),
                ],
            )],
        );

        let facts = read_trip_facts(Some(&doc), &trip());

        assert!(facts.arrivals.is_empty());
        assert_eq!(facts.rides[0].lead_minutes, DEFAULT_LEAD_MINUTES);
    }

    #[test]
    fn the_trip_start_goes_out_on_the_eve_from_the_evening_hour() {
        let facts = read_trip_facts(None, &trip());

        assert!(due_reminders(&facts, None, Language::En, &clock("2026-07-14T16:59:00Z")).is_empty());

        let due = due_reminders(&facts, None, Language::En, &clock("2026-07-14T17:00:00Z"));
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].kind, ReminderKind::TripStart);
        assert_eq!(due[0].subject, "2026-07-15");
        assert_eq!(due[0].title, "Your trip starts tomorrow");
        assert!(due[0].body.contains("Brittany"));
    }

    #[test]
    fn a_missed_eve_is_caught_up_on_the_day_and_then_dropped() {
        let facts = read_trip_facts(None, &trip());

        let on_the_day = due_reminders(&facts, None, Language::Fr, &clock("2026-07-15T08:00:00Z"));
        assert_eq!(on_the_day[0].title, "Votre séjour commence aujourd'hui");

        assert!(due_reminders(&facts, None, Language::Fr, &clock("2026-07-16T08:00:00Z")).is_empty());
    }

    #[test]
    fn an_arrival_is_only_ever_the_subscribers_own() {
        // The 17th, not the 15th: on the trip's own start day the trip_start
        // catch-up would be due as well, and this test is about arrivals.
        let alice = arrival_leg("alice", "2026-07-17T14:30:00Z", None);
        let doc = doc_with(&[("t-alice", &alice)], &[]);
        let facts = read_trip_facts(Some(&doc), &trip());
        let eve = clock("2026-07-16T18:00:00Z");

        let for_alice = due_reminders(&facts, Some("alice"), Language::En, &eve);
        assert_eq!(for_alice.len(), 1);
        assert_eq!(for_alice[0].kind, ReminderKind::OwnArrival);
        assert_eq!(for_alice[0].subject, "t-alice");
        assert!(for_alice[0].body.starts_with("Rennes station"));

        assert!(due_reminders(&facts, Some("bob"), Language::En, &eve).is_empty());
        assert!(due_reminders(&facts, None, Language::En, &eve).is_empty());
    }

    #[test]
    fn an_arrival_later_today_is_announced_only_while_still_ahead() {
        let alice = arrival_leg("alice", "2026-07-16T14:30:00Z", None);
        let doc = doc_with(&[("t-alice", &alice)], &[]);
        let facts = read_trip_facts(Some(&doc), &trip());

        assert_eq!(
            due_reminders(&facts, Some("alice"), Language::En, &clock("2026-07-16T09:00:00Z")).len(),
            1
        );
        assert!(
            due_reminders(&facts, Some("alice"), Language::En, &clock("2026-07-16T15:00:00Z"))
                .is_empty()
        );
    }

    #[test]
    fn the_driver_is_told_to_set_off_and_the_passenger_to_be_there() {
        let alice = arrival_leg("alice", "2026-07-17T14:30:00Z", Some("ride-1"));
        let doc = doc_with(
            &[("t-alice", &alice)],
            &[(
                "ride-1",
                &[
                    ("meetDatetime", s("2026-07-17T14:40:00Z")),
                    ("location", s("Rennes station")),
                    ("leadTimeMinutes", Any::Number(40.0)),
                    ("driverId", s("carol")),
                ],
            )],
        );
        let facts = read_trip_facts(Some(&doc), &trip());
        // Departure at 14:00, meeting at 14:40; the window is three hours.
        let tick = clock("2026-07-17T11:30:00Z");

        let carol = due_reminders(&facts, Some("carol"), Language::En, &tick);
        assert_eq!(carol.len(), 1);
        assert_eq!(carol[0].kind, ReminderKind::Pickup);
        assert_eq!(carol[0].subject, "ride-1");
        assert_eq!(carol[0].body, "Set off for the pickup at Rennes station in about 2 h 30.");

        // Alice's meeting is 3h10 away: outside the window for one more tick.
        // (Her arrival later that day is due, and is a different reminder.)
        let pickups_for = |person: &str, at: &Clock| {
            due_reminders(&facts, Some(person), Language::Fr, at)
                .into_iter()
                .filter(|reminder| reminder.kind == ReminderKind::Pickup)
                .collect::<Vec<_>>()
        };
        assert!(pickups_for("alice", &tick).is_empty());
        let later = clock("2026-07-17T12:30:00Z");
        let alice_due = pickups_for("alice", &later);
        assert_eq!(alice_due.len(), 1);
        assert_eq!(
            alice_due[0].body,
            "La voiture vous attend à Rennes station dans environ 2 h 10."
        );

        // Somebody in neither seat hears nothing.
        assert!(due_reminders(&facts, Some("dave"), Language::En, &tick).is_empty());
    }

    #[test]
    fn a_pickup_already_departed_is_not_announced() {
        let doc = doc_with(
            &[],
            &[(
                "ride-1",
                &[
                    ("meetDatetime", s("2026-07-17T14:40:00Z")),
                    ("leadTimeMinutes", Any::Number(40.0)),
                    ("driverId", s("carol")),
                ],
            )],
        );
        let facts = read_trip_facts(Some(&doc), &trip());

        assert!(
            due_reminders(&facts, Some("carol"), Language::En, &clock("2026-07-17T14:01:00Z"))
                .is_empty()
        );
    }

    #[test]
    fn on_the_start_day_the_trip_and_the_arrival_are_both_due() {
        // The catch-up for a missed eve and an arrival later that day coexist:
        // two reminders, two subjects, one tick.
        let alice = arrival_leg("alice", "2026-07-15T14:30:00Z", None);
        let doc = doc_with(&[("t-alice", &alice)], &[]);
        let facts = read_trip_facts(Some(&doc), &trip());

        let due = due_reminders(&facts, Some("alice"), Language::En, &clock("2026-07-15T08:00:00Z"));

        assert_eq!(
            due.iter().map(|r| r.kind).collect::<Vec<_>>(),
            [ReminderKind::TripStart, ReminderKind::OwnArrival]
        );
    }

    #[test]
    fn durations_read_the_way_people_say_them() {
        assert_eq!(about(Duration::minutes(45), Language::En), "45 min");
        assert_eq!(about(Duration::minutes(120), Language::En), "2 h");
        assert_eq!(about(Duration::minutes(150), Language::Fr), "2 h 30");
        assert_eq!(about(Duration::minutes(-5), Language::En), "0 min");
    }

    #[test]
    fn no_reminder_ever_carries_a_guest_name() {
        let alice = arrival_leg("Alice Martin", "2026-07-16T14:30:00Z", None);
        let doc = doc_with(&[("t-alice", &alice)], &[]);
        let facts = read_trip_facts(Some(&doc), &trip());

        for reminder in due_reminders(
            &facts,
            Some("Alice Martin"),
            Language::En,
            &clock("2026-07-15T18:00:00Z"),
        ) {
            assert!(!reminder.title.contains("Alice"));
            assert!(!reminder.body.contains("Alice"));
        }
    }
}
