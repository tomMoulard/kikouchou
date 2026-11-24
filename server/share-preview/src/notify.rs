//! `POST /push/notify`: tell the people a change is about, now.
//!
//! The reminders are swept for once an interval. A change that involves a
//! guest cannot wait for the sweep, and is asked for by the device that made
//! it, the moment the change has reached the server:
//!
//! - `activity_invite`: guests were invited to an activity. Every device
//!   subscribed as an invited guest is told, once per activity.
//! - `money_line`: a money line was added or changed. Every device subscribed
//!   as a guest on it (the payer, or one of its shares) is told, once per
//!   version of the line: the subject carries a digest of what the line says,
//!   so a save that changed nothing is not told again.
//! - `trip_change`: any other row naming a guest was added or changed: the
//!   guest's own stay, a room night, a journey, a ride, a car, an activity they
//!   are in or run, a meal they cook, a shopping item they buy. The request
//!   names the collection; the server reads who the row names. Told once per
//!   version of the row, like a money line.
//!
//! The guest who made the change is never told. The document says who did:
//! `invitedBy` on an invitation, `updatedBy` on every other row.
//!
//! Everything here is a pure function of a request body, a document and a
//! language, tested without a socket. `main.rs` checks who is asking and
//! `push_sender` delivers. Like the reminders, no guest's name is written into
//! a notification: a lock screen is read by whoever holds the phone.

use std::collections::{BTreeSet, HashMap};

use serde::Deserialize;
use yrs::{Any, Doc, Map, Out, ReadTxn, Transact};

use crate::i18n::Language;
use crate::reminders::{DueReminder, ReminderKind};
use crate::trip_source::is_uuid_shaped;

// ============================================================================
// Types
// ============================================================================

/// What a device asks for, once its change has reached the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotifyRequest {
    /// The shared trip, `trips.id`.
    pub trip_id: String,
    /// `ActivityInvite`, `MoneyLine` or `TripChange`.
    pub kind: ReminderKind,
    /// The row's id in the document.
    pub subject_id: String,
    /// Which rows the id is in. Set for `TripChange` only.
    pub collection: Option<Collection>,
}

/// The collections whose rows name guests, for a `trip_change`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Collection {
    Guests,
    RoomAssignments,
    Transport,
    Rides,
    Vehicles,
    Activities,
    Meals,
    ShoppingItems,
}

impl Collection {
    pub const ALL: [Collection; 8] = [
        Self::Guests,
        Self::RoomAssignments,
        Self::Transport,
        Self::Rides,
        Self::Vehicles,
        Self::Activities,
        Self::Meals,
        Self::ShoppingItems,
    ];

    /// The name the app gives it, `COLLECTION_ROOT`'s keys in `doc-model.ts`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Guests => "guests",
            Self::RoomAssignments => "roomAssignments",
            Self::Transport => "transport",
            Self::Rides => "rides",
            Self::Vehicles => "vehicles",
            Self::Activities => "activities",
            Self::Meals => "meals",
            Self::ShoppingItems => "shoppingItems",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == value)
    }

    /// The root map in the document.
    fn root(self) -> &'static str {
        match self {
            Self::Guests => "guestsById",
            Self::RoomAssignments => "roomAssignmentsById",
            Self::Transport => TRANSPORT_ROOT,
            Self::Rides => RIDES_ROOT,
            Self::Vehicles => "vehiclesById",
            Self::Activities => ACTIVITIES_ROOT,
            Self::Meals => "mealsById",
            Self::ShoppingItems => "shoppingItemsById",
        }
    }

    /// A short tag in the log's subject, which has 64 characters to hold it.
    fn code(self) -> &'static str {
        match self {
            Self::Guests => "g",
            Self::RoomAssignments => "ra",
            Self::Transport => "t",
            Self::Rides => "r",
            Self::Vehicles => "v",
            Self::Activities => "a",
            Self::Meals => "m",
            Self::ShoppingItems => "s",
        }
    }
}

/// Who to tell about one change, and the words to tell them with.
#[derive(Debug, Clone, PartialEq)]
pub struct Notice {
    pub kind: ReminderKind,
    /// The `reminder_log` subject: the activity id, or the row and a digest.
    pub subject: String,
    /// What every version of the same row's subject starts with: a device
    /// told about one before is told this one is a change, not a new row.
    /// `None` for an invitation, told once.
    pub version_prefix: Option<String>,
    /// The collection, for a `trip_change`: it picks the words.
    pub collection: Option<Collection>,
    /// The guests to tell, the author already taken out.
    pub recipients: BTreeSet<String>,
    /// The row's title, as the document has it; empty where a row's only
    /// name could be a guest's (a stay, a car).
    pub item_title: String,
}

#[derive(Deserialize)]
struct RawRequest {
    trip_id: String,
    kind: String,
    subject_id: String,
    #[serde(default)]
    collection: Option<String>,
}

// ============================================================================
// Constants
// ============================================================================

/// The most a body may be. A request is under 200 bytes.
pub const MAX_BODY_BYTES: usize = 1024;

/// Root map keys, mirroring `COLLECTION_ROOT` in `src/lib/yjs/doc-model.ts`.
const ACTIVITIES_ROOT: &str = "activitiesById";
const EXPENSES_ROOT: &str = "expensesById";
const TRANSPORT_ROOT: &str = "transportById";
const RIDES_ROOT: &str = "ridesById";

/// Fields that never make a version of a row: who saved it and when, and the
/// invitations, which are told about as invitations.
const NOT_A_CHANGE: [&str; 8] = [
    "id",
    "tripId",
    "createdAt",
    "updatedAt",
    "updatedBy",
    "invitedIds",
    "declinedIds",
    "invitedBy",
];

/// The longest document id taken: the app's ids are 21 characters, and the
/// subject (a tag, id, a colon, a 16-digit digest) has to fit `reminder_log`'s
/// 64.
const MAX_SUBJECT_ID_LEN: usize = 40;

/// The longest title written into a notification.
const MAX_TITLE_CHARS: usize = 60;

// ============================================================================
// Parsing
// ============================================================================

/// Reads a request body, refusing anything not shaped like one.
///
/// # Errors
///
/// A short reason, for the 400 answer.
pub fn parse_request(body: &[u8]) -> Result<NotifyRequest, &'static str> {
    if body.len() > MAX_BODY_BYTES {
        return Err("body too large");
    }
    let raw: RawRequest = serde_json::from_slice(body).map_err(|_| "body is not a request")?;
    if !is_uuid_shaped(&raw.trip_id) {
        return Err("trip_id is not a trip id");
    }
    let kind = match ReminderKind::parse(&raw.kind) {
        Some(
            kind @ (ReminderKind::ActivityInvite
            | ReminderKind::MoneyLine
            | ReminderKind::TripChange),
        ) => kind,
        _ => return Err("kind is not one a device can ask for"),
    };
    let collection = match (kind, raw.collection.as_deref()) {
        (ReminderKind::TripChange, Some(name)) => {
            Some(Collection::parse(name).ok_or("collection is not one that names guests")?)
        }
        (ReminderKind::TripChange, None) => return Err("a trip_change names its collection"),
        _ => None,
    };
    if raw.subject_id.is_empty()
        || raw.subject_id.len() > MAX_SUBJECT_ID_LEN
        || !raw
            .subject_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("subject_id is not a document id");
    }
    Ok(NotifyRequest {
        trip_id: raw.trip_id,
        kind,
        subject_id: raw.subject_id,
        collection,
    })
}

/// The origin a page may call from, echoed back, or `None` when it may not.
///
/// Exact matches only: a wildcard would let any page holding a member's token
/// ask for pushes, and the token is what gates the endpoint, but there is no
/// reason to widen it.
pub fn allowed_origin<'a>(origin: Option<&'a str>, allowed: &[String]) -> Option<&'a str> {
    let origin = origin?;
    allowed
        .iter()
        .any(|candidate| candidate == origin)
        .then_some(origin)
}

// ============================================================================
// Reading the document
// ============================================================================

/// One row of a root map, every plain field kept. `None` when it is not there.
fn row_of(doc: &Doc, root: &str, id: &str) -> Option<HashMap<String, Any>> {
    let txn = doc.transact();
    let map = txn.get_map(root)?;
    let Out::YMap(row) = map.get(&txn, id)? else {
        return None;
    };
    Some(
        row.iter(&txn)
            .filter_map(|(field, value)| match value {
                Out::Any(any) => Some((field.to_string(), any)),
                _ => None,
            })
            .collect(),
    )
}

fn text<'a>(fields: &'a HashMap<String, Any>, key: &str) -> Option<&'a str> {
    match fields.get(key) {
        Some(Any::String(value)) if !value.is_empty() => Some(value.as_ref()),
        _ => None,
    }
}

/// The non-empty strings of an array field.
fn strings(fields: &HashMap<String, Any>, key: &str) -> Vec<String> {
    match fields.get(key) {
        Some(Any::Array(values)) => values
            .iter()
            .filter_map(|value| match value {
                Any::String(id) if !id.is_empty() => Some(id.to_string()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// The `personId` of every share of a line.
fn split_person_ids(fields: &HashMap<String, Any>) -> Vec<String> {
    match fields.get("splits") {
        Some(Any::Array(splits)) => splits
            .iter()
            .filter_map(|split| match split {
                Any::Map(split) => match split.get("personId") {
                    Some(Any::String(id)) if !id.is_empty() => Some(id.to_string()),
                    _ => None,
                },
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// A title cut to what a notification shows.
fn short_title(title: Option<&str>) -> String {
    let title = title.unwrap_or("").trim();
    if title.chars().count() <= MAX_TITLE_CHARS {
        return title.to_owned();
    }
    let mut cut: String = title.chars().take(MAX_TITLE_CHARS - 1).collect();
    cut.push('…');
    cut
}

/// FNV-1a, 64 bits: a digest stable across builds and restarts, which the
/// standard library's hasher does not promise, and the log keys on it.
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// What a line says, as one string: the fields a person on it would care
/// about, in a fixed order. `updatedBy` is not one of them: the same line saved
/// by somebody else is the same line.
fn line_fingerprint(fields: &HashMap<String, Any>) -> String {
    let mut shares: Vec<String> = match fields.get("splits") {
        Some(Any::Array(splits)) => splits
            .iter()
            .filter_map(|split| match split {
                Any::Map(split) => Some(format!(
                    "{}={}",
                    match split.get("personId") {
                        Some(Any::String(id)) => id.to_string(),
                        _ => String::new(),
                    },
                    match split.get("value") {
                        Some(Any::Number(value)) => value.to_string(),
                        Some(Any::BigInt(value)) => value.to_string(),
                        _ => String::new(),
                    },
                )),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };
    shares.sort();
    let amount = match fields.get("amount") {
        Some(Any::Number(value)) => value.to_string(),
        Some(Any::BigInt(value)) => value.to_string(),
        _ => String::new(),
    };
    [
        text(fields, "kind").unwrap_or(""),
        text(fields, "title").unwrap_or(""),
        text(fields, "date").unwrap_or(""),
        &amount,
        text(fields, "payerId").unwrap_or(""),
        text(fields, "splitMode").unwrap_or(""),
        &shares.join(","),
    ]
    .join("\u{1f}")
}

/// The ids of the rows of a root map whose `field` is `value`.
fn rows_where(doc: &Doc, root: &str, field: &str, value: &str) -> Vec<HashMap<String, Any>> {
    let txn = doc.transact();
    let Some(map) = txn.get_map(root) else {
        return Vec::new();
    };
    map.iter(&txn)
        .filter_map(|(_, row)| match row {
            Out::YMap(row) => match row.get(&txn, field) {
                Some(Out::Any(Any::String(found))) if found.as_ref() == value => Some(
                    row.iter(&txn)
                        .filter_map(|(key, value)| match value {
                            Out::Any(any) => Some((key.to_string(), any)),
                            _ => None,
                        })
                        .collect(),
                ),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

/// A value written the same way on every run: map keys sorted, which a
/// `HashMap` does not promise.
fn canonical(value: &Any, out: &mut String) {
    match value {
        Any::Null | Any::Undefined => out.push('~'),
        Any::Bool(value) => out.push_str(if *value { "T" } else { "F" }),
        Any::Number(value) => out.push_str(&value.to_string()),
        Any::BigInt(value) => out.push_str(&value.to_string()),
        Any::String(value) => {
            out.push('"');
            out.push_str(value);
            out.push('"');
        }
        Any::Buffer(bytes) => out.push_str(&format!("b{}", bytes.len())),
        Any::Array(values) => {
            out.push('[');
            for value in values.iter() {
                canonical(value, out);
                out.push(',');
            }
            out.push(']');
        }
        Any::Map(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for key in keys {
                out.push_str(key);
                out.push('=');
                canonical(&map[key], out);
                out.push(',');
            }
            out.push('}');
        }
    }
}

/// What a row says, as one string: every field but who saved it, when, and
/// the invitations. The same row saved again unchanged is the same version.
fn row_fingerprint(fields: &HashMap<String, Any>) -> String {
    let mut keys: Vec<&String> = fields
        .keys()
        .filter(|key| !NOT_A_CHANGE.contains(&key.as_str()))
        .collect();
    keys.sort();
    let mut out = String::new();
    for key in keys {
        out.push_str(key);
        out.push('=');
        canonical(&fields[key], &mut out);
        out.push('\u{1f}');
    }
    out
}

/// The guests a row of a collection names, read from the document.
fn named_guests(
    doc: &Doc,
    collection: Collection,
    id: &str,
    fields: &HashMap<String, Any>,
) -> BTreeSet<String> {
    let mut guests = BTreeSet::new();
    let mut add = |value: Option<&str>| {
        if let Some(value) = value {
            guests.insert(value.to_owned());
        }
    };
    match collection {
        // A guest's own row: their stay, their phone, their diet.
        Collection::Guests => add(Some(id)),
        Collection::RoomAssignments | Collection::Transport => {
            add(text(fields, "personId"));
            if collection == Collection::Transport {
                // Who drives them: the leg's own driver, or the ride's.
                add(text(fields, "driverId"));
                if let Some(ride) =
                    text(fields, "rideId").and_then(|ride_id| row_of(doc, RIDES_ROOT, ride_id))
                {
                    add(text(&ride, "driverId"));
                }
            }
        }
        Collection::Rides => {
            add(text(fields, "driverId"));
            for leg in rows_where(doc, TRANSPORT_ROOT, "rideId", id) {
                add(text(&leg, "personId"));
            }
        }
        Collection::Vehicles => add(text(fields, "ownerId")),
        Collection::Activities => {
            add(text(fields, "organizerId"));
            for guest in strings(fields, "participantIds") {
                add(Some(&guest));
            }
        }
        Collection::Meals => {
            for guest in strings(fields, "organizerIds") {
                add(Some(&guest));
            }
        }
        Collection::ShoppingItems => add(text(fields, "buyerId")),
    }
    guests
}

/// The title a notification may show for a row: never a field that could be
/// a guest's name (a stay is the guest's, a car is often "Alice's car").
fn safe_title(collection: Collection, fields: &HashMap<String, Any>) -> String {
    match collection {
        Collection::Activities => short_title(text(fields, "title")),
        Collection::ShoppingItems => short_title(text(fields, "name")),
        _ => String::new(),
    }
}

/// Who to tell about a change, read from the live document.
///
/// `None` when the document does not hold the row (yet: the device asks once
/// its change reached the server, but a peer may have deleted it since), or
/// when nobody but the author is concerned.
pub fn notice_for(doc: &Doc, request: &NotifyRequest) -> Option<Notice> {
    let (mut recipients, author, subject, version_prefix, item_title) = match request.kind {
        ReminderKind::ActivityInvite => {
            let fields = row_of(doc, ACTIVITIES_ROOT, &request.subject_id)?;
            let joined: BTreeSet<String> = strings(&fields, "participantIds").into_iter().collect();
            let recipients: BTreeSet<String> = strings(&fields, "invitedIds")
                .into_iter()
                .filter(|id| !joined.contains(id))
                .collect();
            let author = text(&fields, "invitedBy").map(str::to_owned);
            (
                recipients,
                author,
                request.subject_id.clone(),
                None,
                short_title(text(&fields, "title")),
            )
        }
        ReminderKind::MoneyLine => {
            let fields = row_of(doc, EXPENSES_ROOT, &request.subject_id)?;
            let mut recipients: BTreeSet<String> = split_person_ids(&fields).into_iter().collect();
            if let Some(payer) = text(&fields, "payerId") {
                recipients.insert(payer.to_owned());
            }
            let author = text(&fields, "updatedBy").map(str::to_owned);
            let digest = fnv1a(line_fingerprint(&fields).as_bytes());
            let prefix = format!("{}:", request.subject_id);
            (
                recipients,
                author,
                format!("{prefix}{digest:016x}"),
                Some(prefix),
                short_title(text(&fields, "title")),
            )
        }
        ReminderKind::TripChange => {
            let collection = request.collection?;
            let fields = row_of(doc, collection.root(), &request.subject_id)?;
            let recipients = named_guests(doc, collection, &request.subject_id, &fields);
            let author = text(&fields, "updatedBy").map(str::to_owned);
            let digest = fnv1a(row_fingerprint(&fields).as_bytes());
            let prefix = format!("{}:{}:", collection.code(), request.subject_id);
            (
                recipients,
                author,
                format!("{prefix}{digest:016x}"),
                Some(prefix),
                safe_title(collection, &fields),
            )
        }
        _ => return None,
    };

    if let Some(author) = author {
        recipients.remove(&author);
    }
    if recipients.is_empty() {
        return None;
    }

    Some(Notice {
        kind: request.kind,
        subject,
        version_prefix,
        collection: request.collection,
        recipients,
        item_title,
    })
}

/// Whether the document holds the row a request names.
pub fn holds_subject(doc: &Doc, request: &NotifyRequest) -> bool {
    let root = match (request.kind, request.collection) {
        (ReminderKind::ActivityInvite, _) => ACTIVITIES_ROOT,
        (ReminderKind::MoneyLine, _) => EXPENSES_ROOT,
        (ReminderKind::TripChange, Some(collection)) => collection.root(),
        _ => return false,
    };
    row_of(doc, root, &request.subject_id).is_some()
}

/// Whether a logged subject is a version of the row a notice is about.
pub fn is_version_of(subject: &str, notice: &Notice) -> bool {
    notice
        .version_prefix
        .as_deref()
        .is_some_and(|prefix| subject.starts_with(prefix))
}

// ============================================================================
// Words
// ============================================================================

/// The title of a `trip_change`, by collection: new to this device, or a
/// change to a row it was told about before.
fn change_title(collection: Collection, language: Language, changed: bool, item: &str) -> String {
    use Collection as C;
    use Language::{En, Fr};
    match (collection, language, changed) {
        (C::Guests, En, false) => "Your stay was added".to_owned(),
        (C::Guests, En, true) => "Your stay was updated".to_owned(),
        (C::Guests, Fr, false) => "Votre séjour a été ajouté".to_owned(),
        (C::Guests, Fr, true) => "Votre séjour a été modifié".to_owned(),
        (C::RoomAssignments, En, false) => "You have a room".to_owned(),
        (C::RoomAssignments, En, true) => "Your room changed".to_owned(),
        (C::RoomAssignments, Fr, false) => "Une chambre vous attend".to_owned(),
        (C::RoomAssignments, Fr, true) => "Votre chambre a changé".to_owned(),
        (C::Transport, En, false) => "A journey was added for you".to_owned(),
        (C::Transport, En, true) => "Your journey changed".to_owned(),
        (C::Transport, Fr, false) => "Un trajet a été ajouté pour vous".to_owned(),
        (C::Transport, Fr, true) => "Votre trajet a changé".to_owned(),
        (C::Rides, En, false) => "You're on a ride".to_owned(),
        (C::Rides, En, true) => "A ride you're on changed".to_owned(),
        (C::Rides, Fr, false) => "Un covoiturage vous concerne".to_owned(),
        (C::Rides, Fr, true) => "Un covoiturage qui vous concerne a changé".to_owned(),
        (C::Vehicles, En, false) => "Your car was added".to_owned(),
        (C::Vehicles, En, true) => "Your car's details changed".to_owned(),
        (C::Vehicles, Fr, false) => "Votre voiture a été ajoutée".to_owned(),
        (C::Vehicles, Fr, true) => "Votre voiture a été modifiée".to_owned(),
        (C::Activities, En, false) => format!("You're in: {item}"),
        (C::Activities, En, true) => format!("Changed: {item}"),
        (C::Activities, Fr, false) => format!("Vous participez : {item}"),
        (C::Activities, Fr, true) => format!("Modifié : {item}"),
        (C::Meals, En, false) => "You're cooking a meal".to_owned(),
        (C::Meals, En, true) => "A meal you cook changed".to_owned(),
        (C::Meals, Fr, false) => "Vous cuisinez un repas".to_owned(),
        (C::Meals, Fr, true) => "Un repas que vous préparez a changé".to_owned(),
        (C::ShoppingItems, En, false) => format!("To buy: {item}"),
        (C::ShoppingItems, En, true) => format!("Changed on the shopping list: {item}"),
        (C::ShoppingItems, Fr, false) => format!("À acheter : {item}"),
        (C::ShoppingItems, Fr, true) => format!("Modifié dans les courses : {item}"),
    }
}

/// The notification for one device.
///
/// `seen_before` is for a row told in versions (a money line, a trip change):
/// whether this device was already told about an earlier version of it, which
/// makes this one a change rather than a new row.
pub fn render(
    notice: &Notice,
    trip_id: &str,
    trip_name: &str,
    language: Language,
    seen_before: bool,
) -> DueReminder {
    let item = if notice.item_title.is_empty() {
        match language {
            Language::En => "Untitled".to_owned(),
            Language::Fr => "Sans titre".to_owned(),
        }
    } else {
        notice.item_title.clone()
    };

    let (title, body) = match (notice.kind, notice.collection, language, seen_before) {
        (ReminderKind::ActivityInvite, _, Language::En, _) => (
            format!("You're invited: {item}"),
            format!("Open {trip_name} to join, or to say you can't."),
        ),
        (ReminderKind::ActivityInvite, _, Language::Fr, _) => (
            format!("Invitation : {item}"),
            format!("Ouvrez {trip_name} pour participer, ou pour dire non."),
        ),
        (ReminderKind::TripChange, Some(collection), language, changed) => (
            change_title(collection, language, changed, &item),
            match (language, changed) {
                (Language::En, false) => format!("Open {trip_name} to see it."),
                (Language::En, true) => format!("Open {trip_name} to see what changed."),
                (Language::Fr, false) => format!("Ouvrez {trip_name} pour le voir."),
                (Language::Fr, true) => {
                    format!("Ouvrez {trip_name} pour voir ce qui a changé.")
                }
            },
        ),
        (_, _, Language::En, false) => (
            format!("New in the accounts: {item}"),
            format!("A line you're on was added to {trip_name}."),
        ),
        (_, _, Language::En, true) => (
            format!("Changed in the accounts: {item}"),
            format!("A line you're on in {trip_name} was changed."),
        ),
        (_, _, Language::Fr, false) => (
            format!("Nouveau dans les comptes : {item}"),
            format!("Une ligne qui vous concerne a été ajoutée à {trip_name}."),
        ),
        (_, _, Language::Fr, true) => (
            format!("Modifié dans les comptes : {item}"),
            format!("Une ligne qui vous concerne dans {trip_name} a été modifiée."),
        ),
    };

    DueReminder {
        kind: notice.kind,
        subject: notice.subject.clone(),
        title,
        body,
        // Opens the trip itself, where an invitation is asked about.
        url: format!("t/{trip_id}"),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use yrs::{MapPrelim, WriteTxn};

    const TRIP: &str = "0b9e8c1a-3f2d-4c5b-9a8e-7d6c5b4a3f2e";

    fn arr(values: &[&str]) -> Any {
        Any::Array(
            values
                .iter()
                .map(|value| Any::String((*value).into()))
                .collect::<Vec<_>>()
                .into(),
        )
    }

    fn share(person: &str, value: f64) -> Any {
        let mut map = HashMap::new();
        map.insert("personId".to_owned(), Any::String(person.into()));
        map.insert("value".to_owned(), Any::Number(value));
        Any::Map(Arc::new(map))
    }

    fn doc_with(root: &str, id: &str, fields: Vec<(&str, Any)>) -> Doc {
        let doc = Doc::new();
        {
            let mut txn = doc.transact_mut();
            let map = txn.get_or_insert_map(root);
            let prelim: MapPrelim = fields
                .into_iter()
                .map(|(key, value)| (key.to_owned(), yrs::In::Any(value)))
                .collect();
            map.insert(&mut txn, id, prelim);
        }
        doc
    }

    fn request(kind: ReminderKind, subject: &str) -> NotifyRequest {
        NotifyRequest {
            trip_id: TRIP.to_owned(),
            kind,
            subject_id: subject.to_owned(),
            collection: None,
        }
    }

    fn change(collection: Collection, subject: &str) -> NotifyRequest {
        NotifyRequest {
            collection: Some(collection),
            ..request(ReminderKind::TripChange, subject)
        }
    }

    fn line(updated_by: Option<&str>, amount: f64) -> Doc {
        let mut fields = vec![
            ("kind", Any::String("expense".into())),
            ("title", Any::String("Courses".into())),
            ("date", Any::String("2026-12-20".into())),
            ("amount", Any::Number(amount)),
            ("payerId", Any::String("alice".into())),
            ("splitMode", Any::String("equal".into())),
            (
                "splits",
                Any::Array(
                    vec![share("alice", 1.0), share("bob", 1.0), share("carol", 1.0)].into(),
                ),
            ),
        ];
        if let Some(author) = updated_by {
            fields.push(("updatedBy", Any::String(author.into())));
        }
        doc_with(EXPENSES_ROOT, "line-1", fields)
    }

    #[test]
    fn reads_a_request_and_refuses_what_is_not_one() {
        let ok =
            format!(r#"{{"trip_id":"{TRIP}","kind":"money_line","subject_id":"abc_DEF-123"}}"#);
        assert_eq!(
            parse_request(ok.as_bytes()).unwrap(),
            request(ReminderKind::MoneyLine, "abc_DEF-123")
        );

        for body in [
            r#"{"trip_id":"not-a-uuid","kind":"money_line","subject_id":"a"}"#.to_owned(),
            format!(r#"{{"trip_id":"{TRIP}","kind":"pickup","subject_id":"a"}}"#),
            format!(r#"{{"trip_id":"{TRIP}","kind":"money_line","subject_id":"a&select=*"}}"#),
            format!(r#"{{"trip_id":"{TRIP}","kind":"money_line","subject_id":""}}"#),
            "not json".to_owned(),
        ] {
            assert!(parse_request(body.as_bytes()).is_err(), "accepted {body}");
        }
        assert!(parse_request(&vec![b' '; MAX_BODY_BYTES + 1]).is_err());
    }

    #[test]
    fn tells_the_invited_guests_but_not_the_one_who_asked_nor_those_already_in() {
        let doc = doc_with(
            ACTIVITIES_ROOT,
            "act-1",
            vec![
                ("title", Any::String("Exposition".into())),
                ("participantIds", arr(&["carol"])),
                ("invitedIds", arr(&["bob", "carol", "alice", "dan"])),
                ("invitedBy", Any::String("alice".into())),
            ],
        );

        let notice = notice_for(&doc, &request(ReminderKind::ActivityInvite, "act-1")).unwrap();

        assert_eq!(
            notice.recipients,
            ["bob", "dan"].into_iter().map(str::to_owned).collect()
        );
        assert_eq!(notice.subject, "act-1");
        assert_eq!(notice.item_title, "Exposition");
    }

    #[test]
    fn tells_everybody_on_a_line_but_its_author() {
        let notice = notice_for(
            &line(Some("alice"), 84.2),
            &request(ReminderKind::MoneyLine, "line-1"),
        )
        .unwrap();

        assert_eq!(
            notice.recipients,
            ["bob", "carol"].into_iter().map(str::to_owned).collect()
        );
        assert!(is_version_of(&notice.subject, &notice));
        assert!(notice.subject.starts_with("line-1:"));
        assert_eq!(notice.subject.len(), "line-1:".len() + 16);
    }

    #[test]
    fn gives_each_version_of_a_line_its_own_subject_and_the_same_line_the_same() {
        let request = request(ReminderKind::MoneyLine, "line-1");
        let first = notice_for(&line(Some("alice"), 84.2), &request)
            .unwrap()
            .subject;
        let again = notice_for(&line(Some("bob"), 84.2), &request)
            .unwrap()
            .subject;
        let changed = notice_for(&line(Some("alice"), 90.0), &request)
            .unwrap()
            .subject;

        // Saved again by somebody else, unchanged: the same version.
        assert_eq!(first, again);
        assert_ne!(first, changed);
    }

    #[test]
    fn tells_nobody_about_what_the_document_does_not_hold_or_only_the_author_is_on() {
        assert_eq!(
            notice_for(&Doc::new(), &request(ReminderKind::MoneyLine, "line-1")),
            None
        );
        assert!(!holds_subject(
            &Doc::new(),
            &request(ReminderKind::MoneyLine, "line-1")
        ));
        assert!(holds_subject(
            &line(None, 1.0),
            &request(ReminderKind::MoneyLine, "line-1")
        ));

        let lonely = doc_with(
            ACTIVITIES_ROOT,
            "act-1",
            vec![
                ("invitedIds", arr(&["alice"])),
                ("invitedBy", Any::String("alice".into())),
            ],
        );
        assert_eq!(
            notice_for(&lonely, &request(ReminderKind::ActivityInvite, "act-1")),
            None
        );
    }

    #[test]
    fn writes_the_words_in_each_language_and_opens_the_trip() {
        let notice = notice_for(
            &line(Some("alice"), 84.2),
            &request(ReminderKind::MoneyLine, "line-1"),
        )
        .unwrap();

        let added = render(&notice, TRIP, "Noël", Language::Fr, false);
        assert_eq!(added.title, "Nouveau dans les comptes : Courses");
        assert_eq!(added.url, format!("t/{TRIP}"));
        let changed = render(&notice, TRIP, "Noël", Language::En, true);
        assert_eq!(changed.title, "Changed in the accounts: Courses");
        assert!(changed.body.contains("Noël"));
    }

    #[test]
    fn never_writes_a_guest_name() {
        let doc = doc_with(
            ACTIVITIES_ROOT,
            "act-1",
            vec![
                ("title", Any::String("Plage".into())),
                ("invitedIds", arr(&["bob"])),
                ("invitedBy", Any::String("alice".into())),
            ],
        );
        let notice = notice_for(&doc, &request(ReminderKind::ActivityInvite, "act-1")).unwrap();
        for language in [Language::En, Language::Fr] {
            let reminder = render(&notice, TRIP, "Trip", language, false);
            for name in ["alice", "bob"] {
                assert!(!reminder.title.contains(name) && !reminder.body.contains(name));
            }
        }
    }

    #[test]
    fn lets_only_the_listed_origins_call() {
        let allowed = vec![
            "https://app.kikouchou.app".to_owned(),
            "capacitor://localhost".to_owned(),
        ];
        assert_eq!(
            allowed_origin(Some("capacitor://localhost"), &allowed),
            Some("capacitor://localhost")
        );
        assert_eq!(allowed_origin(Some("https://evil.example"), &allowed), None);
        assert_eq!(
            allowed_origin(Some("https://app.kikouchou.app.evil.example"), &allowed),
            None
        );
        assert_eq!(allowed_origin(None, &allowed), None);
    }

    #[test]
    fn cuts_a_long_title() {
        let long = "x".repeat(100);
        assert_eq!(short_title(Some(&long)).chars().count(), MAX_TITLE_CHARS);
        assert!(short_title(Some(&long)).ends_with('…'));
    }

    #[test]
    fn tells_a_line_version_from_another_line() {
        let notice = notice_for(
            &line(Some("alice"), 84.2),
            &request(ReminderKind::MoneyLine, "line-1"),
        )
        .unwrap();
        assert!(is_version_of("line-1:0123456789abcdef", &notice));
        assert!(!is_version_of("line-10:0123456789abcdef", &notice));
        assert!(!is_version_of("line-1", &notice));
    }

    #[test]
    fn reads_a_trip_change_only_with_a_collection_that_names_guests() {
        let ok = format!(
            r#"{{"trip_id":"{TRIP}","kind":"trip_change","subject_id":"ride-1","collection":"rides"}}"#
        );
        assert_eq!(
            parse_request(ok.as_bytes()).unwrap(),
            change(Collection::Rides, "ride-1")
        );
        for body in [
            format!(r#"{{"trip_id":"{TRIP}","kind":"trip_change","subject_id":"x"}}"#),
            format!(
                r#"{{"trip_id":"{TRIP}","kind":"trip_change","subject_id":"x","collection":"rooms"}}"#
            ),
            format!(
                r#"{{"trip_id":"{TRIP}","kind":"trip_change","subject_id":"x","collection":"expenses"}}"#
            ),
        ] {
            assert!(parse_request(body.as_bytes()).is_err(), "accepted {body}");
        }
        // A collection on another kind is ignored, not trusted.
        let money = format!(
            r#"{{"trip_id":"{TRIP}","kind":"money_line","subject_id":"x","collection":"rides"}}"#
        );
        assert_eq!(parse_request(money.as_bytes()).unwrap().collection, None);
    }

    #[test]
    fn tells_the_guest_a_row_names_but_not_the_one_who_saved_it() {
        let cases = [
            (
                Collection::Guests,
                "bob",
                vec![("name", Any::String("Bob".into()))],
                "bob",
            ),
            (
                Collection::RoomAssignments,
                "as-1",
                vec![("personId", Any::String("bob".into()))],
                "bob",
            ),
            (
                Collection::Vehicles,
                "car-1",
                vec![("ownerId", Any::String("bob".into()))],
                "bob",
            ),
            (
                Collection::Meals,
                "meal-1",
                vec![("organizerIds", arr(&["bob", "alice"]))],
                "bob",
            ),
            (
                Collection::ShoppingItems,
                "item-1",
                vec![
                    ("name", Any::String("Pain".into())),
                    ("buyerId", Any::String("bob".into())),
                ],
                "bob",
            ),
            (
                Collection::Activities,
                "act-1",
                vec![
                    ("title", Any::String("Ski".into())),
                    ("participantIds", arr(&["alice"])),
                    ("organizerId", Any::String("bob".into())),
                ],
                "bob",
            ),
        ];
        for (collection, id, mut fields, guest) in cases {
            fields.push(("updatedBy", Any::String("alice".into())));
            let doc = doc_with(collection.root(), id, fields);
            let notice = notice_for(&doc, &change(collection, id)).unwrap();
            assert_eq!(
                notice.recipients,
                [guest.to_owned()].into_iter().collect(),
                "{collection:?}"
            );
            assert!(notice.subject.len() <= 64);
            assert!(is_version_of(&notice.subject, &notice));
            assert!(holds_subject(&doc, &change(collection, id)));
        }
    }

    #[test]
    fn tells_a_ride_s_driver_and_passengers_and_a_passenger_s_driver() {
        let doc = Doc::new();
        {
            let mut txn = doc.transact_mut();
            let rides = txn.get_or_insert_map(RIDES_ROOT);
            let ride: MapPrelim = [
                (
                    "driverId".to_owned(),
                    yrs::In::Any(Any::String("dan".into())),
                ),
                (
                    "updatedBy".to_owned(),
                    yrs::In::Any(Any::String("dan".into())),
                ),
            ]
            .into_iter()
            .collect();
            rides.insert(&mut txn, "ride-1", ride);
            let legs = txn.get_or_insert_map(TRANSPORT_ROOT);
            for (id, person) in [("leg-1", "bob"), ("leg-2", "carol")] {
                let leg: MapPrelim = [
                    (
                        "personId".to_owned(),
                        yrs::In::Any(Any::String(person.into())),
                    ),
                    (
                        "rideId".to_owned(),
                        yrs::In::Any(Any::String("ride-1".into())),
                    ),
                ]
                .into_iter()
                .collect();
                legs.insert(&mut txn, id, leg);
            }
        }

        let ride = notice_for(&doc, &change(Collection::Rides, "ride-1")).unwrap();
        assert_eq!(
            ride.recipients,
            ["bob", "carol"].into_iter().map(str::to_owned).collect()
        );
        let leg = notice_for(&doc, &change(Collection::Transport, "leg-1")).unwrap();
        assert_eq!(
            leg.recipients,
            ["bob", "dan"].into_iter().map(str::to_owned).collect()
        );
    }

    #[test]
    fn gives_each_version_of_a_row_its_own_subject() {
        let room = |night: &str, author: &str| {
            doc_with(
                "roomAssignmentsById",
                "as-1",
                vec![
                    ("personId", Any::String("bob".into())),
                    ("startDate", Any::String(night.into())),
                    ("updatedBy", Any::String(author.into())),
                    ("updatedAt", Any::String(author.into())),
                ],
            )
        };
        let ask = change(Collection::RoomAssignments, "as-1");
        let first = notice_for(&room("2026-12-20", "alice"), &ask).unwrap();
        let again = notice_for(&room("2026-12-20", "carol"), &ask).unwrap();
        let moved = notice_for(&room("2026-12-21", "alice"), &ask).unwrap();
        assert_eq!(first.subject, again.subject);
        assert_ne!(first.subject, moved.subject);
        assert!(is_version_of(&first.subject, &moved));
    }

    #[test]
    fn writes_a_change_without_a_guest_name_in_each_language() {
        let doc = doc_with(
            "vehiclesById",
            "car-1",
            vec![
                ("name", Any::String("bob's car".into())),
                ("ownerId", Any::String("bob".into())),
                ("updatedBy", Any::String("alice".into())),
            ],
        );
        let notice = notice_for(&doc, &change(Collection::Vehicles, "car-1")).unwrap();
        for language in [Language::En, Language::Fr] {
            for seen in [false, true] {
                let reminder = render(&notice, TRIP, "Trip", language, seen);
                assert!(!reminder.title.contains("bob") && !reminder.body.contains("bob"));
                assert!(reminder.body.contains("Trip"));
            }
        }
        for collection in Collection::ALL {
            for language in [Language::En, Language::Fr] {
                assert!(!change_title(collection, language, true, "x").is_empty());
            }
        }
        assert_eq!(
            render(&notice, TRIP, "Trip", Language::En, true).title,
            "Your car's details changed"
        );
    }
}
