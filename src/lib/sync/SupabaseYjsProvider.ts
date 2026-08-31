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

/** Backoff schedule for a failed flush or pull, in milliseconds. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000];

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
}

export interface SupabaseYjsProviderOptions {
  readonly client: SupabaseClient;
  readonly doc: Y.Doc;
  /** Local trip id, used for Dexie-side bookkeeping. */
  readonly tripId: TripId;
  /** Server `trips.id`. */
  readonly remoteTripId: string;
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
  private pullTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private state: SyncState = { status: 'local', pendingCount: 0 };

  private readonly handleDocUpdate: (update: Uint8Array, origin: unknown) => void;
  private readonly handleOnline: () => void;

  constructor(options: SupabaseYjsProviderOptions) {
    this.client = options.client;
    this.doc = options.doc;
    this.tripId = options.tripId;
    this.remoteTripId = options.remoteTripId;
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
    if (this.channel) {
      void this.client.removeChannel(this.channel);
      this.channel = null;
    }
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
      this.publishStatus();
    } catch (error: unknown) {
      this.pullHealthy = false;
      this.noteFailure(error);
    } finally {
      this.pulling = false;
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

    this.channel = this.client
      .channel(`trip-doc:${this.remoteTripId}`)
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
      .subscribe((status: string) => {
        // A resubscribe means the socket dropped and came back, so anything
        // missed while it was down has to be pulled.
        if (status === 'SUBSCRIBED') {
          this.schedulePull();
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

  private setState(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    this.onStateChange?.(this.state);
  }
}
