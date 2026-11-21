/**
 * @fileoverview Keeps every `BroadcastChannel` inside one Vitest worker thread.
 *
 * Dexie posts each committed write on the channel `x-storagemutated-1`, and a
 * message there re-runs the live queries it touches. In a browser the channel
 * joins the tabs of one origin. In Node it joins every `worker_threads` worker
 * of the process, and Vitest runs several, each with its own fake IndexedDB
 * under the same database name. The clears and writes of one test file then
 * re-ran the live queries of another: `reopen.test.ts` counted 433 emissions
 * of an unchanged result in 5 seconds and failed in about half of the full
 * runs (`broadcast-channel-isolation.test.ts` pins the fix).
 *
 * Each channel name gets the worker's thread id, so channels in one thread
 * still reach each other and no other worker can reach in.
 *
 * It is the first setup file: Dexie opens its channel when its module is
 * evaluated, so the replacement has to be in place before anything imports
 * Dexie.
 *
 * @module test/isolate-broadcast-channel
 */

import { threadId } from 'node:worker_threads';

const NativeBroadcastChannel = globalThis.BroadcastChannel;

/** A `BroadcastChannel` that only reaches channels of this worker thread. */
class ThreadBroadcastChannel extends NativeBroadcastChannel {
  constructor(name: string) {
    super(`${name}@thread-${threadId}`);
  }
}

globalThis.BroadcastChannel = ThreadBroadcastChannel;
