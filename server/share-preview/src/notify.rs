//! `POST /push/notify`: tell the people a change is about, now.
//!
//! The reminders are swept for once an interval. Two things cannot wait for
//! the sweep, and are asked for by the device that made the change, the moment
//! the change has reached the server:
//!
//! - `activity_invite`: guests were invited to an activity. Every device
//!   subscribed as an invited guest is told, once per activity.
//! - `money_line`: a money line was added or changed. Every device subscribed
//!   as a guest on it (the payer, or one of its shares) is told, once per
//!   version of the line: the subject carries a digest of what the line says,
//!   so a save that changed nothing is not told again.
//!
//! The guest who made the change is never told. The document says who did:
//! `invitedBy` on the activity, `updatedBy` on the line.
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
    /// `ActivityInvite` or `MoneyLine`.
    pub kind: ReminderKind,
    /// The activity's or the line's id in the document.
    pub subject_id: String,
}

/// Who to tell about one change, and the words to tell them with.
#[derive(Debug, Clone, PartialEq)]
pub struct Notice {
    pub kind: ReminderKind,
    /// The `reminder_log` subject: the activity id, or the line id and digest.
    pub subject: String,
    /// The guests to tell, the author already taken out.
    pub recipients: BTreeSet<String>,
    /// The activity's or the line's title, as the document has it.
    pub item_title: String,
}

#[derive(Deserialize)]
struct RawRequest {
    trip_id: String,
    kind: String,
    subject_id: String,
}

// ============================================================================
// Constants
// ============================================================================

/// The most a body may be. A request is under 200 bytes.
pub const MAX_BODY_BYTES: usize = 1024;

/// Root map keys, mirroring `COLLECTION_ROOT` in `src/lib/yjs/doc-model.ts`.
const ACTIVITIES_ROOT: &str = "activitiesById";
const EXPENSES_ROOT: &str = "expensesById";

/// The longest document id taken: the app's ids are 21 characters, and the
/// subject (id, a colon, a 16-digit digest) has to fit `reminder_log`'s 64.
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
        Some(kind @ (ReminderKind::ActivityInvite | ReminderKind::MoneyLine)) => kind,
        _ => return Err("kind is not one a device can ask for"),
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

/// Who to tell about a change, read from the live document.
///
/// `None` when the document does not hold the activity or the line (yet: the
/// device asks once its change reached the server, but a peer may have deleted
/// it since), or when nobody but the author is concerned.
pub fn notice_for(doc: &Doc, request: &NotifyRequest) -> Option<Notice> {
    let (fields, mut recipients, author, subject) = match request.kind {
        ReminderKind::ActivityInvite => {
            let fields = row_of(doc, ACTIVITIES_ROOT, &request.subject_id)?;
            let joined: BTreeSet<String> = strings(&fields, "participantIds").into_iter().collect();
            let recipients: BTreeSet<String> = strings(&fields, "invitedIds")
                .into_iter()
                .filter(|id| !joined.contains(id))
                .collect();
            let author = text(&fields, "invitedBy").map(str::to_owned);
            (fields, recipients, author, request.subject_id.clone())
        }
        ReminderKind::MoneyLine => {
            let fields = row_of(doc, EXPENSES_ROOT, &request.subject_id)?;
            let mut recipients: BTreeSet<String> = split_person_ids(&fields).into_iter().collect();
            if let Some(payer) = text(&fields, "payerId") {
                recipients.insert(payer.to_owned());
            }
            let author = text(&fields, "updatedBy").map(str::to_owned);
            let digest = fnv1a(line_fingerprint(&fields).as_bytes());
            let subject = format!("{}:{digest:016x}", request.subject_id);
            (fields, recipients, author, subject)
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
        recipients,
        item_title: short_title(text(&fields, "title")),
    })
}

/// Whether the document holds the activity or the line a request names.
pub fn holds_subject(doc: &Doc, request: &NotifyRequest) -> bool {
    let root = match request.kind {
        ReminderKind::ActivityInvite => ACTIVITIES_ROOT,
        ReminderKind::MoneyLine => EXPENSES_ROOT,
        _ => return false,
    };
    row_of(doc, root, &request.subject_id).is_some()
}

/// Whether a `money_line` subject is a version of this line: its id, a colon.
pub fn is_version_of_line(subject: &str, line_id: &str) -> bool {
    subject
        .strip_prefix(line_id)
        .is_some_and(|rest| rest.starts_with(':'))
}

// ============================================================================
// Words
// ============================================================================

/// The notification for one device.
///
/// `seen_before` is for a money line: whether this device was already told
/// about an earlier version of it, which makes this one a change rather than a
/// new line.
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

    let (title, body) = match (notice.kind, language, seen_before) {
        (ReminderKind::ActivityInvite, Language::En, _) => (
            format!("You're invited: {item}"),
            format!("Open {trip_name} to join, or to say you can't."),
        ),
        (ReminderKind::ActivityInvite, Language::Fr, _) => (
            format!("Invitation : {item}"),
            format!("Ouvrez {trip_name} pour participer, ou pour dire non."),
        ),
        (_, Language::En, false) => (
            format!("New in the accounts: {item}"),
            format!("A line you're on was added to {trip_name}."),
        ),
        (_, Language::En, true) => (
            format!("Changed in the accounts: {item}"),
            format!("A line you're on in {trip_name} was changed."),
        ),
        (_, Language::Fr, false) => (
            format!("Nouveau dans les comptes : {item}"),
            format!("Une ligne qui vous concerne a été ajoutée à {trip_name}."),
        ),
        (_, Language::Fr, true) => (
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
        assert!(is_version_of_line(&notice.subject, "line-1"));
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
        assert!(is_version_of_line("line-1:0123456789abcdef", "line-1"));
        assert!(!is_version_of_line("line-10:0123456789abcdef", "line-1"));
        assert!(!is_version_of_line("line-1", "line-1"));
    }
}
