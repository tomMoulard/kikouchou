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
  type SyncCursor,
} from './cursors';
export { AccountTripSync } from './AccountTripSync';
export { syncAccountTrips, type AccountSyncResult } from './account-sync';
export {
  ensureRemoteTrip,
  listRemoteTripsMissingLocally,
  syncRemoteTripMetadata,
  type EnsureRemoteTripResult,
} from './remote-trip';
export {
  buildInviteUrl,
  createInvite,
  extractInviteToken,
  isInviteUsable,
  listInvites,
  redeemInvite,
  revokeInvite,
  type CreateInviteResult,
  type RedeemInviteResult,
  type TripInvite,
} from './invites';
export { syncGuestGroups, type GuestGroupSyncResult } from './guest-groups';
export {
  GuestGroupSync,
  useGuestGroupSync,
  type GuestGroupSyncContextValue,
} from './GuestGroupSync';
export {
  claimParticipant,
  fetchClaimedParticipants,
  materialiseJoinedTrip,
  type JoinTripResult,
} from './join-trip';
export { useTripSync, type UseTripSyncOptions } from './useTripSync';
export {
  SupabaseTripSync,
  useSyncStatus,
  type SyncStatusContextValue,
} from './SupabaseTripSync';
export {
  ORIGIN_REMOTE,
  SupabaseYjsProvider,
  type SupabaseYjsProviderOptions,
  type SyncState,
  type SyncStatus,
} from './SupabaseYjsProvider';
