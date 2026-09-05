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
 *
 *   What it does do is *answer the way a server under those policies answers*,
 *   which is a different job. A stub that says yes to everything is not neutral
 *   about RLS — it actively teaches the client that writes it never made
 *   succeeded, and a client written against that lesson ships the bug. That is
 *   not hypothetical here: `PATCH trips` used to answer `200 []` to everybody,
 *   and every guest device silently stopped maintaining the trip preview for as
 *   long as the feature existed, with no test able to see it.
 *
 *   So the rule for this file is: **a missing error is not a success.** Where a
 *   policy or a constraint would make the server refuse, or match nothing, the
 *   stub refuses or matches nothing too — and it says so in the shape PostgREST
 *   uses, because the client branches on those shapes:
 *
 *   | outcome                      | status | code    |
 *   |------------------------------|--------|---------|
 *   | USING excludes the row       | 200    | (`[]`)  |
 *   | WITH CHECK rejects the row   | 403    | `42501` |
 *   | a check constraint fails     | 400    | `23514` |
 *   | a unique constraint fails    | 409    | `23505` |
 *
 *   The first row is the dangerous one, and the reason the other three are here:
 *   an UPDATE or a SELECT narrowed to nothing is *not* an error in SQL, so the
 *   only thing that distinguishes it from success is the rows that come back.
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
const AUTH_STORAGE_KEY = 'kikouchou-auth';

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

/**
 * `public.guest_groups`. Per account, never per trip — there is no membership
 * to consult here, which is why every handler below narrows on `owner_id`
 * alone.
 */
interface GuestGroupRow {
  id: string;
  local_id: string;
  owner_id: string;
  name: string;
  members: unknown;
  updated_at: string;
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

/**
 * `trip_doc_updates.update`'s two check constraints.
 *
 * `octet_length` counts bytes of the *text*, and the column is base64, so the
 * string's own length is the number the server measures.
 */
const UPDATE_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const UPDATE_MAX_OCTETS = 1_048_576;

/** `trips.name`: `check (length(name) between 1 and 200)`. */
const TRIP_NAME_MAX_LENGTH = 200;

/** `trips.local_id`: `check (length(local_id) between 1 and 64)`. */
const LOCAL_ID_MAX_LENGTH = 64;

// ============================================================================
// The stub
// ============================================================================

export class SupabaseStub {
  trips: TripRow[] = [];
  members: MemberRow[] = [];
  invites: InviteRow[] = [];
  updates: UpdateRow[] = [];
  snapshots: SnapshotRow[] = [];
  guestGroups: GuestGroupRow[] = [];

  /** Requests refused, so a test can simulate an outage without going offline. */
  offline = false;

  /**
   * Counts, for asserting a flow does not repeat work it has already done.
   *
   * `updateAttempts` and `updateInserts` are deliberately two numbers, not one.
   * A counter that only moves when a write *lands* cannot tell "the client
   * queued the edit and is holding it" from "the client never tried" — and
   * while {@link offline} is set the second is unfalsifiable, because the route
   * is aborted before any handler runs. `updateAttempts` is incremented on the
   * way in, before the outage is applied, so a test can assert what the client
   * offered as well as what the server took.
   */
  counts = {
    tripInserts: 0,
    inviteInserts: 0,
    /** Log writes the client sent, landed or not. */
    updateAttempts: 0,
    /** Log writes the server accepted. */
    updateInserts: 0,
    redeems: 0,
  };

  private nextTrip = 1;
  private nextUpdateId = 1;
  private nextGuestGroup = 1000;

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

  /**
   * Removes a trip the way deleting it really does — cascade included.
   *
   * Every child table references `trips (id) on delete cascade`, and the roster
   * going with it is the whole reason the deleted-row case is confusing in
   * production: the account is no longer a member, so its next log write is
   * refused by `members append to the trip log` with a permissions error, from a
   * dialog that has nothing to do with permissions. Dropping only `trips` here
   * would model a state the database cannot be in, and would hide exactly that.
   */
  deleteTrip(tripId: string): void {
    this.trips = this.trips.filter((trip) => trip.id !== tripId);
    this.members = this.members.filter((member) => member.trip_id !== tripId);
    this.invites = this.invites.filter((invite) => invite.trip_id !== tripId);
    this.updates = this.updates.filter((row) => row.trip_id !== tripId);
    this.snapshots = this.snapshots.filter((row) => row.trip_id !== tripId);
  }

  /**
   * `public.is_trip_member(trip_id)`, which every select policy here is built on.
   *
   * Not RLS — see the module note — but the same answer, so a caller cannot read
   * or write a trip it is not on and have a test pass on the strength of it.
   */
  private isMember(tripId: string | null, userId: string): boolean {
    return this.members.some(
      (member) => member.trip_id === tripId && member.user_id === userId,
    );
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
      const url = new URL(route.request().url());
      const path = url.pathname;

      // Counted before the outage, so "the client is still offering the edit"
      // stays observable while nothing can possibly land. See `counts`.
      if (path === '/rest/v1/trip_doc_updates' && route.request().method() === 'POST') {
        this.counts.updateAttempts += 1;
      }

      if (this.offline) {
        await route.abort('connectionfailed');
        return;
      }

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
    if (path === '/auth/v1/settings') {
      // The sign-in surfaces build themselves from this, so the stub has to
      // answer it the way a project does: `external` mixes OAuth ids with
      // `email`, and carries no web3 key whatever the project has enabled.
      await this.json(route, 200, {
        external: { google: true, spotify: true, email: true, phone: false },
        disable_signup: false,
        mailer_autoconfirm: false,
        // Deliberately off here even though the real project has them on:
        // Playwright's Chromium *does* implement WebAuthn, so a `true` would put
        // a passkey button on every sign-in surface these specs walk through,
        // and it could not be clicked without a virtual authenticator.
        passkeys_enabled: false,
      });
      return;
    }
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
      case 'GET guest_groups':
        await this.selectGuestGroups(route, url);
        return;
      case 'POST guest_groups':
        await this.upsertGuestGroups(route);
        return;
      default:
        await this.fail(route, 404, `stub has no handler for ${method} ${rest}`);
    }
  }

  private async insertTrip(route: Route): Promise<void> {
    this.counts.tripInserts += 1;
    const caller = this.callerId(route);
    const body = this.body<Record<string, string>>(route);
    const ownerId = body.owner_id;
    const localId = body.local_id;

    // `users create their own trips`: with check (owner_id = auth.uid()). A
    // client cannot create a trip owned by somebody else, and a WITH CHECK
    // failure is a privilege error rather than an empty result.
    if (ownerId !== caller) {
      await this.rlsViolation(route, 'trips');
      return;
    }
    if (!(await this.tripConstraintsHold(route, body))) {
      return;
    }

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
   * `owners update their trips` is `using (owner_id = auth.uid()) with check
   * (owner_id = auth.uid())`, and the two halves fail differently — which is the
   * whole point of modelling them separately:
   *
   * - **USING** decides which rows the UPDATE can even see. A member's attempt
   *   therefore matches nothing, and matching nothing is *not* an error in SQL:
   *   it succeeds, changes no rows, and reports nothing. Returning the affected
   *   rows rather than a blanket `[]` is the only thing that lets the client tell
   *   that apart from having worked. Answering `[]` to everybody is what taught
   *   it that a write it never made had succeeded, and left every guest device
   *   silently failing to maintain the preview.
   * - **WITH CHECK** decides what the row may become, and rejecting it *is* an
   *   error: 42501, which PostgREST reports as 403. It is what stops ownership
   *   being handed away by an UPDATE that rewrites `owner_id`.
   */
  private async updateTripPreview(route: Route, url: URL): Promise<void> {
    const caller = this.callerId(route);
    const id = operand(url.searchParams.get('id'));
    const body = this.body<Record<string, string>>(route);

    // USING. `?id=eq.<uuid>` is honoured as a filter rather than ignored, so a
    // client that forgot to narrow its UPDATE rewrites every row it owns here
    // too, instead of the stub quietly doing the right thing for it.
    const row = this.trips.find(
      (trip) => trip.id === id && trip.owner_id === caller,
    );
    if (!row) {
      await this.representation(route, []);
      return;
    }

    // WITH CHECK, evaluated against the row as it would become.
    if (body.owner_id !== undefined && body.owner_id !== caller) {
      await this.rlsViolation(route, 'trips');
      return;
    }
    if (
      !(await this.tripConstraintsHold(route, {
        name: body.name ?? row.name,
        start_date: body.start_date ?? row.start_date,
        end_date: body.end_date ?? row.end_date,
        local_id: row.local_id,
      }))
    ) {
      return;
    }

    row.name = body.name ?? row.name;
    row.start_date = body.start_date ?? row.start_date;
    row.end_date = body.end_date ?? row.end_date;
    await this.representation(route, [{ id: row.id }]);
  }

  /**
   * The roster, as `members read the roster` admits it.
   *
   * The caller filter is not decoration: without it the stub hands any signed-in
   * account the roster of any trip whose id it can name, so a client that read a
   * roster it has no business reading — or read one for the wrong trip — would
   * be answered rather than refused, and the test would pass.
   */
  private async selectMembers(route: Route, url: URL): Promise<void> {
    const caller = this.callerId(route);
    const tripId = operand(url.searchParams.get('trip_id'));
    const rows = this.members.filter(
      (m) => (tripId === null || m.trip_id === tripId) && this.isMember(m.trip_id, caller),
    );
    await this.representation(route, rows.map((m) => ({ ...m })));
  }

  /**
   * Claiming an identity, as `members claim their own identity` allows it.
   *
   * `using (user_id = auth.uid())` is the load-bearing half, and the caller is
   * the *token*, never the `?user_id=eq.…` the client happened to send. Reading
   * the subject out of the query string instead let one device claim a
   * participant as another account — the one thing this policy exists to stop —
   * and no test could see it, because the stub obligingly did as it was asked.
   */
  private async claimIdentity(route: Route, url: URL): Promise<void> {
    const caller = this.callerId(route);
    const tripId = operand(url.searchParams.get('trip_id'));
    const userId = operand(url.searchParams.get('user_id'));
    const body = this.body<{ person_id?: string; user_id?: string }>(route);
    const personId = body.person_id ?? null;

    if (userId !== caller) {
      // USING excludes every row but the caller's own, so this matches nothing.
      // Not an error, which is exactly why the client must check the rows back.
      await this.representation(route, []);
      return;
    }
    // WITH CHECK: the row may not be handed to another account by the update.
    if (body.user_id !== undefined && body.user_id !== caller) {
      await this.rlsViolation(route, 'trip_members');
      return;
    }
    // `check (person_id is null or length(person_id) between 1 and 64)`.
    if (personId !== null && (personId.length < 1 || personId.length > 64)) {
      await this.checkViolation(route, 'trip_members', 'trip_members_person_id_check');
      return;
    }

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
    const caller = this.callerId(route);
    const tripId = operand(url.searchParams.get('trip_id'));
    const rows = this.invites
      // `members read invites for their trips`. A non-member reads nothing,
      // which is what stops tokens being enumerated.
      .filter((invite) => this.isMember(invite.trip_id, caller))
      .filter((invite) => tripId === null || invite.trip_id === tripId)
      .map((invite) => this.publicInvite(invite));
    await this.representation(route, rows);
  }

  // --------------------------------------------------------------------------
  // Guest groups
  // --------------------------------------------------------------------------

  /**
   * `owners read their guest groups`.
   *
   * Narrowed on the caller rather than on the `owner_id` the query asks for: a
   * client passing somebody else's id must read nothing, and a stub that
   * honoured the parameter would let a broken client look correct here and fail
   * against the real policy.
   */
  private async selectGuestGroups(route: Route, url: URL): Promise<void> {
    const caller = this.callerId(route);
    const ownerId = operand(url.searchParams.get('owner_id'));

    const rows = this.guestGroups.filter(
      (group) =>
        group.owner_id === caller && (ownerId === null || ownerId === caller),
    );

    await this.representation(route, rows);
  }

  /**
   * `on conflict (owner_id, local_id) do update`, as the client sends it.
   *
   * PostgREST expresses an upsert as a POST carrying `Prefer: resolution=…`, so
   * this handler covers both halves. `owner_id` is pinned to the caller, which
   * is the `with check (owner_id = auth.uid())` half of the policy — the one
   * that stops a client writing a group into somebody else's account.
   */
  private async upsertGuestGroups(route: Route): Promise<void> {
    const caller = this.callerId(route);

    // Read the payload directly rather than through `body()`: this is the one
    // write that legitimately sends *many* rows, and `body()` collapses an array
    // to its first element — which would silently upload one group of however
    // many the account holds.
    const raw = route.request().postData();
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const rows = Array.isArray(parsed) ? parsed : [parsed];

    const written: GuestGroupRow[] = [];

    for (const entry of rows) {
      const row = entry as Record<string, unknown>;
      const localId = String(row.local_id ?? '');
      const ownerId = String(row.owner_id ?? '');

      if (ownerId !== caller) {
        await this.rlsViolation(route, 'guest_groups');
        return;
      }

      const existing = this.guestGroups.find(
        (group) => group.owner_id === caller && group.local_id === localId,
      );

      if (existing) {
        existing.name = String(row.name ?? existing.name);
        existing.members = row.members ?? existing.members;
        existing.updated_at = String(row.updated_at ?? existing.updated_at);
        written.push(existing);
        continue;
      }

      const fresh: GuestGroupRow = {
        id: uuid(this.nextGuestGroup++),
        local_id: localId,
        owner_id: caller,
        name: String(row.name ?? ''),
        members: row.members ?? [],
        updated_at: String(row.updated_at ?? new Date().toISOString()),
      };
      this.guestGroups.push(fresh);
      written.push(fresh);
    }

    await this.representation(route, written);
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

  /**
   * Appending to the log, as the server would accept it.
   *
   * Three separate gates, all of which the stub used to skip — it counted the
   * row, stored it and answered 200 whatever arrived:
   *
   * 1. `members append to the trip log` — `with check (is_trip_member(trip_id)
   *    and author_id = auth.uid())`. This is the one that bites in production:
   *    delete a trip and its roster cascades away, so the next log write comes
   *    back `new row violates row-level security policy for table
   *    "trip_doc_updates"` from a share dialog, which reads as a permissions bug
   *    rather than a missing trip. A stub that accepts the write instead cannot
   *    tell a client that recovers from one that writes into the void forever.
   * 2. `check ("update" ~ '^[A-Za-z0-9+/]+={0,2}$')` — standard base64 only. A
   *    switch to the URL-safe alphabet is a plausible, silent regression that
   *    breaks every write; it has to fail here, not go green.
   * 3. `check (octet_length("update") between 1 and 1048576)`. `octet_length` is
   *    over the *text*, and the text is base64, so the string's own length is
   *    what the server measures.
   *
   * Deliberately **not** modelled: rejecting a duplicate or an out-of-order
   * update. `trip_doc_updates.id` is `generated always as identity` and nothing
   * constrains the payload, so the real server accepts both without complaint —
   * a stub that refused them would be inventing a rule the client would then be
   * written against. Yjs deduplicates on the *read* side, where a redelivered
   * update is a no-op, and that is asserted in `SupabaseYjsProvider.test.ts`.
   */
  private async insertUpdate(route: Route): Promise<void> {
    const caller = this.callerId(route);
    const body = this.body<Record<string, string>>(route);
    const tripId = body.trip_id ?? '';
    // `author_id` defaults to auth.uid() when the client omits it, as it does.
    const authorId = body.author_id ?? caller;
    const update = body.update ?? '';

    if (!this.isMember(tripId, caller) || authorId !== caller) {
      await this.rlsViolation(route, 'trip_doc_updates');
      return;
    }
    if (!UPDATE_BASE64_PATTERN.test(update)) {
      await this.checkViolation(
        route,
        'trip_doc_updates',
        'trip_doc_updates_update_check',
      );
      return;
    }
    if (update.length > UPDATE_MAX_OCTETS) {
      await this.checkViolation(
        route,
        'trip_doc_updates',
        'trip_doc_updates_update_check1',
      );
      return;
    }

    this.counts.updateInserts += 1;
    this.updates.push({
      id: this.nextUpdateId,
      trip_id: tripId,
      update,
    });
    this.nextUpdateId += 1;
    await this.representation(route, []);
  }

  private async selectUpdates(route: Route, url: URL): Promise<void> {
    const caller = this.callerId(route);
    const tripId = operand(url.searchParams.get('trip_id'));
    const after = operand(url.searchParams.get('id'));
    const limit = Number(url.searchParams.get('limit') ?? '500');

    let rows = this.updates
      // `members read the trip log`.
      .filter((row) => this.isMember(row.trip_id, caller))
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
    const caller = this.callerId(route);
    const tripId = operand(url.searchParams.get('trip_id'));
    // `members read the trip snapshot`.
    const row = this.snapshots.find(
      (snapshot) => snapshot.trip_id === tripId && this.isMember(snapshot.trip_id, caller),
    );
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

  /**
   * A WITH CHECK failure: `42501`, which PostgREST reports as 403.
   *
   * Distinct from an empty result on purpose. A USING clause that excludes a row
   * is silent; a WITH CHECK that rejects one is loud, and the client branches on
   * the difference — see `ensureRemoteTrip`, whose whole reason for verifying a
   * cached `remoteTripId` is that this error arrived where a missing trip was
   * meant.
   */
  private async rlsViolation(route: Route, table: string): Promise<void> {
    await this.json(route, 403, {
      code: '42501',
      message: `new row violates row-level security policy for table "${table}"`,
    });
  }

  /** A check-constraint failure: `23514`, which PostgREST reports as 400. */
  private async checkViolation(
    route: Route,
    table: string,
    constraint: string,
  ): Promise<void> {
    await this.json(route, 400, {
      code: '23514',
      message: `new row for relation "${table}" violates check constraint "${constraint}"`,
      details: null,
    });
  }

  /**
   * The `trips` table's own constraints, which RLS never sees.
   *
   * `length(name) between 1 and 200` is the one that matters to the client:
   * `previewName` exists solely to satisfy it, because a name adopted from a
   * peer's document never passes through the trip form's own 100-character cap
   * and an over-long one failed both the preview update and the share outright.
   *
   * @returns `false` when a response has already been sent.
   */
  private async tripConstraintsHold(
    route: Route,
    row: Partial<Record<'name' | 'start_date' | 'end_date' | 'local_id', string>>,
  ): Promise<boolean> {
    const name = row.name ?? '';
    if (name.length < 1 || name.length > TRIP_NAME_MAX_LENGTH) {
      await this.checkViolation(route, 'trips', 'trips_name_check');
      return false;
    }
    const localId = row.local_id ?? '';
    if (localId.length < 1 || localId.length > LOCAL_ID_MAX_LENGTH) {
      await this.checkViolation(route, 'trips', 'trips_local_id_check');
      return false;
    }
    // `constraint trips_dates_ordered check (end_date >= start_date)`. String
    // comparison is correct for ISO dates and is what `date` ordering means.
    if ((row.end_date ?? '') < (row.start_date ?? '')) {
      await this.checkViolation(route, 'trips', 'trips_dates_ordered');
      return false;
    }
    return true;
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
