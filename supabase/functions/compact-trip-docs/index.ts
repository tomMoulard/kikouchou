/**
 * Folds each busy trip's Yjs log into a snapshot, then prunes what it folded.
 *
 * ## Why this cannot be SQL
 *
 * Merging Yjs updates requires Yjs. There is no way to express "collapse these
 * binary CRDT updates into one equivalent state" in Postgres, which is why this
 * is an Edge Function on a schedule rather than a `pg_cron` procedure.
 *
 * ## Why it runs as the service role
 *
 * The log is append-only for users — no policy grants them UPDATE or DELETE —
 * and `trip_doc_snapshots` has no user write policy at all. That is deliberate:
 * a member must not be able to rewrite a trip's history by replacing its
 * compacted head. Compaction is the one actor allowed to, and it uses the
 * service key, which never leaves the server.
 *
 * ## The ordering that keeps it safe
 *
 * Snapshot first, prune second, and never prune past what the snapshot covers.
 * If the function dies between the two, the log still holds everything and the
 * next run repeats the work — wasteful, not lossy. Doing it the other way round
 * would delete rows nothing had yet folded.
 *
 * A client whose cursor sits below a pruned row recovers because it applies any
 * snapshot whose `through_id` is ahead of its cursor. That is asserted in
 * `SupabaseYjsProvider.test.ts`; without it, pruning would silently drop updates
 * for exactly the devices that had been offline longest.
 *
 * Deploy:  bunx supabase functions deploy compact-trip-docs
 * Invoke:  see the pg_cron schedule in the accompanying migration.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as Y from 'npm:yjs@13.6.30';

// ============================================================================
// Tuning
// ============================================================================

/**
 * Log rows a trip needs before compacting it is worth the read and write.
 *
 * Low enough that no trip carries a long log for long; high enough that an
 * ordinary week of edits does not trigger a rewrite on every run.
 */
const COMPACT_THRESHOLD = 200;

/** Trips handled per invocation, bounding runtime and memory. */
const MAX_TRIPS_PER_RUN = 25;

/** Log rows read per page. */
const PAGE_SIZE = 1000;

// ============================================================================
// Codec
// ============================================================================

function decode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return null;
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  // Chunked: `String.fromCharCode(...bytes)` throws RangeError on a whole
  // document's worth of state.
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

// ============================================================================
// Compaction
// ============================================================================

/**
 * The slice of the Supabase client this function uses.
 *
 * Written out rather than typed `any` so a change in call shape is a type error
 * here too, even though ESLint does not lint this directory.
 */
interface QueryResult {
  readonly data?: unknown;
  readonly error?: { readonly message: string } | null;
  readonly count?: number | null;
}

interface Client {
  from: (table: string) => {
    select: (columns: string, options?: unknown) => any;
    upsert: (values: unknown, options?: unknown) => Promise<QueryResult>;
    delete: (options?: unknown) => any;
  };
}

interface Outcome {
  readonly tripId: string;
  readonly folded: number;
  readonly pruned: number;
  readonly throughId: number;
  readonly skipped?: string;
}

async function compactTrip(client: Client, tripId: string): Promise<Outcome> {
  const doc = new Y.Doc();

  // Start from the existing snapshot so its history is carried forward rather
  // than discarded — the rows behind it are already gone.
  const { data: existing } = await client
    .from('trip_doc_snapshots')
    .select('state, through_id')
    .eq('trip_id', tripId)
    .maybeSingle();

  let baseThroughId = 0;
  if (existing) {
    const bytes = decode(String(existing.state));
    if (bytes) {
      Y.applyUpdate(doc, bytes);
      baseThroughId = Number(existing.through_id) || 0;
    }
  }

  // Fold everything after it.
  let highestFolded = baseThroughId;
  let folded = 0;
  for (;;) {
    const { data: rows, error } = await client
      .from('trip_doc_updates')
      .select('id, update')
      .eq('trip_id', tripId)
      .gt('id', highestFolded)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);

    if (error) {
      throw new Error(`log read failed: ${error.message}`);
    }
    if (!rows || rows.length === 0) {
      break;
    }

    Y.transact(doc, () => {
      for (const row of rows) {
        const bytes = decode(String(row.update));
        if (!bytes) {
          // Skip the row, keep the batch. A single unreadable update must not
          // stall compaction for a trip forever.
          console.warn(`trip ${tripId}: log row ${row.id} did not decode`);
          continue;
        }
        Y.applyUpdate(doc, bytes);
        folded += 1;
      }
    });

    highestFolded = Number(rows[rows.length - 1].id);
    if (rows.length < PAGE_SIZE) {
      break;
    }
  }

  if (highestFolded <= baseThroughId) {
    return { tripId, folded: 0, pruned: 0, throughId: baseThroughId, skipped: 'nothing new' };
  }

  // Write the snapshot *before* pruning. Dying between the two costs a repeated
  // run; the other order would delete rows nothing had folded.
  const state = encode(Y.encodeStateAsUpdate(doc));
  const { error: upsertError } = await client
    .from('trip_doc_snapshots')
    .upsert(
      { trip_id: tripId, state, through_id: highestFolded, updated_at: new Date().toISOString() },
      { onConflict: 'trip_id' },
    );

  if (upsertError) {
    throw new Error(`snapshot write failed: ${upsertError.message}`);
  }

  // Only ever prune what the snapshot demonstrably covers.
  const { error: deleteError, count } = await client
    .from('trip_doc_updates')
    .delete({ count: 'exact' })
    .eq('trip_id', tripId)
    .lte('id', highestFolded);

  if (deleteError) {
    // The snapshot is already in place, so the next run prunes these. Report it
    // rather than failing the whole invocation.
    console.error(`trip ${tripId}: prune failed: ${deleteError.message}`);
    return { tripId, folded, pruned: 0, throughId: highestFolded, skipped: 'prune failed' };
  }

  return { tripId, folded, pruned: count ?? 0, throughId: highestFolded };
}

// ============================================================================
// Entry point
// ============================================================================

Deno.serve(async (request: Request) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const url = Deno.env.get('SUPABASE_URL');
  if (!serviceKey || !url) {
    return Response.json({ error: 'function is not configured' }, { status: 500 });
  }

  // The scheduler calls this with the service key; nothing else should be able
  // to trigger a rewrite of every trip's history.
  const authorization = request.headers.get('Authorization');
  if (authorization !== `Bearer ${serviceKey}`) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as Client;

  // Which trips have enough log to be worth it. Done as a grouped count so the
  // function does not read every trip's rows just to decide.
  const { data: busy, error } = await client
    .from('trip_doc_updates')
    .select('trip_id')
    .limit(PAGE_SIZE * 10);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const counts = new Map<string, number>();
  for (const row of busy ?? []) {
    const id = String(row.trip_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const candidates = [...counts.entries()]
    .filter(([, count]) => count >= COMPACT_THRESHOLD)
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_TRIPS_PER_RUN)
    .map(([tripId]) => tripId);

  const results: Outcome[] = [];
  for (const tripId of candidates) {
    try {
      results.push(await compactTrip(client, tripId));
    } catch (cause) {
      // One bad trip must not stop the rest.
      console.error(`trip ${tripId}: compaction failed:`, cause);
      results.push({
        tripId,
        folded: 0,
        pruned: 0,
        throughId: 0,
        skipped: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return Response.json({
    considered: counts.size,
    compacted: results.length,
    results,
  });
});
