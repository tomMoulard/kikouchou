/**
 * @fileoverview A Supabase client double that records every query it is asked.
 *
 * Each `from(table)` starts a query, and every method chained on it is written
 * down with its arguments. The chain is a thenable, so whatever terminal call a
 * module makes (`.single()`, `.maybeSingle()`, `.limit()`, or none at all), the
 * `await` reaches `respond`, which answers from the recorded query. A throw from
 * `respond` becomes a rejection, which is how a request that never reached the
 * server looks to the caller.
 *
 * Asserting on `describeQuery()` strings pins the table, the columns and the
 * filters a module sends, which a double that ignores its arguments cannot.
 *
 * @module lib/sync/__tests__/support/fake-supabase
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface QueryCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

export interface RecordedQuery {
  readonly table: string;
  readonly calls: QueryCall[];
}

export type Responder = (query: RecordedQuery) => unknown;

export interface RecordedRpc {
  readonly name: string;
  readonly args: unknown;
}

// ============================================================================
// Helpers
// ============================================================================

function formatArg(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** `trips.select(id).eq(owner_id, u1)`, the query as one readable string. */
export function describeQuery(query: RecordedQuery): string {
  return (
    query.table +
    query.calls
      .map((call) => `.${call.method}(${call.args.map(formatArg).join(', ')})`)
      .join('')
  );
}

/** Whether the query chained `method` at all. */
export function hasCall(query: RecordedQuery, method: string): boolean {
  return query.calls.some((call) => call.method === method);
}

/** The arguments of the first `method` call on the query. */
export function argsOf(query: RecordedQuery, method: string): readonly unknown[] | undefined {
  return query.calls.find((call) => call.method === method)?.args;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Builds the double.
 *
 * @param respond - Answers a finished query, or throws to reject it
 * @param rpc - Answers `client.rpc(name, args)`, or throws to reject it
 */
export function fakeSupabase(
  respond: Responder,
  rpc: (name: string, args: unknown) => unknown = () => ({ data: null, error: null }),
) {
  const queries: RecordedQuery[] = [];
  const rpcs: RecordedRpc[] = [];

  function chain(query: RecordedQuery): unknown {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === 'then') {
            return (
              resolve: (value: unknown) => unknown,
              reject: (reason: unknown) => unknown,
            ) =>
              Promise.resolve()
                .then(() => respond(query))
                .then(resolve, reject);
          }
          return (...args: unknown[]) => {
            query.calls.push({ method: String(property), args });
            return proxy;
          };
        },
      },
    );
    return proxy;
  }

  const client = {
    from(table: string) {
      const query: RecordedQuery = { table, calls: [] };
      queries.push(query);
      return chain(query);
    },
    async rpc(name: string, args: unknown) {
      rpcs.push({ name, args });
      return rpc(name, args);
    },
  };

  return {
    client: client as never,
    queries,
    rpcs,
    /** Every query so far, described. */
    described: (): string[] => queries.map(describeQuery),
  };
}
