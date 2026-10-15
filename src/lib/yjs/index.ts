/**
 * @fileoverview Public API for the Yjs P2P sync module.
 * @module lib/yjs
 */

export { useTripDoc, type TripDocState } from './useTripDoc';
export {
  YjsProvider,
  useYjsContext,
  useRequiredYjsContext,
  type YjsContextValue,
} from './YjsProvider';
export {
  DOC_COLLECTION_NAMES,
  DOC_SCHEMA_VERSION,
  type DocCollectionName,
  type DocRecord,
  type IdentifiedDocRecord,
  deleteDocEntity,
  isDeepEqual,
  migrateLegacyArrayCollections,
  readDocCollection,
  readDocSchemaVersion,
  replaceDocCollection,
  stampDocSchemaVersion,
  upsertDocEntity,
} from './doc-model';
export {
  applyDocToDexie,
  ORIGIN_DEXIE_SYNC,
  compactUpdates,
  loadPersistedUpdates,
  populateDocFromDexie,
  subscribeToUpdates,
  syncDocToDexie,
  syncDexieToDoc,
  syncTripMetaToDoc,
} from './dexie-bridge';
export { TripYjsSyncBinding, YjsTripSync } from './YjsTripSync';
