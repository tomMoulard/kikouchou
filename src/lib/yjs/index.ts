/**
 * @fileoverview Public API for the Yjs P2P sync module.
 * @module lib/yjs
 */

export { useYjsSync, type YjsSyncState } from './useYjsSync';
export {
  YjsProvider,
  useYjsContext,
  useRequiredYjsContext,
  type OnlineUser,
  type YjsContextValue,
} from './YjsProvider';
export { P2PSyncPresence } from './P2PSyncPresence';
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
export {
  getPresenceProfile,
  resolveTripPresenceProfile,
  type PresenceProfile,
} from './presence';
export { TripYjsSyncBinding, YjsTripSync } from './YjsTripSync';
export {
  ensureTripP2pCredentials,
  type TripP2pCredentials,
} from './ensure-trip-p2p-credentials';
