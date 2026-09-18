/**
 * @fileoverview Tests for the per-request action narrowing.
 *
 * The contract worth protecting is the fallback, not the happy path: this runs
 * on the way to every answer, and a narrowing that misfires must cost the user
 * a longer prompt, never an action the model can no longer reach. Each failure
 * mode below therefore asserts the full catalogue comes back.
 *
 * The worker is replaced by a fake so no WASM is loaded, and it is driven by
 * hand so a reply can be withheld to test the timeout.
 *
 * @module features/assistant/__tests__/action-retrieval.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACTION_SCHEMAS } from '../action-schema';

// ============================================================================
// Test doubles
// ============================================================================

interface Posted {
  readonly type: string;
  readonly requestId: string;
  readonly query?: string;
  readonly topK?: number;
}

class FakeWorker {
  static instances: FakeWorker[] = [];

  public readonly posted: Posted[] = [];
  public readonly terminate = vi.fn();
  private listener: ((event: { data: unknown }) => void) | null = null;

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, handler: (event: { data: unknown }) => void): void {
    if (type === 'message') this.listener = handler;
  }

  postMessage(message: Posted): void {
    this.posted.push(message);
    // The load is answered straight away; a `retrieve` waits for the test.
    if (message.type === 'load') {
      this.reply({ type: 'loaded', requestId: message.requestId });
    }
  }

  reply(data: unknown): void {
    this.listener?.({ data });
  }

  /** The id of the retrieve request in flight, if any. */
  retrieveRequestId(): string | undefined {
    return this.posted.find((message) => message.type === 'retrieve')?.requestId;
  }
}

/** Imports a fresh module — its worker and load promise live at module scope. */
async function freshModule(): Promise<
  typeof import('../action-retrieval')
> {
  vi.resetModules();
  return import('../action-retrieval');
}

/**
 * A module whose engine has finished loading.
 *
 * The first request never ranks — it starts the download and answers with the
 * full catalogue — so every test about ranking spends one call getting there.
 */
async function primedModule(): Promise<typeof import('../action-retrieval')> {
  const mod = await freshModule();
  await mod.narrowActionsForRequest('priming request');
  await vi.waitFor(() => {
    expect(FakeWorker.instances[0]?.posted).toHaveLength(1);
  });
  return mod;
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('narrowActionsForRequest', () => {
  it('answers with the full catalogue while the engine is still loading', async () => {
    // The first answer must not wait on a 13.7 MB download to make its prompt
    // shorter; the load starts here and the next turn is the one that narrows.
    const { narrowActionsForRequest } = await freshModule();

    expect(await narrowActionsForRequest('add an attic room')).toEqual(
      ACTION_SCHEMAS,
    );
    expect(FakeWorker.instances[0]?.posted[0]?.type).toBe('load');
  });

  it('keeps the actions the ranking named, in catalogue order', async () => {
    const { narrowActionsForRequest } = await primedModule();

    const pending = narrowActionsForRequest('add an attic room');
    await vi.waitFor(() => {
      expect(FakeWorker.instances[0]?.retrieveRequestId()).toBeDefined();
    });

    const worker = FakeWorker.instances[0]!;
    worker.reply({
      type: 'done',
      requestId: worker.retrieveRequestId(),
      text: JSON.stringify(['addRoom', 'updateRoom', 'removeRoom']),
      interrupted: false,
    });

    const actions = await pending;
    expect(actions.map((def) => def.action)).toEqual(
      ACTION_SCHEMAS.filter((def) =>
        ['addRoom', 'updateRoom', 'removeRoom'].includes(def.action),
      ).map((def) => def.action),
    );
  });

  it('asks the ranking for the user request itself', async () => {
    const { narrowActionsForRequest } = await primedModule();

    void narrowActionsForRequest('add an attic room');
    await vi.waitFor(() => {
      expect(FakeWorker.instances[0]?.retrieveRequestId()).toBeDefined();
    });

    const retrieve = FakeWorker.instances[0]!.posted.find(
      (message) => message.type === 'retrieve',
    );
    expect(retrieve?.query).toBe('add an attic room');
    expect(retrieve?.topK).toBeGreaterThan(1);
  });

  it('loads the engine once and reuses it across requests', async () => {
    const { narrowActionsForRequest } = await primedModule();

    void narrowActionsForRequest('first');
    await vi.waitFor(() => {
      expect(FakeWorker.instances[0]?.retrieveRequestId()).toBeDefined();
    });
    const worker = FakeWorker.instances[0]!;
    worker.reply({
      type: 'done',
      requestId: worker.retrieveRequestId(),
      text: '[]',
      interrupted: false,
    });

    void narrowActionsForRequest('second');
    await vi.waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === 'retrieve'),
      ).toHaveLength(2);
    });

    expect(worker.posted.filter((message) => message.type === 'load')).toHaveLength(1);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('falls back to the full catalogue when the ranking matched nothing', async () => {
    const { narrowActionsForRequest } = await primedModule();

    const pending = narrowActionsForRequest('hello there');
    await vi.waitFor(() => {
      expect(FakeWorker.instances[0]?.retrieveRequestId()).toBeDefined();
    });
    const worker = FakeWorker.instances[0]!;
    worker.reply({
      type: 'done',
      requestId: worker.retrieveRequestId(),
      text: '[]',
      interrupted: false,
    });

    expect(await pending).toEqual(ACTION_SCHEMAS);
  });

  it('falls back when the ranking kept only one action', async () => {
    // One action is not a prompt: the same turn often has to answer a question
    // about something else, and a catalogue of one cannot.
    const { narrowActionsForRequest } = await primedModule();

    const pending = narrowActionsForRequest('add a room');
    await vi.waitFor(() => {
      expect(FakeWorker.instances[0]?.retrieveRequestId()).toBeDefined();
    });
    const worker = FakeWorker.instances[0]!;
    worker.reply({
      type: 'done',
      requestId: worker.retrieveRequestId(),
      text: '["addRoom"]',
      interrupted: false,
    });

    expect(await pending).toEqual(ACTION_SCHEMAS);
  });

  it('falls back when the worker reports an error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { narrowActionsForRequest } = await primedModule();

    const pending = narrowActionsForRequest('add a room');
    await vi.waitFor(() => {
      expect(FakeWorker.instances[0]?.retrieveRequestId()).toBeDefined();
    });
    const worker = FakeWorker.instances[0]!;
    worker.reply({
      type: 'error',
      requestId: worker.retrieveRequestId(),
      message: 'the weights would not load',
      fatal: true,
    });

    expect(await pending).toEqual(ACTION_SCHEMAS);
    consoleError.mockRestore();
  });

  it('falls back rather than making the turn wait on a stalled ranking', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { narrowActionsForRequest } = await primedModule();
    vi.useFakeTimers();

    const pending = narrowActionsForRequest('add a room');
    await vi.advanceTimersByTimeAsync(5000);

    expect(await pending).toEqual(ACTION_SCHEMAS);
    consoleError.mockRestore();
  });

  it('falls back with no worker at all rather than throwing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('Worker', undefined);
    const { narrowActionsForRequest } = await freshModule();

    expect(await narrowActionsForRequest('add a room')).toEqual(ACTION_SCHEMAS);
    consoleError.mockRestore();
  });

  it('does not start an engine for an empty request', async () => {
    const { narrowActionsForRequest } = await freshModule();

    expect(await narrowActionsForRequest('   ')).toEqual(ACTION_SCHEMAS);
    expect(FakeWorker.instances).toHaveLength(0);
  });
});

describe('releaseActionRetrieval', () => {
  it('terminates the worker so the next request builds a new one', async () => {
    const { narrowActionsForRequest, releaseActionRetrieval } =
      await primedModule();

    void narrowActionsForRequest('first');
    await vi.waitFor(() => {
      expect(FakeWorker.instances[0]?.retrieveRequestId()).toBeDefined();
    });
    const first = FakeWorker.instances[0]!;

    await releaseActionRetrieval();
    expect(first.terminate).toHaveBeenCalled();

    void narrowActionsForRequest('second');
    await vi.waitFor(() => {
      expect(FakeWorker.instances).toHaveLength(2);
    });
  });
});
