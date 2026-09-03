/**
 * @fileoverview A stand-in Supabase backend for the browser tests.
 *
 * The sharing flows cannot be driven without a backend, and the two candidates
 * both fail for this job: the hosted project holds the user's real data, and
 * Google OAuth cannot be automated at all. The local Docker stack is the
 * faithful option, but it is not what these tests are for — RLS and the server
 * functions already have 69 pgTAP tests against a real Postgres. What has no
 * coverage is the *journey*: share, hand the link over, join, pick an identity,
 * edit from two devices, go offline and come back. That lives in the browser.
 *
 * So this implements the REST surface the app actually calls, in the Node
 * process, and installs it with `page.route`. Two browser contexts pointed at
 * one instance are two devices talking to one server, which is what makes
 * cross-device convergence testable without a network.
 *
 * What it deliberately does **not** do:
 *
 * - **Enforce RLS.** It would be a re-implementation, and a passing
 *   re-implementation proves nothing about the policies that actually ship.
 *   `supabase/tests/*.sql` is where that belongs.
 * - **Serve Realtime.** The WebSocket is refused, so the tests exercise the
 *   provider's pull path — the one that has to work anyway, because a socket
 *   cannot be relied on. Anything asserting sub-second delivery would be
 *   asserting the stub.
 *
 * @module e2e/support/supabase-stub
 */

import type { Page, Route } from '@playwright/test';

// ============================================================================
// Constants
// ============================================================================

/**
 * Where the app under test thinks its backend is.
 *
 * A host that resolves nowhere, so a route that escapes interception fails
 * loudly instead of reaching something real. The Playwright project passes this
 * as `VITE_SUPABASE_URL`; a process env var beats `.env.local`, which is what
 * keeps a developer's own credentials — and the production project — out of
 * these tests.
 */
export const STUB_URL = 'http://stub.invalid';

export const STUB_PUBLISHABLE_KEY = 'sb_publishable_e2e_stub';

/** Matches the key `lib/supabase/client` persists the session under. */
const AUTH_STORAGE_KEY = 'kikoushou-auth';

// ============================================================================
// Type Definitions
// ============================================================================

export interface StubUser {
  readonly id: string;
  readonly email: string;
}

interface TripRow {
  id: string;
  local_id: string;
  owner_id: string;
  name: string;
  start_date: string;
  end_date: string;
}

interface MemberRow {
  trip_id: string;
  user_id: string;
  person_id: string | null;
}

interface InviteRow {
  token: string;
  trip_id: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  revoked_at: string | null;
}

interface UpdateRow {
  id: number;
  trip_id: string;
  update: string;
}

interface SnapshotRow {
  trip_id: string;
  state: string;
  through_id: number;
}

// ============================================================================
// Helpers
// ============================================================================

/** Strips a PostgREST operator prefix: `eq.abc` -> `abc`. */
function operand(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const dot = value.indexOf('.');
  return dot === -1 ? value : value.slice(dot + 1);
}

function uuid(seed: number): string {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, '0')}`;
}

// ============================================================================
// The stub
// ============================================================================

export class SupabaseStub {
  trips: TripRow[] = [];
  members: MemberRow[] = [];
  invites: InviteRow[] = [];
  updates: UpdateRow[] = [];
  snapshots: SnapshotRow[] = [];

  /** Requests refused, so a test can simulate an outage without going offline. */
  offline = false;

  /** Counts, for asserting a flow does not repeat work it has already done. */
  counts = { tripInserts: 0, inviteInserts: 0, updateInserts: 0, redeems: 0 };

  private nextTrip = 1;
  private nextUpdateId = 1;

  // --------------------------------------------------------------------------
  // Seeding
  // --------------------------------------------------------------------------

  /** Adds a member row directly, standing in for a completed redemption. */
  addMember(tripId: string, userId: string, personId: string | null = null): void {
    this.members.push({ trip_id: tripId, user_id: userId, person_id: personId });
  }

  /** Mints an invite directly, so a test can start from "a link exists". */
  addInvite(tripId: string, createdBy: string, token: string, overrides: Partial<InviteRow> = {}): void {
    this.invites.push({
      token,
      trip_id: tripId,
      created_by: createdBy,
      created_at: new Date().toISOString(),
      expires_at: null,
      max_uses: null,
      uses: 0,
      revoked_at: null,
      ...overrides,
    });
  }

  /** The trip row an owner's share created, for tests that need its id. */
  tripByLocalId(localId: string): TripRow | undefined {
    return this.trips.find((trip) => trip.local_id === localId);
  }

  // --------------------------------------------------------------------------
  // Installation
  // --------------------------------------------------------------------------

  /**
   * Routes this page's Supabase traffic into the stub.
   *
   * Call before `page.goto`, so the very first request is covered.
   */
  async install(page: Page): Promise<void> {
    await page.route(`${STUB_URL}/**`, async (route: Route) => {
      if (this.offline) {
        await route.abort('connectionfailed');
        return;
      }

      const url = new URL(route.request().url());
      const path = url.pathname;

      try {
        if (path.startsWith('/auth/v1/')) {
          await this.handleAuth(route, path);
          return;
        }
        if (path.startsWith('/realtime/v1/')) {
          // No Realtime: see the module note. The provider's pull path is what
          // these tests exercise.
          await route.abort('connectionfailed');
          return;
        }
        if (path.startsWith('/rest/v1/')) {
          await this.handleRest(route, path.slice('/rest/v1/'.length), url);
          return;
        }
      } catch (error: unknown) {
        await this.fail(route, 500, String(error));
        return;
      }

      await this.fail(route, 404, `stub has no handler for ${path}`);
    });
  }

  /**
   * Signs a page in, by writing the session the client reads on start-up.
   *
   * Real Google OAuth cannot be automated, and going through it would be
   * testing Google. The session is the only thing the app takes from it.
   */
  async signIn(page: Page, user: StubUser): Promise<void> {
    const session = {
      access_token: `stub-access-${user.id}`,
      refresh_token: `stub-refresh-${user.id}`,
      token_type: 'bearer',
      // Far enough out that the client never tries to refresh mid-test.
      expires_in: 60 * 60 * 24 * 365,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
      user: {
        id: user.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: user.email,
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      },
    };

    await page.addInitScript(
      ([key, value]: [string, string]) => {
        window.localStorage.setItem(key, value);
      },
      [AUTH_STORAGE_KEY, JSON.stringify(session)] as [string, string],
    );
  }

  // --------------------------------------------------------------------------
  // Auth
  // --------------------------------------------------------------------------

  private async handleAuth(route: Route, path: string): Promise<void> {
    if (path === '/auth/v1/user') {
      const userId = this.callerId(route);
      await this.json(route, 200, {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email: `${userId}@example.test`,
      });
      return;
    }
    // A refresh should not happen with the expiry above; answer rather than hang.
    await this.json(route, 200, {});
  }

  /** Who is calling, read from the bearer token `signIn` minted. */
  private callerId(route: Route): string {
    const auth = route.request().headers()['authorization'] ?? '';
    const token = auth.replace(/^Bearer\s+/i, '');
    return token.startsWith('stub-access-')
      ? token.slice('stub-access-'.length)
      : 'anonymous';
  }

  // --------------------------------------------------------------------------
  // REST
  // --------------------------------------------------------------------------

  private async handleRest(route: Route, rest: string, url: URL): Promise<void> {
    const method = route.request().method();

    if (rest.startsWith('rpc/')) {
      await this.handleRpc(route, rest.slice('rpc/'.length));
      return;
    }

    switch (`${method} ${rest}`) {
      case 'POST trips':
        await this.insertTrip(route);
        return;
      case 'GET trips':
        await this.selectTrips(route, url);
        return;
      case 'PATCH trips':
        await this.updateTripPreview(route, url);
        return;
      case 'GET trip_members':
        await this.selectMembers(route, url);
        return;
      case 'PATCH trip_members':
        await this.claimIdentity(route, url);
        return;
      case 'POST trip_invites':
        await this.insertInvite(route);
        return;
      case 'GET trip_invites':
        await this.selectInvites(route, url);
        return;
      case 'POST trip_doc_updates':
        await this.insertUpdate(route);
        return;
      case 'GET trip_doc_updates':
        await this.selectUpdates(route, url);
        return;
      case 'GET trip_doc_snapshots':
        await this.selectSnapshot(route, url);
        return;
      default:
        await this.fail(route, 404, `stub has no handler for ${method} ${rest}`);
    }
  }

  private async insertTrip(route: Route): Promise<void> {
    this.counts.tripInserts += 1;
    const body = this.body<Record<string, string>>(route);
    const ownerId = body.owner_id;
    const localId = body.local_id;

    const existing = this.trips.find(
      (trip) => trip.owner_id === ownerId && trip.local_id === localId,
    );
    if (existing) {
      // The server's `unique (owner_id, local_id)`, which is what makes
      // `ensureRemoteTrip` idempotent across retries and reinstalls.
      await this.json(route, 409, {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      });
      return;
    }

    const row: TripRow = {
      id: uuid(this.nextTrip),
      local_id: localId ?? '',
      owner_id: ownerId ?? '',
      name: body.name ?? '',
      start_date: body.start_date ?? '',
      end_date: body.end_date ?? '',
    };
    this.nextTrip += 1;
    this.trips.push(row);
    // The owner's roster row, which the real schema creates by trigger.
    this.addMember(row.id, row.owner_id);

    await this.representation(route, [{ id: row.id }]);
  }

  private async selectTrips(route: Route, url: URL): Promise<void> {
    const caller = this.callerId(route);
    const id = operand(url.searchParams.get('id'));
    const ownerId = operand(url.searchParams.get('owner_id'));
    const localId = operand(url.searchParams.get('local_id'));

    let rows = this.trips;
    if (id !== null) {
      rows = rows.filter((trip) => trip.id === id);
    }
    if (ownerId !== null) {
      rows = rows.filter((trip) => trip.owner_id === ownerId);
    }
    if (localId !== null) {
      rows = rows.filter((trip) => trip.local_id === localId);
    }
    // Not RLS, but the same shape of answer: a caller only sees trips it is on,
    // so a test cannot pass by reading somebody else's trip.
    rows = rows.filter((trip) =>
      this.members.some((m) => m.trip_id === trip.id && m.user_id === caller),
    );

    await this.representation(route, rows.map((trip) => ({ ...trip })));
  }

  /**
   * The denormalised preview, updated the way the policy allows.
   *
   * `owners update their trips` narrows this to the caller's own rows, so a
   * member's attempt matches nothing — and, as in SQL, matching nothing is not
   * an error. Returning the affected rows rather than a blanket `[]` is what
   * lets the client tell the two apart; answering `[]` to everybody taught it
   * that a write it never made had succeeded.
   */
  private async updateTripPreview(route: Route, url: URL): Promise<void> {
    const caller = this.callerId(route);
    const id = operand(url.searchParams.get('id'));
    const body = this.body<Record<string, string>>(route);

    const row = this.trips.find(
      (trip) => trip.id === id && trip.owner_id === caller,
    );
    if (!row) {
      await this.representation(route, []);
      return;
    }

    row.name = body.name ?? row.name;
    row.start_date = body.start_date ?? row.start_date;
    row.end_date = body.end_date ?? row.end_date;
    await this.representation(route, [{ id: row.id }]);
  }

  private async selectMembers(route: Route, url: URL): Promise<void> {
    const tripId = operand(url.searchParams.get('trip_id'));
    const rows = this.members.filter((m) => tripId === null || m.trip_id === tripId);
    await this.representation(route, rows.map((m) => ({ ...m })));
  }

  private async claimIdentity(route: Route, url: URL): Promise<void> {
    const tripId = operand(url.searchParams.get('trip_id'));
    const userId = operand(url.searchParams.get('user_id'));
    const body = this.body<{ person_id?: string }>(route);
    const personId = body.person_id ?? null;

    if (
      personId !== null &&
      this.members.some(
        (m) => m.trip_id === tripId && m.person_id === personId && m.user_id !== userId,
      )
    ) {
      // `unique (trip_id, person_id)`: somebody already is this participant.
      await this.json(route, 409, {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      });
      return;
    }

    const row = this.members.find((m) => m.trip_id === tripId && m.user_id === userId);
    if (!row) {
      // No roster row, so nothing is updated — and, as in SQL, that is not an
      // error. The client has to notice the empty result.
      await this.representation(route, []);
      return;
    }

    row.person_id = personId;
    await this.representation(route, [{ person_id: row.person_id }]);
  }

  private async insertInvite(route: Route): Promise<void> {
    this.counts.inviteInserts += 1;
    const body = this.body<Record<string, unknown>>(route);
    const token = String(body.token ?? '');
    this.addInvite(String(body.trip_id ?? ''), String(body.created_by ?? ''), token, {
      expires_at: (body.expires_at as string | null) ?? null,
      max_uses: (body.max_uses as number | null) ?? null,
    });
    const row = this.invites.find((invite) => invite.token === token);
    await this.representation(route, row ? [this.publicInvite(row)] : []);
  }

  private async selectInvites(route: Route, url: URL): Promise<void> {
    const tripId = operand(url.searchParams.get('trip_id'));
    const rows = this.invites
      .filter((invite) => tripId === null || invite.trip_id === tripId)
      .map((invite) => this.publicInvite(invite));
    await this.representation(route, rows);
  }

  private publicInvite(invite: InviteRow) {
    return {
      token: invite.token,
      created_at: invite.created_at,
      expires_at: invite.expires_at,
      max_uses: invite.max_uses,
      uses: invite.uses,
      revoked_at: invite.revoked_at,
    };
  }

  private async insertUpdate(route: Route): Promise<void> {
    this.counts.updateInserts += 1;
    const body = this.body<Record<string, string>>(route);
    this.updates.push({
      id: this.nextUpdateId,
      trip_id: body.trip_id ?? '',
      update: body.update ?? '',
    });
    this.nextUpdateId += 1;
    await this.representation(route, []);
  }

  private async selectUpdates(route: Route, url: URL): Promise<void> {
    const tripId = operand(url.searchParams.get('trip_id'));
    const after = operand(url.searchParams.get('id'));
    const limit = Number(url.searchParams.get('limit') ?? '500');

    let rows = this.updates
      .filter((row) => tripId === null || row.trip_id === tripId)
      .sort((left, right) => left.id - right.id);

    // `gt.<id>` is the cursor. Absent for the floor query, which asks for the
    // oldest surviving row.
    if (after !== null && url.searchParams.get('id')?.startsWith('gt.')) {
      rows = rows.filter((row) => row.id > Number(after));
    }

    await this.representation(
      route,
      rows.slice(0, limit).map((row) => ({ id: row.id, update: row.update })),
    );
  }

  private async selectSnapshot(route: Route, url: URL): Promise<void> {
    const tripId = operand(url.searchParams.get('trip_id'));
    const row = this.snapshots.find((snapshot) => snapshot.trip_id === tripId);
    await this.representation(route, row ? [{ ...row }] : []);
  }

  // --------------------------------------------------------------------------
  // RPC
  // --------------------------------------------------------------------------

  private async handleRpc(route: Route, name: string): Promise<void> {
    const body = this.body<{ invite_token?: string }>(route);
    const token = body.invite_token ?? '';
    const caller = this.callerId(route);
    const invite = this.invites.find((row) => row.token === token);

    if (name === 'redeem_invite') {
      this.counts.redeems += 1;

      if (!invite) {
        await this.json(route, 400, {
          code: 'P0002',
          message: 'invite not found',
          hint: 'invite_not_found',
        });
        return;
      }
      if (invite.revoked_at !== null) {
        await this.json(route, 400, {
          code: 'P0001',
          message: 'invite revoked',
          hint: 'invite_revoked',
        });
        return;
      }
      if (invite.expires_at !== null && new Date(invite.expires_at) <= new Date()) {
        await this.json(route, 400, {
          code: 'P0001',
          message: 'invite expired',
          hint: 'invite_expired',
        });
        return;
      }

      // Idempotent for an existing member, before the cap is consulted — the
      // same order the real function uses, so reloading the join page neither
      // burns a seat nor fails.
      if (this.members.some((m) => m.trip_id === invite.trip_id && m.user_id === caller)) {
        await this.json(route, 200, invite.trip_id);
        return;
      }

      if (invite.max_uses !== null && invite.uses >= invite.max_uses) {
        await this.json(route, 400, {
          code: 'P0001',
          message: 'invite has no uses left',
          hint: 'invite_exhausted',
        });
        return;
      }

      invite.uses += 1;
      this.addMember(invite.trip_id, caller);
      await this.json(route, 200, invite.trip_id);
      return;
    }

    if (name === 'revoke_invite') {
      if (invite) {
        invite.revoked_at = new Date().toISOString();
      }
      await this.json(route, 204, null);
      return;
    }

    await this.fail(route, 404, `stub has no rpc ${name}`);
  }

  // --------------------------------------------------------------------------
  // Responses
  // --------------------------------------------------------------------------

  private body<T>(route: Route): T {
    const raw = route.request().postData();
    if (!raw) {
      return {} as T;
    }
    const parsed = JSON.parse(raw) as T | T[];
    // PostgREST accepts a bare object or an array; supabase-js sends either.
    return Array.isArray(parsed) ? ((parsed[0] ?? {}) as T) : parsed;
  }

  /**
   * Answers a query the way PostgREST does, honouring `.single()`.
   *
   * `.single()` and `.maybeSingle()` ask for an object rather than an array via
   * the Accept header, and `.single()` on an empty result is an error — a
   * distinction the app relies on, so the stub has to reproduce it.
   */
  private async representation(route: Route, rows: unknown[]): Promise<void> {
    const accept = route.request().headers()['accept'] ?? '';
    const wantsObject = accept.includes('application/vnd.pgrst.object+json');

    if (!wantsObject) {
      await this.json(route, 200, rows);
      return;
    }
    if (rows.length === 0) {
      await this.json(route, 406, {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
      });
      return;
    }
    await this.json(route, 200, rows[0]);
  }

  private async json(route: Route, status: number, body: unknown): Promise<void> {
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: body === null ? '' : JSON.stringify(body),
    });
  }

  private async fail(route: Route, status: number, message: string): Promise<void> {
    // Loud on purpose: a missing handler is a gap in the stub, and a test that
    // quietly passes around one is worse than a failing test.
    console.error(`[supabase-stub] ${message}`);
    await this.json(route, status, { message });
  }
}
