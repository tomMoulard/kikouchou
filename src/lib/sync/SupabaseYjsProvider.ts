/**
 * @fileoverview Syncs a Y.Doc against the server log.
 *
 * Replaces `y-webrtc`. The server is not a signalling hop but an always-online
 * peer that persists the log, which is what removes all three limits of the
 * WebRTC path at once: peers need not be online together, there is no NAT to
 * traverse, and nobody has to take turns.
 *
 * ## How it stays correct
 *
 * The load-bearing idea is that **the cursor tracks reads and the state vector
 * tracks writes**, and neither is trusted to imply the other.
 *
 * - `start()` pulls the snapshot plus every row after the cursor, applies them,
 *   then computes `Y.encodeStateAsUpdate(doc, serverStateVector)` — precisely
 *   what the server lacks — and pushes it. With no stored vector that call
 *   returns the whole document, so a trip's **first upload** and a device
 *   **catching up after a crash** are the same code path. This is why the outbox
 *   can be a latency optimisation rather than the correctness mechanism: a lost
 *   queue row costs a delay, not data.
 *
 * - A Realtime row is applied immediately for latency, but never advances the
 *   cursor. Realtime can deliver out of order, and a cursor jumped forward on
 *   row 5 would skip row 4 forever. Instead each notification schedules a
 *   debounced pull, and the pull is what advances the cursor. Re-applying rows
 *   already seen is free: Yjs treats a redelivered update as a no-op and emits
 *   no event, verified rather than assumed.
 *
 * - Local edits are recognised by transaction origin. An update tagged
 *   {@link ORIGIN_REMOTE} came from the server and is never echoed back to it.
 *
 * ## Untrusted input
 *
 * Everything arriving from the server is remote-controlled, exactly as a WebRTC
 * peer was, so `AGENTS.md`'s rules apply unchanged: the trip is resolved
 * locally, never from the payload; a row that will not decode is skipped
 * individually rather than failing the batch; and the document's own schema
 * version gates whether it may be projected into Dexie at all.
 *
 * @module lib/sync/SupabaseYjsProvider
 */

import type {
  RealtimeChannel,
  RealtimePostgresInsertPayload,
  SupabaseClient,
} from '@supabase/supabase-js';
import * as Y from 'yjs';

import { areStateVectorsEqual, decodeUpdate, encodeUpdate } from './codec';
import { advanceCursor, readCursor, recordServerState } from './cursors';
import * as outbox from './outbox';
import type { TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/** Transaction origin for updates that arrived from the server. */
export const ORIGIN_REMOTE = 'supabase-remote';

/** Rows fetched per pull request, bounding both memory and payload size. */
const PULL_PAGE_SIZE = 500;

/**
 * The encoding of an update that carries no changes.
 *
 * Computed rather than hard-coded as a byte length, so it stays correct if the
 * encoding ever changes. A brand-new trip with nothing in it must not append a
 * row to the log just to say nothing.
 */
const EMPTY_UPDATE = Y.encodeStateAsUpdate(new Y.Doc());

function isEmptyUpdate(update: Uint8Array): boolean {
  if (update.length !== EMPTY_UPDATE.length) {
    return false;
  }
  return update.every((byte, index) => byte === EMPTY_UPDATE[index]);
}

/** Quiet period after a Realtime row before the reconciling pull runs. */
const PULL_DEBOUNCE_MS = 750;

/**
 * Log rows this device sees before it offers to compact the trip.
 *
 * Counted as traffic — rows applied plus rows sent — rather than as the log's
 * actual length, which would need a `count(*)` round trip the client does not
 * otherwise make. It over-triggers for a device that joins a long-established
 * trip and under-triggers for one that mostly watches, and both are fine: the
 * server's monotonic guard makes a redundant attempt a no-op, and any other
 * member's device will reach the threshold too.
 */
const COMPACT_AFTER_ROWS = 200;

/**
 * A stable, per-trip, non-identifying presence key for an account.
 *
 * Presence keys are visible to everyone on the channel, and this channel is
 * **public** — Postgres Changes payloads on it are filtered by RLS, but presence
 * is not, so anyone holding the publishable key who knows a trip's uuid could
 * read whatever is put here. So nothing identifying goes in: no email, no name,
 * and not the account id either.
 *
 * Salting with the trip id is the point. The same account on two tabs hashes
 * alike, so the count is people rather than connections; the same account on two
 * different trips does not, so presence cannot be used to follow somebody
 * between trips.
 *
 * This is obfuscation, not authorization — someone who already has a candidate
 * account id can confirm it by hashing. The real fix is a private channel with
 * RLS on `realtime.messages`, which is a migration and a deployment step; this
 * keeps the exposure to "how many people are on trip X" until then.
 */
function presenceKeyFor(userId: string, remoteTripId: string): string {
  // FNV-1a. Deliberately not a crypto hash: `crypto.subtle` is async, and the
  // property needed here is a stable mapping, not preimage resistance, which
  // truncating SHA-256 would not buy against a candidate id either.
  let hash = 0x81_1c_9d_c5;
  const input = `${userId}:${remoteTripId}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Backoff schedule for a failed flush or pull, in milliseconds. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000];

/**
 * Retry schedule for a document that started empty, in milliseconds.
 *
 * A cold join can win a race it has no way to detect: the invitee's provider
 * starts, pulls, and finds nothing because the owner's first upload has not
 * landed yet. Nothing then asks again — the retry schedule above only covers
 * *failures*, and a pull that correctly returns zero rows is not one — so the
 * invitee sits on "Getting the trip…" until the page is reloaded.
 *
 * Realtime would ordinarily cover this, which is exactly why it must not be the
 * only thing that does: a blocked WebSocket is ordinary on hotel, café and
 * corporate networks, which is where this app gets used. Bounded rather than
 * indefinite, because a genuinely empty trip is a legitimate state and must not
 * be polled forever.
 */
const HYDRATION_RETRY_MS = [750, 1_500, 3_000, 6_000, 12_000];

// ============================================================================
// Type Definitions
// ============================================================================

export type SyncStatus =
  /** No backend, or no remote trip: local-only, and not an error. */
  | 'local'
  /** Connected and up to date. */
  | 'synced'
  /** A pull or push is in flight. */
  | 'syncing'
  /** Something is queued and the last attempt failed. */
  | 'offline';

export interface SyncState {
  readonly status: SyncStatus;
  readonly pendingCount: number;
  readonly lastSyncedAt?: number;
  readonly lastError?: string;
  /**
   * People currently on this trip, this device included.
   *
   * `null` means unknown rather than nobody: Realtime is not connected, so the
   * honest answer is that we cannot say. A blocked WebSocket is ordinary on the
   * networks this app gets used on, and reporting "0 online" there would be a
   * lie about other people rather than about the connection.
   */
  readonly onlineCount: number | null;
}

export interface SupabaseYjsProviderOptions {
  readonly client: SupabaseClient;
  readonly doc: Y.Doc;
  /** Local trip id, used for Dexie-side bookkeeping. */
  readonly tripId: TripId;
  /** Server `trips.id`. */
  readonly remoteTripId: string;
  /**
   * The signed-in account, used only to derive a presence key.
   *
   * Optional: without it presence still works, it just counts connections
   * instead of people, so two tabs read as two.
   */
  readonly userId?: string;
  readonly onStateChange?: (state: SyncState) => void;
}

interface LogRow {
  readonly id: number;
  readonly update: string;
}

// ============================================================================
// Provider
// ============================================================================

export class SupabaseYjsProvider {
  private readonly client: SupabaseClient;
  private readonly doc: Y.Doc;
  private readonly tripId: TripId;
  private readonly remoteTripId: string;
  private readonly onStateChange?: (state: SyncState) => void;

  private channel: RealtimeChannel | null = null;
  private destroyed = false;
  private flushing = false;
  private pulling = false;
  private failures = 0;
  // Health is tracked per direction. A successful push must not report "synced"
  // while a pull is failing: the local document would look up to date when it is
  // actually missing everything the other side has written.
  private pullHealthy = true;
  private pushHealthy = true;
  /**
   * Local updates the outbox is not known to hold.
   *
   * Raised the instant the document emits and lowered only once the queue row is
   * durable, so a non-zero value means the document contains an edit the queue
   * has not recorded. While that is true the document's state vector must not be
   * recorded as the server's: the diff in `reconcile()` is computed against that
   * vector, so claiming it would make the missing edit unrecoverable rather than
   * merely delayed.
   */
  private unqueued = 0;
  private reconciling = false;
  private hydrationAttempt = 0;
  private hydrationTimer: ReturnType<typeof setTimeout> | null = null;
  private rowsSinceCompaction = 0;
  private compacting = false;
  private readonly userId: string | undefined;
  private pullTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private state: SyncState = { status: 'local', pendingCount: 0, onlineCount: null };

  private readonly handleDocUpdate: (update: Uint8Array, origin: unknown) => void;
  private readonly handleOnline: () => void;

  constructor(options: SupabaseYjsProviderOptions) {
    this.client = options.client;
    this.doc = options.doc;
    this.tripId = options.tripId;
    this.remoteTripId = options.remoteTripId;
    this.userId = options.userId;
    if (options.onStateChange) {
      this.onStateChange = options.onStateChange;
    }

    this.handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
      // Never send back what the server just sent us.
      if (origin === ORIGIN_REMOTE) {
        return;
      }
      // Counted here, synchronously with the document changing, because that is
      // the moment the edit becomes something this device holds and the server
      // does not.
      this.unqueued += 1;
      void this.queueAndFlush(update);
    };

    this.handleOnline = (): void => {
      this.failures = 0;
      void this.syncNow();
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Hydrates the document, reconciles anything the server is missing, and starts
   * listening.
   *
   * Resolves once the first pull and push have been attempted. It does not
   * reject on a network failure: being unable to reach the server is an expected
   * state, not an error, and the app must keep working through it.
   */
  async start(): Promise<void> {
    this.doc.on('update', this.handleDocUpdate);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
    }

    this.setState({ status: 'syncing' });

    await this.pull();
    await this.reconcile();
    this.subscribe();

    await this.refreshPending();

    // Nothing arrived and nothing local either: this is either a brand-new trip
    // or a cold join that outran the first upload, and the two are
    // indistinguishable from here. Ask again a few times.
    this.scheduleHydrationRetry();
  }

  /**
   * Pulls again while the document is still empty, on a bounded schedule.
   *
   * Stops at the first sign of content, on teardown, or when the schedule runs
   * out — an empty trip is a legitimate state, not something to poll forever.
   */
  private scheduleHydrationRetry(): void {
    if (this.destroyed || this.hydrationTimer !== null) {
      return;
    }
    if (!isEmptyUpdate(Y.encodeStateAsUpdate(this.doc))) {
      this.hydrationAttempt = 0;
      return;
    }
    const delay = HYDRATION_RETRY_MS[this.hydrationAttempt];
    if (delay === undefined) {
      return;
    }
    this.hydrationAttempt += 1;

    this.hydrationTimer = setTimeout(() => {
      this.hydrationTimer = null;
      void this.pull().then(() => {
        this.scheduleHydrationRetry();
      });
    }, delay);
  }

  /** Detaches every listener and timer. Safe to call more than once. */
  destroy(): void {
    this.destroyed = true;
    this.doc.off('update', this.handleDocUpdate);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
    }
    if (this.pullTimer !== null) {
      clearTimeout(this.pullTimer);
      this.pullTimer = null;
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.hydrationTimer !== null) {
      clearTimeout(this.hydrationTimer);
      this.hydrationTimer = null;
    }
    if (this.channel) {
      // `removeChannel` untracks presence as part of unsubscribing, so the other
      // devices see this one leave rather than waiting for a timeout.
      void this.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.state = { ...this.state, onlineCount: null };
  }

  /** Pull then flush, immediately. Used on reconnect and on tab focus. */
  async syncNow(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    await this.pull();
    await this.flush();
  }

  getState(): SyncState {
    return this.state;
  }

  // --------------------------------------------------------------------------
  // Reading the log
  // --------------------------------------------------------------------------

  /**
   * Applies the snapshot, if this device has never read anything, then every row
   * after the cursor.
   *
   * The snapshot is only worth fetching from a cold start: once a cursor exists,
   * the local document already contains everything the snapshot folded in, and
   * re-applying it would be a large no-op.
   */
  private async pull(): Promise<void> {
    if (this.destroyed || this.pulling) {
      return;
    }
    this.pulling = true;

    try {
      const cursor = await readCursor(this.tripId);

      // Whenever the snapshot is ahead of this device, not merely on a cold
      // start.
      //
      // Compaction folds log rows into the snapshot and then deletes them. A
      // device sitting at cursor 50 when rows 1..100 are folded and pruned would
      // otherwise ask for `id > 50`, receive 101 onwards, and silently lose
      // 51..100 forever — they exist only inside the snapshot it never fetched.
      //
      // The marker is read on its own first because the state itself can run to
      // megabytes, and the common case is that it has nothing new to offer.
      const snapshotThroughId = await this.fetchSnapshotThroughId();
      if (
        snapshotThroughId !== null &&
        snapshotThroughId > cursor.lastSeenUpdateId
      ) {
        await this.applySnapshot();
      }

      // Re-read: applySnapshot advances the cursor to the snapshot's through_id.
      let highestApplied = (await readCursor(this.tripId)).lastSeenUpdateId;
      for (;;) {
        if (this.destroyed) {
          // Teardown during a multi-page pull: the document is about to be
          // destroyed, so applying another page would write into a detached doc.
          break;
        }
        const rows = await this.fetchLogPage(highestApplied);
        if (rows.length === 0) {
          break;
        }

        this.applyRows(rows);
        this.rowsSinceCompaction += rows.length;
        highestApplied = rows[rows.length - 1]!.id;

        // The cursor advances per page, so an interrupted multi-page pull
        // resumes where it stopped instead of starting over.
        await advanceCursor(this.tripId, highestApplied);

        if (rows.length < PULL_PAGE_SIZE) {
          break;
        }
      }

      this.pullHealthy = true;
      // Only when both directions are healthy. Resetting on a good pull alone
      // would hold a persistently failing push at the first backoff step for as
      // long as reads kept succeeding.
      if (this.pushHealthy) {
        this.failures = 0;
      }
      this.setState({ lastSyncedAt: Date.now() });

      // Here specifically, because this is the one point where the document is
      // known to hold everything up to the cursor — which is exactly what the
      // snapshot claims.
      await this.maybeCompact();
    } catch (error: unknown) {
      this.pullHealthy = false;
      this.noteFailure(error);
    } finally {
      // Cleared *before* publishing, and published here rather than in the body.
      // `publishStatus` reports `syncing` while this flag is set, so publishing
      // inside the try reported `syncing` at the very moment the pull had
      // finished — every quiet pull flipped the status to `syncing` and then back
      // to `synced`, which is two state changes through a context wrapping the
      // whole app, for no news. A failed pull had it worse: it reported
      // `syncing` rather than `offline`.
      this.pulling = false;
      this.publishStatus();
    }
  }

  /**
   * The snapshot's `through_id`, without downloading the state.
   *
   * Null when no snapshot exists yet, which is the ordinary case until
   * compaction has run for a trip.
   */
  private async fetchSnapshotThroughId(): Promise<number | null> {
    const { data, error } = await this.client
      .from('trip_doc_snapshots')
      .select('through_id')
      .eq('trip_id', this.remoteTripId)
      .maybeSingle();

    if (error) {
      throw new Error(`snapshot marker read failed: ${error.message}`);
    }
    const throughId = (data as { through_id?: unknown } | null)?.through_id;
    return typeof throughId === 'number' ? throughId : null;
  }

  private async applySnapshot(): Promise<void> {
    const { data, error } = await this.client
      .from('trip_doc_snapshots')
      .select('state, through_id')
      .eq('trip_id', this.remoteTripId)
      .maybeSingle();

    if (error) {
      throw new Error(`snapshot read failed: ${error.message}`);
    }
    if (!data) {
      return;
    }

    const bytes = decodeUpdate((data as { state?: unknown }).state);
    if (!bytes) {
      // Whether this is survivable depends entirely on whether the log still
      // holds what the snapshot folded. Compaction upserts the snapshot and then
      // deletes those rows, so if pruning has run they exist nowhere this client
      // can reach.
      const cursor = await readCursor(this.tripId);
      const lowestLogId = await this.fetchLowestLogId();
      const logCoversTheGap =
        lowestLogId !== null && lowestLogId <= cursor.lastSeenUpdateId + 1;

      if (!logCoversTheGap) {
        // Reported as a pull failure so the status says `offline` and the retry
        // schedule keeps trying. Returning quietly would claim `synced` over a
        // document missing everything the snapshot swallowed.
        throw new Error(
          `snapshot for trip ${this.tripId} did not decode and the log has been pruned past the gap`,
        );
      }

      console.warn('[sync] snapshot for trip %s did not decode; using the log', this.tripId);
      return;
    }

    Y.applyUpdate(this.doc, bytes, ORIGIN_REMOTE);

    const throughId = (data as { through_id?: unknown }).through_id;
    if (typeof throughId === 'number' && throughId > 0) {
      await advanceCursor(this.tripId, throughId);
    }
  }

  /**
   * Folds the log into a snapshot, when this device has seen enough of it.
   *
   * Compaction used to be an Edge Function on a schedule, which reconstructed
   * each document by replaying every row purely to compute a value a connected
   * client already holds: `Y.encodeStateAsUpdate` is free here. Everything that
   * setup needed — a deployment, a service key in Vault, pg_cron, pg_net — existed
   * only to put a Yjs runtime somewhere it could do that replay.
   *
   * `through_id` is this device's own cursor, so the snapshot only ever claims
   * rows this device has actually applied. The server will not let it exceed the
   * log, will not let the head move backwards, and keeps a margin of recent rows
   * unpruned — so a device that publishes a snapshot its document had got wrong
   * does not take the newest history with it.
   *
   * Failure is swallowed. An uncompacted log is a growing table, not a broken
   * trip, and this must never be the reason sync reports a problem.
   */
  private async maybeCompact(): Promise<void> {
    if (this.destroyed || this.compacting) {
      return;
    }
    if (this.rowsSinceCompaction < COMPACT_AFTER_ROWS) {
      return;
    }

    const cursor = await readCursor(this.tripId);
    if (cursor.lastSeenUpdateId <= 0) {
      // Nothing applied from the log yet, so there is nothing to claim.
      return;
    }

    const state = Y.encodeStateAsUpdate(this.doc);
    if (isEmptyUpdate(state)) {
      // Publishing an empty snapshot over a log that has rows in it is the one
      // move here that could destroy content.
      return;
    }

    this.compacting = true;
    try {
      const { error } = await this.client.rpc('publish_trip_snapshot', {
        p_trip_id: this.remoteTripId,
        p_state: encodeUpdate(state),
        p_through_id: cursor.lastSeenUpdateId,
      });
      if (error) {
        console.warn('[sync] could not publish a snapshot:', error.message);
        return;
      }
      this.rowsSinceCompaction = 0;
    } catch (error: unknown) {
      console.warn('[sync] snapshot publish threw:', error);
    } finally {
      this.compacting = false;
    }
  }

  /**
   * The id of the oldest surviving log row, or null when the log is empty.
   *
   * Only used to tell a recoverable snapshot failure from an unrecoverable one.
   */
  private async fetchLowestLogId(): Promise<number | null> {
    const { data, error } = await this.client
      .from('trip_doc_updates')
      .select('id')
      .eq('trip_id', this.remoteTripId)
      .order('id', { ascending: true })
      .limit(1);

    if (error) {
      throw new Error(`log floor read failed: ${error.message}`);
    }
    const rows = (data ?? []) as { id?: unknown }[];
    const first = rows[0]?.id;
    return typeof first === 'number' ? first : null;
  }

  private async fetchLogPage(afterId: number): Promise<LogRow[]> {
    const { data, error } = await this.client
      .from('trip_doc_updates')
      .select('id, update')
      .eq('trip_id', this.remoteTripId)
      .gt('id', afterId)
      .order('id', { ascending: true })
      .limit(PULL_PAGE_SIZE);

    if (error) {
      throw new Error(`log read failed: ${error.message}`);
    }
    return (data ?? []) as LogRow[];
  }

  /**
   * Applies a page of rows in one transaction.
   *
   * One transaction rather than one per row so the bridge projects to Dexie once
   * for the whole page instead of once per update — the difference between one
   * write and five hundred on a cold start.
   */
  private applyRows(rows: readonly LogRow[]): void {
    Y.transact(
      this.doc,
      () => {
        for (const row of rows) {
          const bytes = decodeUpdate(row.update);
          if (!bytes) {
            // Drop the individual row, never the batch.
            console.warn('[sync] skipping undecodable log row %d', row.id);
            continue;
          }
          try {
            Y.applyUpdate(this.doc, bytes, ORIGIN_REMOTE);
          } catch (error: unknown) {
            console.warn('[sync] log row %d did not apply:', row.id, error);
          }
        }
      },
      ORIGIN_REMOTE,
    );
  }

  // --------------------------------------------------------------------------
  // Writing to the log
  // --------------------------------------------------------------------------

  /**
   * Sends whatever the server is missing, computed from its last known state
   * vector rather than from the queue.
   *
   * This is the correctness backstop. With no stored vector the diff is the whole
   * document, which is exactly the first upload; with one, it is every edit made
   * since the last successful push — including any the outbox dropped or never
   * recorded.
   */
  private async reconcile(): Promise<void> {
    if (this.destroyed || this.reconciling) {
      return;
    }
    this.reconciling = true;

    try {
      await this.reconcileOnce();
    } finally {
      this.reconciling = false;
    }
  }

  private async reconcileOnce(): Promise<void> {
    const cursor = await readCursor(this.tripId);
    const localVector = Y.encodeStateVector(this.doc);

    // Already in step: nothing to compute or send.
    if (areStateVectorsEqual(cursor.serverStateVector, localVector)) {
      await this.flush();
      return;
    }

    const missing = Y.encodeStateAsUpdate(this.doc, cursor.serverStateVector);

    if (isEmptyUpdate(missing)) {
      // Nothing to say. Recording the vector still matters: it is what makes the
      // next start recognise this trip as already uploaded.
      await recordServerState(this.tripId, localVector);
      this.unqueued = 0;
      this.publishStatus();
      return;
    }

    try {
      await this.insertUpdate(missing);
      // Only now is it true that the server holds this state.
      await recordServerState(this.tripId, localVector);
      // Anything queued is necessarily included in the diff just sent, and so is
      // anything that never reached the queue — the diff came from the document,
      // not from the queue, which is what makes this the backstop.
      await outbox.clear(this.tripId);
      this.unqueued = 0;
      this.pushHealthy = true;
      this.failures = 0;
    } catch (error: unknown) {
      this.pushHealthy = false;
      this.noteFailure(error);
    }

    await this.refreshPending();
  }

  /** Queues a local update, then tries to send the queue. */
  private async queueAndFlush(update: Uint8Array): Promise<void> {
    try {
      await outbox.enqueue(this.tripId, update);
      this.unqueued = Math.max(this.unqueued - 1, 0);
    } catch (error: unknown) {
      // The count stays raised: this edit is in the document and in no queue, so
      // only a reconciliation that diffs the document can carry it. Left to the
      // outbox it would be lost outright.
      console.error('[sync] failed to queue an update:', error);
      await this.refreshPending();
      await this.reconcile();
      return;
    }
    await this.refreshPending();
    await this.flush();
  }

  /**
   * Sends queued updates, oldest first, stopping at the first failure.
   *
   * Stopping rather than continuing keeps the queue in order and avoids
   * hammering a server that is refusing writes.
   */
  private async flush(): Promise<void> {
    if (this.destroyed || this.flushing) {
      return;
    }
    this.flushing = true;

    try {
      const rows = await outbox.pending(this.tripId);
      if (rows.length === 0) {
        return;
      }

      this.setState({ status: 'syncing' });
      const sent: number[] = [];

      for (const row of rows) {
        if (this.destroyed) {
          break;
        }
        try {
          await this.insertUpdate(row.update);
          if (row.id !== undefined) {
            sent.push(row.id);
          }
        } catch (error: unknown) {
          this.pushHealthy = false;
          this.noteFailure(error);
          break;
        }
      }

      await outbox.acknowledge(sent);

      const remaining = await outbox.pendingCount(this.tripId);
      if (remaining === 0 && sent.length > 0) {
        this.pushHealthy = true;
        this.failures = 0;
        this.setState({ lastSyncedAt: Date.now() });

        // An empty queue is not on its own evidence that the server holds the
        // document. The document emits synchronously and the queue row is
        // written asynchronously, so an edit made while this flush was in
        // flight can be in the document with no row to represent it — and a
        // vector recorded here would cover it, making `reconcile()` compute an
        // empty diff and strand it permanently.
        if (this.unqueued === 0) {
          await recordServerState(this.tripId, Y.encodeStateVector(this.doc));
        }
      }
    } finally {
      this.flushing = false;
      await this.refreshPending();
      this.publishStatus();
    }
  }

  private async insertUpdate(update: Uint8Array): Promise<void> {
    const { error } = await this.client.from('trip_doc_updates').insert({
      trip_id: this.remoteTripId,
      update: encodeUpdate(update),
    });

    if (error) {
      throw new Error(`log write failed: ${error.message}`);
    }
    this.rowsSinceCompaction += 1;
  }

  // --------------------------------------------------------------------------
  // Realtime
  // --------------------------------------------------------------------------

  /**
   * Subscribes to this trip's log.
   *
   * Postgres Changes honours RLS, so only rows this member may read arrive. The
   * payload is applied straight away for latency, and a debounced pull follows
   * to advance the cursor — see the module note on why the cursor never moves on
   * a Realtime row.
   */
  private subscribe(): void {
    if (this.destroyed || this.channel) {
      return;
    }

    const presenceKey =
      this.userId === undefined
        ? undefined
        : presenceKeyFor(this.userId, this.remoteTripId);

    const channelName = `trip-doc:${this.remoteTripId}`;
    // Without a key Realtime assigns one per connection, which counts tabs
    // rather than people. Built as two calls rather than a conditional spread:
    // `exactOptionalPropertyTypes` will not accept a possibly-undefined `config`.
    const joined =
      presenceKey === undefined
        ? this.client.channel(channelName)
        : this.client.channel(channelName, {
            config: { presence: { key: presenceKey } },
          });

    const channel = joined
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'trip_doc_updates',
          filter: `trip_id=eq.${this.remoteTripId}`,
        },
        (payload: RealtimePostgresInsertPayload<Record<string, unknown>>) => {
          this.onRealtimeInsert(payload);
        },
      )
      // Fires on join, leave and the initial state, so one handler covers all
      // three: the count is always read from the channel rather than tallied.
      .on('presence', { event: 'sync' }, () => {
        this.publishPresence();
      });

    // Assigned *before* subscribing. `subscribe` is free to invoke its callback
    // synchronously, and with the assignment at the end of the chain the
    // callback then ran while `this.channel` was still null — so this device
    // never announced itself and the head count stayed unknown.
    this.channel = channel;

    channel.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        // A resubscribe means the socket dropped and came back, so anything
        // missed while it was down has to be pulled.
        this.schedulePull();
        // Announced only once the channel is actually joined; tracking earlier
        // is dropped on the floor.
        void channel.track({ joinedAt: Date.now() });
        this.publishPresence();
        return;
      }

      if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // Unknown, not zero — see `SyncState.onlineCount`.
        this.setState({ onlineCount: null });
      }
    });
  }

  private onRealtimeInsert(
    payload: RealtimePostgresInsertPayload<Record<string, unknown>>,
  ): void {
    if (this.destroyed) {
      return;
    }

    const bytes = decodeUpdate(payload.new?.update);
    if (bytes) {
      try {
        Y.applyUpdate(this.doc, bytes, ORIGIN_REMOTE);
      } catch (error: unknown) {
        console.warn('[sync] realtime payload did not apply:', error);
      }
    }

    // Whether or not the payload was usable, a row exists that the cursor has
    // not accounted for.
    this.schedulePull();
  }

  /**
   * Reads the channel's presence state and publishes the head count.
   *
   * Counted from the keys, so two tabs of one account collapse to one person.
   */
  private publishPresence(): void {
    if (this.destroyed || !this.channel) {
      return;
    }
    try {
      const present = this.channel.presenceState();
      this.setState({ onlineCount: Object.keys(present).length });
    } catch (error: unknown) {
      // Presence is a nicety; never let it take sync down.
      console.warn('[sync] could not read presence:', error);
      this.setState({ onlineCount: null });
    }
  }

  private schedulePull(): void {
    if (this.destroyed) {
      return;
    }
    if (this.pullTimer !== null) {
      clearTimeout(this.pullTimer);
    }
    this.pullTimer = setTimeout(() => {
      this.pullTimer = null;
      void this.pull();
    }, PULL_DEBOUNCE_MS);
  }

  // --------------------------------------------------------------------------
  // Failure handling
  // --------------------------------------------------------------------------

  private noteFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.failures += 1;
    this.setState({ lastError: message });
    this.publishStatus();
    this.scheduleRetry();
  }

  /**
   * Derives the status from both directions' health.
   *
   * Kept in one place so no call site can report "synced" on the strength of
   * whichever half it happens to know about.
   */
  private publishStatus(): void {
    if (this.pulling || this.flushing) {
      this.setState({ status: 'syncing' });
      return;
    }
    this.setState({
      status: this.pullHealthy && this.pushHealthy ? 'synced' : 'offline',
    });
  }

  private scheduleRetry(): void {
    if (this.destroyed || this.retryTimer !== null) {
      return;
    }

    const index = Math.min(this.failures - 1, BACKOFF_MS.length - 1);
    const base = BACKOFF_MS[Math.max(index, 0)] ?? 1_000;
    // Jitter so several tabs reconnecting after the same outage do not all
    // retry on the same tick.
    const delay = base + Math.random() * base * 0.3;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.syncNow();
    }, delay);
  }

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  private async refreshPending(): Promise<void> {
    try {
      const count = await outbox.pendingCount(this.tripId);
      this.setState({ pendingCount: count });
    } catch {
      // A failed count must not take the provider down.
    }
  }

  /**
   * Records the state, and tells the consumer only when it can tell.
   *
   * The published state feeds a React context wrapping the whole app, so every
   * notification re-renders that tree. `lastSyncedAt` moves on every successful
   * pull, which meant a quiet pull finding nothing still published — and with the
   * hydration retry pulling on a timer while a document is empty, that was a
   * re-render of the entire app every few seconds for no new information.
   * Measured at nineteen publications where seven carried anything.
   *
   * The timestamp is still stored; nothing reads it today, and a consumer that
   * starts to should get it from a state change that means something.
   */
  private setState(patch: Partial<SyncState>): void {
    const next = { ...this.state, ...patch };
    const observablyChanged =
      next.status !== this.state.status ||
      next.pendingCount !== this.state.pendingCount ||
      next.onlineCount !== this.state.onlineCount ||
      next.lastError !== this.state.lastError;

    this.state = next;
    if (observablyChanged) {
      this.onStateChange?.(next);
    }
  }
}
