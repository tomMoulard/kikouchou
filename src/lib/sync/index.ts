/**
 * @fileoverview Public API for the server-backed sync layer.
 * @module lib/sync
 */

export {
  areStateVectorsEqual,
  decodeUpdate,
  encodeUpdate,
} from './codec';
export {
  advanceCursor,
  readCursor,
  recordServerState,
  resetCursor,
  type SyncCursor,
} from './cursors';
export {
  ORIGIN_REMOTE,
  SupabaseYjsProvider,
  type SupabaseYjsProviderOptions,
  type SyncState,
  type SyncStatus,
} from './SupabaseYjsProvider';
