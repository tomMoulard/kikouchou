/**
 * @fileoverview Shape of the shared trip document.
 *
 * Each collection is a **root** `Y.Map` keyed by entity id, whose values are
 * `Y.Map`s of field → value. Two peers editing different fields of one guest
 * therefore both win, and two peers editing different guests never interact at
 * all. The previous model stored a `Y.Array` of whole records and replaced it
 * wholesale on every change, which merged into every peer's copy of every row —
 * silently losing concurrent edits and undoing deletions once `bulkPut`
 * collapsed the duplicates by id.
 *
 * Three constraints are load-bearing here, all three verified against `yjs`
 * rather than assumed:
 *
 * 1. **The collection roots are new keys.** A root key that already holds a
 *    `Y.Array` cannot be re-read as a `Y.Map` — Yjs throws *"Type with the name
 *    guests has already been defined with a different constructor"*. The v1
 *    array keys (`guests`, `rooms`, …) are left untouched and these use
 *    `…ById` names, so a document written by either model stays readable.
 *
 * 2. **The roots are flat, never nested.** A nested intermediate map is created
 *    concurrently by both peers (`entities.set('guests', new Y.Map())`), and one
 *    creation replaces the other, taking its children with it — a measured
 *    silent row loss. Root types are implicit and deterministic, so they have no
 *    such race.
 *
 * 3. **Field values that are objects or arrays merge atomically**, not
 *    per-element: `coordinates` and `participantIds` are replaced whole by the
 *    last writer. That is right for a coordinate pair and a known limitation for
 *    activity participants — two guests joining the same activity while both
 *    offline will keep only one of the two joins. Fixing that needs a `Y.Array`
 *    per activity and is deliberately out of scope here.
 *
 * @module lib/yjs/doc-model
 */

import * as Y from 'yjs';

// ============================================================================
// Type Definitions
// ============================================================================

/** Collections mirrored between Dexie and the shared document. */
export type DocCollectionName =
  | 'guests'
  | 'rooms'
  | 'roomAssignments'
  | 'transport'
  | 'activities';

/** A trip entity as it travels through the document: plain fields, no `tripId`. */
export type DocRecord = Record<string, unknown>;

/** A record read back out of the document, with its id taken from the map key. */
export type IdentifiedDocRecord = DocRecord & { readonly id: string };

// ============================================================================
// Constants
// ============================================================================

/**
 * Version of the document shape. Bumped from 1 (arrays of whole records) to 2
 * (maps of per-field maps).
 *
 * `syncDocToDexie` refuses to project a document that does not declare 2, so a
 * peer still running v1 cannot empty a v2 client's tables by handing it a
 * document whose `…ById` roots are legitimately empty.
 */
export const DOC_SCHEMA_VERSION = 2;

/** Root key holding the schema version and trip metadata. */
export const META_KEY = 'meta';

/**
 * Root map key per collection. Deliberately distinct from the v1 array keys:
 * reusing one throws (see constraint 1 above).
 */
const COLLECTION_ROOT: Readonly<Record<DocCollectionName, string>> = {
  guests: 'guestsById',
  rooms: 'roomsById',
  roomAssignments: 'roomAssignmentsById',
  transport: 'transportById',
  activities: 'activitiesById',
};

/** v1 root keys, read only by {@link migrateLegacyArrayCollections}. */
const LEGACY_ARRAY_KEY: Readonly<Record<DocCollectionName, string>> = {
  guests: 'guests',
  rooms: 'rooms',
  roomAssignments: 'roomAssignments',
  transport: 'transport',
  activities: 'activities',
};

export const DOC_COLLECTION_NAMES = Object.keys(
  COLLECTION_ROOT,
) as readonly DocCollectionName[];

// ============================================================================
// Internal Helpers
// ============================================================================

/** Key-order-insensitive deep compare, so a re-serialised object is not a change. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  }
  return value;
}

/** Exported so the bridge's `meta` diffing uses the same comparison. */
export function isDeepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function collectionRoot(doc: Y.Doc, name: DocCollectionName): Y.Map<unknown> {
  return doc.getMap(COLLECTION_ROOT[name]);
}

/**
 * Deterministic order for a collection, so every device renders the same list
 * and a tie never depends on insertion order. Ties break on `id` because two
 * peers can legitimately assign the same `order` or the same datetime.
 */
function compareRecords(
  name: DocCollectionName,
  left: IdentifiedDocRecord,
  right: IdentifiedDocRecord,
): number {
  const byId = left.id.localeCompare(right.id);

  switch (name) {
    case 'guests':
      return byId;
    case 'rooms': {
      const leftOrder = Number(left.order ?? 0);
      const rightOrder = Number(right.order ?? 0);
      return leftOrder === rightOrder ? byId : leftOrder - rightOrder;
    }
    case 'roomAssignments': {
      const byDate = String(left.startDate ?? '').localeCompare(
        String(right.startDate ?? ''),
      );
      return byDate === 0 ? byId : byDate;
    }
    case 'transport': {
      const byDatetime = String(left.datetime ?? '').localeCompare(
        String(right.datetime ?? ''),
      );
      return byDatetime === 0 ? byId : byDatetime;
    }
    case 'activities': {
      const byStart = String(left.startDatetime ?? '').localeCompare(
        String(right.startDatetime ?? ''),
      );
      return byStart === 0 ? byId : byStart;
    }
  }
}

// ============================================================================
// Reads
// ============================================================================

/**
 * Reads one collection out of the document, in deterministic order.
 *
 * The id always comes from the map key, never from a stored `id` field: the key
 * is what addressing and deletion use, so a peer must not be able to make a row
 * claim an id it is not filed under.
 *
 * A value that is not a `Y.Map` is skipped rather than throwing — a v1 peer, or
 * a hostile one, can put anything here, and one bad row must not take the whole
 * read down with it.
 */
export function readDocCollection(
  doc: Y.Doc,
  name: DocCollectionName,
): IdentifiedDocRecord[] {
  const records: IdentifiedDocRecord[] = [];

  for (const [id, row] of collectionRoot(doc, name).entries()) {
    if (!(row instanceof Y.Map)) {
      continue;
    }

    const record: DocRecord = {};
    for (const [field, value] of (row as Y.Map<unknown>).entries()) {
      if (field !== 'id' && value !== undefined) {
        record[field] = value;
      }
    }
    records.push({ ...record, id });
  }

  return records.sort((left, right) => compareRecords(name, left, right));
}

/** Whether the document declares a shape this build knows how to project. */
export function readDocSchemaVersion(doc: Y.Doc): number {
  const version = doc.getMap(META_KEY).get('schema');
  // v1 documents predate the field entirely.
  return typeof version === 'number' ? version : 1;
}

export function stampDocSchemaVersion(doc: Y.Doc): void {
  const meta = doc.getMap(META_KEY);
  if (meta.get('schema') !== DOC_SCHEMA_VERSION) {
    meta.set('schema', DOC_SCHEMA_VERSION);
  }
}

// ============================================================================
// Writes
// ============================================================================

/**
 * Creates or updates one entity, touching only the fields that actually differ.
 *
 * `id` is taken from `entity.id` and used as the map key; it is not stored as a
 * field. Fields absent from `entity` — or explicitly `undefined` — are removed,
 * so clearing an optional note propagates instead of lingering.
 */
export function upsertDocEntity(
  doc: Y.Doc,
  name: DocCollectionName,
  entity: DocRecord & { id: string },
): void {
  const collection = collectionRoot(doc, name);
  const { id } = entity;

  Y.transact(doc, () => {
    let row = collection.get(id);
    if (!(row instanceof Y.Map)) {
      row = new Y.Map();
      collection.set(id, row);
    }
    const target = row as Y.Map<unknown>;

    for (const [field, value] of Object.entries(entity)) {
      if (field === 'id') {
        continue;
      }
      if (value === undefined) {
        if (target.has(field)) {
          target.delete(field);
        }
        continue;
      }
      if (!isDeepEqual(target.get(field), value)) {
        target.set(field, value);
      }
    }

    for (const field of [...target.keys()]) {
      if (field !== 'id' && !(field in entity)) {
        target.delete(field);
      }
    }
  });
}

/** Removes one entity. A missing id is not an error — deletion is idempotent. */
export function deleteDocEntity(
  doc: Y.Doc,
  name: DocCollectionName,
  id: string,
): void {
  const collection = collectionRoot(doc, name);
  if (collection.has(id)) {
    collection.delete(id);
  }
}

/**
 * Brings a collection in line with `entities`: upserts each one and removes the
 * ids that are no longer present.
 *
 * This is the whole-collection entry point `YjsTripSync` calls when Dexie
 * changes, and it is the one that used to clear and rebuild a `Y.Array`. It now
 * touches only what differs, so an unrelated concurrent edit is never in the
 * blast radius and a one-field change costs a one-field update on the wire.
 */
export interface ReplaceDocCollectionOptions {
  /**
   * Whether `entities` may be treated as the complete set.
   *
   * Required, with no default, because getting it wrong destroys other people's
   * data and the safe answer is not obvious from the call site. `true` deletes
   * every entry not in `entities`; `false` upserts and removes nothing.
   *
   * Only pass `true` when the caller can assert that `entities` is a complete
   * mirror of this collection. A deletion here is a CRDT tombstone: it pushes to
   * the log, every other member applies it, and nothing brings the entry back.
   *
   * The failure it guards is not hypothetical. An invitee's document receives the
   * owner's rooms and guests from the log while their Dexie stays empty — the
   * projection refused, or has not run yet, or the local data was cleared. Their
   * empty mirror then pruned the document to match, and the owner lost the trip's
   * contents for everybody.
   *
   * Note that the CRDT layer itself is not the hazard: Yjs updates are additive,
   * so a document that merely *lacks* an entry deletes nothing when it merges.
   * Only an inferred deletion does damage.
   */
  readonly allowDeletions: boolean;
}

export function replaceDocCollection(
  doc: Y.Doc,
  name: DocCollectionName,
  entities: readonly (DocRecord & { id: string })[],
  { allowDeletions }: ReplaceDocCollectionOptions,
): void {
  const collection = collectionRoot(doc, name);
  const nextIds = new Set(entities.map((entity) => entity.id));

  Y.transact(doc, () => {
    for (const entity of entities) {
      upsertDocEntity(doc, name, entity);
    }

    if (!allowDeletions) {
      return;
    }

    for (const id of [...collection.keys()]) {
      if (!nextIds.has(id)) {
        collection.delete(id);
      }
    }
  });
}

// ============================================================================
// Migration
// ============================================================================

/**
 * Copies a v1 document's array collections into the v2 maps, once.
 *
 * Safe to run on every device that opens the trip: the conversion is keyed on
 * each record's own `id`, so two peers migrating concurrently write identical
 * keys and identical values and converge. Rows already present in the map are
 * left alone, so this never undoes an edit made after the migration.
 *
 * The v1 arrays are left in place. They are the only copy an un-upgraded peer
 * can read, and dropping them buys nothing — Phase 8 removes them with the rest
 * of the WebRTC path.
 *
 * @returns Whether anything was carried across.
 */
export function migrateLegacyArrayCollections(doc: Y.Doc): boolean {
  let migrated = false;

  Y.transact(doc, () => {
    for (const name of DOC_COLLECTION_NAMES) {
      const legacy = doc.getArray(LEGACY_ARRAY_KEY[name]);
      if (legacy.length === 0) {
        continue;
      }

      const collection = collectionRoot(doc, name);
      for (const raw of legacy.toArray()) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          continue;
        }
        const record = raw as DocRecord;
        const id = record.id;
        if (typeof id !== 'string' || id.length === 0) {
          continue;
        }
        // A later edit already produced this row; do not walk it back.
        if (collection.has(id)) {
          continue;
        }
        upsertDocEntity(doc, name, { ...record, id });
        migrated = true;
      }
    }

    // Only claim v2 once there is v2 content to back the claim. Stamping
    // unconditionally would make a *fresh, empty* document self-certify, and the
    // version guard in `syncDocToDexie` would then wave through a v1 peer whose
    // `…ById` maps are empty — projecting that empties the local tables. An
    // un-migrated document stays v1 until either this device populates it from
    // Dexie or a genuine v2 peer's stamp arrives.
    if (migrated) {
      stampDocSchemaVersion(doc);
    }
  });

  return migrated;
}
