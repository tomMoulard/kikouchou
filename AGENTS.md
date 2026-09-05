# Kikouchou — Agent Coding Guidelines

**Stack:** React 19 + TypeScript (strict) · Vite · Bun · Tailwind CSS v4 · shadcn/ui · Dexie.js (IndexedDB) · React Router v7 · i18next · Vitest + Playwright

---

## Commands

```bash
# Dev
bun run dev                   # Start dev server
bun run build                 # tsc -b && vite build

# Quality
bun run lint                  # ESLint
bun run validate              # generate-proto + test:run + lint + build + generate-icons + test:e2e:run
                              # (generate-proto runs first and needs `buf` installed)

# Unit tests (Vitest)
bun run test                  # Single run (alias of test:run — NOT watch mode)
bun run test:run              # Single run (what `validate` uses)
bun run test:ui               # Watch mode with the Vitest UI
bun run test:coverage         # Coverage + thresholds — this is what CI runs, and it FAILS
                              # the job below them. ~4x slower than test:run, which is why
                              # `validate` still uses test:run; run this before pushing a
                              # change that removes tests or adds untested branches.
bun run test src/features/trips/components/__tests__/TripForm.test.tsx  # Single file
bun run test -t "TripForm"    # Pattern match (vitest has no --grep)

# E2E tests (Playwright)
bun run test:e2e              # Headless, on Playwright's pinned Chromium (as CI)
bun run test:e2e:chrome       # Same, on the machine's installed Chrome (see below)
bun run test:e2e:headed       # With browser
bun run test:e2e:install      # Fetch Playwright's own Chromium
npx playwright test --project=sync                   # Sharing/join/two-device flows
npx playwright test --project=production             # Offline + PWA (production build)
npx playwright test e2e/trip-lifecycle.spec.ts       # Single file
npx playwright test -g "user can create a new trip"  # Single test

# Supabase (local stack: Docker required)
bunx supabase start           # Postgres + auth + realtime + studio on :54321-54323
bunx supabase stop            # Ten containers; stop them when you are done
bunx supabase test db         # pgTAP — RLS and the SQL functions
bunx supabase db reset        # Reapply every migration to a clean database
bunx supabase db push         # Apply pending migrations to the LINKED project
bun run db:types              # Regenerate src/lib/supabase/database.types.ts

# Type check
tsc -b                        # The ONLY form that checks anything (see below)
```

> **`PW_CHANNEL=chrome` drives the machine's installed Chrome** instead of
> Playwright's own build. Unset is the default, and what `bun run test:e2e` and
> CI now use, so the browser version moves with the dependency and a Chrome
> auto-update cannot change a result. Reach for `test:e2e:chrome` when
> `playwright install` has not run locally — the scripts used to force it, which
> meant CI downloaded a Chromium it then ignored.

> **`tsc --noEmit` type-checks ZERO files in this repo.** The root
> `tsconfig.json` is a solution file (`"files": []` + `references`), and project
> references are honoured only in `--build` mode, so the bare form silently
> exits 0 no matter how broken the code is. Always use `tsc -b`, or
> `tsc --noEmit -p tsconfig.app.json` to check one project. CI uses `tsc -b`.


---

## TypeScript — Strict Flags

All are enabled in `tsconfig.app.json`. Key non-obvious ones:
- `noUncheckedIndexedAccess` — array/object access returns `T | undefined`; always guard or use `!`
- `verbatimModuleSyntax` — type-only imports **must** use `import type` or `import { type X }`
- `erasableSyntaxOnly` — **no enums or namespaces**; use `const` objects + union types instead
- `noUncheckedSideEffectImports` — no bare side-effect imports without explicit intent

---

## Import Order

Blank line between each group; `import type` / `import { type X }` for type-only imports.

1. `react`, `react-dom`
2. Third-party libs (`react-router-dom`, `react-i18next`, `sonner`, `dexie-react-hooks`, …)
3. `@/components/ui/*`
4. `@/components/shared/*`
5. `@/features/*`
6. `@/hooks/*`
7. `@/contexts/*`
8. `@/lib/*`
9. `@/types` (type imports last)

Path alias `@/` maps to `src/`.

---

## Component Rules

- **Named exports** everywhere; page components also export `default` for `React.lazy`.
- **`memo(function Name(props){})`** — named function inside `memo` for automatic `displayName`.
- Props interfaces: `interface FooProps { readonly bar: string; }` — `readonly` on all props.
- Section comments: `// ===…=== // Type Definitions`, `// Constants`, `// Component`, `// Exports`.
- File docblock: `/** @fileoverview … @module path/to/module */`
- **No default exports** except pages.
- **Barrel exports** via `features/{name}/index.ts`.

---

## State & Data

- **React Context** for global state (`TripContext`, `SettingsContext`); always throw when used outside provider.
- **`useLiveQuery`** (dexie-react-hooks) for reactive IndexedDB reads — returns `undefined` while loading.
- **`useCallback`** for all event handlers passed to children; **`useMemo`** for derived values.
- Functional state updates when new state derives from old: `setState(prev => !prev)`.

---

## AI Assistant — Keep It In Sync

The on-device LLM assistant (`src/features/assistant/`) knows **only** what the
system prompt hands it. A feature that is missing from that prompt makes the
assistant answer *"I don't have access to that"* even though the data sits right
there in IndexedDB — storing it in Dexie is not enough.

**Adding or changing a trip feature, entity or field? Update the assistant in the
same change, in this order:**

1. **`hooks/useTripSystemPrompt.ts` — read access.**
   Add a `## Section` for a new entity, or the new field to the existing line.
   Anything the user can see in the UI belongs here. Lead each item with its
   `id:` (actions need it), then the human-readable values. Never drop a section
   when it is empty — print `No … yet.` so the model knows the list is empty
   rather than unavailable.
2. **`action-schema.ts` — write access.**
   Add one `ActionDef` per mutation (`addX` / `updateX` / `removeX`, plus
   narrower verbs like `joinActivity` when they map to a real repository call).
   This array is the single source of truth: `generateActionPrompt()` documents
   it to the LLM and `validateAction()` enforces it at runtime — never hand-write
   prompt text for an action, and never accept an action the schema does not list.
3. **`hooks/useTripActions.ts` — execution.**
   Add a `case` per action: bail with `t('assistant.noTripForAction')` when there
   is no active trip, go through the `…WithOwnershipCheck` repositories, drop ids
   that do not belong to the trip, `safeParse` the record against its Zod schema
   before writing, then push a `summaries` line for the UI.
4. **`src/locales/{en,fr}/translation.json`.**
   Add the `assistant.actionDetails.*` summary and any new error key to **both**
   locales.
5. **Tests.** Extend `src/features/assistant/__tests__/action-schema.test.ts`
   and `src/features/assistant/hooks/__tests__/{useTripSystemPrompt,useTripActions}.test.tsx`.

Relative dates ("today", "tonight", "this weekend") resolve against the current
date, which the prompt states from `useToday()` — extend that line rather than
letting the model guess.

**Say it once, and say it short.** The prompt is not free text: the model runs on
the user's own GPU, and prefill memory grows with prompt length. `gemma-3-1b`'s
ONNX export has no `num_logits_to_keep` input, so it computes logits for *every*
prompt position and reads back `prompt_tokens × 262144` values in one buffer —
half a mebibyte per prompt token. A 2401-token prompt asked WebGPU for 2.34 GiB
and got "Failed to allocate memory for buffer mapping", which kills the session,
not just the answer. Two guards keep that honest, and both are meant to be
rewritten to fit rather than raised:

- `action-schema.test.ts` caps the generated action prompt (~1000 tokens).
- `useTripSystemPrompt.test.tsx` caps the trip-independent floor.

So: never state a rule in `useTripSystemPrompt.ts` that `action-schema.ts`
already states, keep `label` to a phrase, and let the example show the required
fields only — the `optional:` line documents the rest.

Done check: *could the assistant both answer a question about this feature and
change it, from the prompt alone?* If not, the feature is not finished.

---

## Invariants — Learned The Hard Way

Each rule below exists because its absence shipped a real bug. They are cheap to
follow and expensive to rediscover.

### Dates: pick the converter to match the Date you were handed

`src/lib/db/utils.ts` exports two converters and they are **not**
interchangeable:

| Converter | Reads | Use for |
|---|---|---|
| `toISODateString` | **UTC** components | a `Date` that was *built* in UTC — i.e. anything from `buildTripDayColumns` / `trip-days.ts` |
| `toLocalISODateString` | **local** components | a `Date` that represents a day the user picked or sees — `DateRangePicker` / react-day-picker output, `eachDayOfInterval`, `new Date()`, `useToday()` |

Passing a local-midnight `Date` to `toISODateString` yields **the previous day**
at any positive UTC offset (Paris, Tokyo). That is not a display glitch: it
silently persisted every room assignment one day early. Symmetrically, a
UTC-built `Date` formatted with date-fns `format()` prints the wrong day at
negative offsets.

- Store and compare calendar days as `ISODateString`; derive them once, at the
  boundary, and pass the string around rather than re-deriving from a `Date`.
- A key and the lookup that reads it must use the **same** converter. If you
  find yourself computing both `dateKey` and `localDateKey` for one cell, say in
  a comment which consumers use which and why.
- Tests must not encode the machine's offset. Mixing a `Z`-suffixed fixture with
  an offset-less one makes a test pass or fail by timezone; CI runs at UTC,
  where every bug in this family disappears.

### Untrusted input: remote data is not app data

Three surfaces write to IndexedDB — UI forms, server sync (`lib/sync` applying
into `lib/yjs`), and QR changeset import (`lib/sharing`). Only the first has a
user in the loop. WebRTC peers are gone; the server is the only peer now, and it
carries other members' writes, so it is exactly as untrusted as a peer was.

- **Never use a remote-supplied id as a write key.** The caller resolves the
  target trip locally and that id is the only write key. `meta.id` used to be
  compared against it as a check, which was itself a bug — local trip ids are
  per-device nanoids, so a joined trip's document can never match, and every
  remote update for it was refused. The constraint that check was incidentally
  providing is now explicit: a projection updates a trip that already exists and
  never creates one.
- **Never adopt a remote value for a unique index** (`shareId`): a collision
  aborts the whole transaction and permanently kills sync.
- **Never read `window.location` inside `lib/`.** Pass URL-derived values in as
  parameters. Reading the hash meant the a11y skip link `#main-content`
  overwrote a trip's encryption key.
- Validate and **bound** every remote field — string length, numeric range, enum
  membership, date format and ordering. An unbounded `capacity` reached
  `Array.from({length: capacity})` and OOM'd the tab permanently.
- Drop an invalid record individually; never let one bad item abort a
  transaction that carries the rest.

### A deletion is never inferred from a mirror that might be incomplete

Dexie is a *mirror* of the document, and pruning the document to match it is only
valid when that mirror is complete. It often is not: an invitee's document fills
from the log while their Dexie stays empty because the projection was refused,
has not run yet, or their local data was cleared.

The prune is a CRDT tombstone. It pushes to the log, every member applies it, and
nothing brings the entry back — so an invitee's empty mirror could delete the
owner's rooms and guests for everybody, permanently.

- `replaceDocCollection` takes a **required** `allowDeletions`. No default: the
  safe answer is not obvious at a call site, and the unsafe one destroys other
  people's data.
- Pass `true` only when the caller can assert the set is complete. The observer
  asks `isDexieTrustedMirror(doc, tripId)`, which is true only once
  `syncDocToDexie` has actually projected that document into Dexie — tracked on a
  `WeakMap` keyed by the document, so a fresh document earns the right again
  rather than inheriting it.
- `populateDocFromDexie` **seeds and never prunes**. It runs on mount with
  whatever Dexie holds, which on a freshly joined device is nothing.
- The CRDT layer is not the hazard. Yjs updates are additive, so a document that
  merely *lacks* an entry deletes nothing when it merges. Only an inferred
  deletion does damage.

### Unmount guards are set on setup, not only in cleanup

```ts
useEffect(() => {
  isMountedRef.current = true;      // ← required
  return () => { isMountedRef.current = false; };
}, []);
```

`useEffect(() => () => { ref.current = false; }, [])` is a **bug**. StrictMode's
dev-time mount → cleanup → mount cycle latches it `false` forever, turning every
guarded `setState` into a silent no-op — dialogs that never close, prompts that
never appear. Ten files had this.

### Count people, not rows

`Person.headcount` means one guest row can stand for a couple or a family. Any
capacity, occupancy or "how many guests" figure must sum
`getPersonHeadcount(person)`. Helpers that need it take a **required**
`HeadcountResolver` (see `features/rooms/utils/capacity-utils.ts`) — an optional
one defaulting to 1 is how a new call site silently regresses.

### Context comparators must list every mutable field

Each `*Context` decides whether to publish a new array by comparing entities
field by field. A field missing from `compareX` means edits to it **never reach
the UI**. When you add a field to an entity, add it to its comparator; deep-
compare nested objects such as `coordinates`.

### A new table joins the cascade and the test reset

Adding a **trip-scoped** Dexie table means:
1. add it to `deleteTrip`'s transaction **and** its delete list, or its rows
   outlive the trip forever;
2. nothing to do in `src/test/setup.ts` — it derives the list from `db.tables`.
   Keep it that way; the hand-maintained array missed two tables.

Also give every trip-scoped table a plain `tripId` index, not only a compound
one. A row missing the compound's second component is invisible to every trip
query, including the cascade.

`guestGroups` is the one table this does **not** apply to, and the exception is
the feature rather than an oversight: a guest group belongs to the account, so
deleting a trip must not delete the group its guests were imported from. It
therefore carries no `tripId` index and takes no part in the cascade. Before
adding a table to `deleteTrip`, decide which of the two it is — a table that
should have been in the cascade leaks rows forever, and one that should not have
been silently destroys data the user expected to keep.

### A global entity syncs per account, not through the trip document

The Yjs document is per trip, so nothing that outlives a trip can travel in it.
`lib/sync/guest-groups.ts` is the other shape: a plain server table, upserted on
`(owner_id, local_id)`, reconciled last-write-wins on a client-authored
`updated_at`. Two rules make it safe, and both are load-bearing rather than
defensive:

- **A pull prunes only a row this device uploaded.** A local group with no
  `remoteGroupId` is not evidence that anything was deleted — the server has
  never been told about it — so an empty server answer deletes nothing. Same
  reasoning as `replaceDocCollection`'s `allowDeletions`, one table further out.
- **Rows coming back are remote input.** They arrive from Postgres but were
  *written* by another device, so every field is bounded on the way in and an
  invalid member is dropped on its own rather than taking its group with it.

### Reuse the helper; do not fork it

Before writing a date formatter, a lane packer, a locale lookup or a storage-key
reader, grep for it. `getDateLocale` reached **12** copies, `withSuspense` 9,
guest-identity parsing 6. A fix in one copy never reaches the others.

### Routing: a parent with its own `element` must render `<Outlet />`

Child routes of a parent that supplies `element` never mount unless that element
renders an `Outlet`. This silently disabled the entire guest onboarding wizard —
and its own tests passed, because each step was mounted on a *flat* route.
Test nested routes through the real parent.

### i18n: a key that does not exist still renders

`t('a.missing.key', 'Fallback')` shows the English fallback in every locale, and
neither `tsc`, ESLint, nor the tests catch it — the test harness mocks i18next to
echo keys back. When you add a `t()` call, add the key to **both**
`en` and `fr`. Screen-reader-only text is user-facing text.

### A third-party z-index only stays put inside a stacking context

Leaflet numbers its own layers 200 to 1000 and gives `.leaflet-container`
nothing that makes it a stacking context, so those numbers were resolved against
the page root — where the app's scale tops out at 50. Every map therefore
painted over every dialog: opening the share dialog on `/trips` left the trip
cards' map previews on top of it. The fix is `isolation: isolate` on the
container (`src/index.css`), not renumbering anything. Any vendor CSS that ships
its own z-index scale needs the same containment, and `z-50` in the app is not
a number to raise in answer.

### A fixed overlay eats every tap underneath it

Three separate bugs, all the same shape. `OfflineIndicator` is `inset-x-0` and
paints only a centred pill, so it swallowed clicks along a full-width strip and
"New trip" could not be clicked at all while offline — fixed with
`pointer-events-none`, which is right for anything purely informational. Toasts
are not: a toast has a close button, so it has to be *positioned* clear
instead. At `bottom-center` with no offset it covered the mobile navigation bar
and ate every tap on Calendar, Rooms, Guests and Transport; offset to 80px it
covered the FAB.

A phone screen has three things anchored to its bottom edge — the nav bar
(`h-16`), the FAB (`bottom-20 size-14`, so 80px to 136px) and toasts. Anything
new down there has to clear all of them, and the check is a hit test at the
element's own centre rather than a look at the screenshot.

### Quality gates must actually run

A gate that silently passes is worse than no gate. Two did:
`tsc --noEmit` (checks nothing — see Commands) and the Playwright suite, whose
webServer inherited CI's `GITHUB_ACTIONS=true` and so served the app under a
different `base` than every `page.goto('/…')` assumed, 404-ing all 108 of them.
If you touch `vite.config.ts`'s `base`, `playwright.config.ts`'s `webServer`, or
a `validate`/CI script, prove the gate still fails on a deliberate error.

The E2E job was the third: `timeout-minutes: 30` killed it on every run since
the workflow was written, so the suite had never finished in CI and the
`production` and `sync` projects had never run there at all. A job that always
dies at its limit reads as a failure and hides whatever the tests were saying.

The coverage thresholds were the fourth, and the cheapest to miss: they were
declared in `vitest.config.ts`, argued for in a comment, and passed to nothing.
`test:run` is a bare `vitest run`, and `test:coverage` was invoked by no script
and no workflow, so no run had ever compared the declared numbers to the real
ones. When one finally did, branches was at 75.35% against a declared 79% — the
gate had been failing all along, invisibly. The tell was sitting in the log the
whole time: the next CI step uploads `coverage/`, a directory `test:run` never
writes, so every run warned "No files were found with the provided path" and
shipped an empty artifact. **An artifact-upload warning is evidence that the
step before it did not do what its name says.**

#### `page.waitForFunction` does not await an async predicate

A pending Promise is truthy, so `waitForFunction(async () => …)` returns on its
first poll having asserted nothing — measured at 17 ms for a predicate that
resolves `false` forever. Three waits here were written that way: two guarding
service-worker activation, one the offline precache. Use
`expect.poll(() => page.evaluate(…))`, which runs in Node and does await it.

#### An instant read races every lazy route

Every route is a lazy chunk, so `waitForLoadState('load')` fires while `main`
still holds the "Loading..." fallback. `.count()`, `.isVisible()`,
`page.content()` and `page.evaluate` taken there see an empty page and report
the feature missing rather than waiting for it. Prefer a retrying
`expect(locator)`; `e2e/support/routes.ts`'s `waitForRoute` covers the rest.

#### Assertions that cannot fail, and fixtures that rot

`expect(typeof value).toBe('boolean')` and
`expect(hasContent).toBe(true)` over an `||` of loose substring checks both held
whether or not the feature was on the page — one of them "passed" against a page
correctly showing "No locations on the map yet". And dates pinned to a literal
month go stale: once March 2026 passed, the transport list folded every fixture
transport into its collapsed "Past transports" accordion and the assertions
hunted for rows that were rendered but hidden. Derive fixture dates from today.

---

## Supabase — RLS is the only thing protecting the data

The app ships no server. The publishable key is embedded in the client bundle by
design, so **Row-Level Security is the entire security boundary** — anyone can
call the REST API with that key.

- **Every table gets RLS enabled in the migration that creates it.** Not a
  follow-up migration. A table without it is world-writable to anyone who reads
  the bundle.
- **Grants are revoke-first.** Supabase's default `grant all` means an additive
  `grant select, insert` leaves `delete` and `truncate` in place. Two pgTAP tests
  expecting `42501` got no exception at all before this was fixed:
  `revoke all on <table> from anon, authenticated;` then grant what is wanted.
- **A privileged write users must be able to make goes in a `security definer`
  function, never a policy.** `redeem_invite` writes `trip_members`, which has no
  INSERT policy — joining requires a token, and that *is* the security property.
  `publish_trip_snapshot` deletes from the append-only log, which clients hold no
  DELETE on. Each function checks `auth.uid()` and membership as its first act,
  because definer rights bypass the policies that would otherwise say no.
- **`RETURNING` is subject to the SELECT policy.** `.insert().select().single()`
  compiles to `INSERT … RETURNING`, so a row you may create but not read fails
  the insert. This broke trip creation: the owner's roster row comes from an
  AFTER INSERT trigger, so the SELECT policy had to admit the owner directly.
- **A missing error is not a success.** An UPDATE matching no row succeeds with
  zero rows and no error. Ask for the affected rows and check them —
  `claimParticipant` reported a claim it had not made, leaving a participant
  looking unclaimed to the next person who joined.
- **Never paste the database password or the `service_role` key into a chat or a
  migration.** `supabase link` / `db push` are run by a human. Secrets that a
  migration needs live in Supabase Vault.
- **Never overwrite the client ID or secret of an auth provider.** The hosted
  project holds the only copy of every `[auth.external.*]` credential: nothing
  reads one back — `/auth/v1/settings` says a provider is enabled without
  revealing what it is set to — and no backup exists. Overwriting one takes that
  sign-in down for every user until someone fetches the value from the
  provider's own console. A human rotates these in the Supabase dashboard;
  no migration, script, config push, or agent in this repo may set them.
- **Push config with `bun run db:config-push`, never `supabase config push`.**
  The `env(...)` references under `[auth.external.*]` are resolved from the
  calling shell, and an unresolved one is pushed *verbatim* as the credential,
  overwriting the hosted project's copy — which is the only copy. A bare push on
  2026-09-04 wrote `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)` into the
  Google client ID and took Google and Spotify sign-in down together;
  `/auth/v1/settings` still reported both enabled, so the app kept offering two
  buttons that returned `401 invalid_client`. The wrapper refuses that push and
  names what is missing. Verify a provider from the outside afterwards — the
  redirect carries the client ID, so nothing needs a browser:
  `curl -sS -o /dev/null -w '%{redirect_url}\n' "$VITE_SUPABASE_URL/auth/v1/authorize?provider=google"`
- **Types are generated, not written.** `bun run db:types` reads the *linked*
  project, so `src/lib/supabase/database.types.ts` describes what is deployed
  rather than what the migrations would produce; the difference is worth seeing.
  Consumers take `TypedSupabaseClient` from `lib/supabase/client`.

The advisor is a good detector and an unreliable prescriber. It flagged
`is_trip_member`'s EXECUTE grant; revoking it made every `select` from `trips`
fail with `permission denied for function is_trip_member`. Treat a finding as a
prompt to check something, not an instruction. `plans/` records the triage.

## PostHog — analytics that must never break the app

`lib/posthog` default-exports a client that is **`undefined`** whenever
`VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` are absent — a fresh clone, a fork's CI,
every unit test.

- **Always `posthog?.capture(...)`.** Never assume the client exists.
- **That module must never throw.** `main.tsx` imports it at module scope, and so
  transitively does every component test, so a throw blanks the app and fails
  test collection rather than merely losing an event.
- **A visitor is a Person from their first pageview.** `person_profiles` is
  `'always'`. Under posthog-js's `'identified_only'` default — which this ran
  until it was changed deliberately — an anonymous event carries
  `$process_person_profile: false` and PostHog never folds it into the person a
  later `identify()` creates, so somebody who read a shared trip for a week and
  then signed up arrived with a history starting at the sign-up. Most of this
  app works signed out, so that was the majority of the story. The price, paid
  knowingly: a signed-out visitor is a person row, and every signed-out event is
  billed at PostHog's identified rate. Trip guests are still domain records
  rather than identities and are never passed to `identify()`; only a signed-in
  Supabase account is.
- **Send counts and enum values, not user content.** One capture breaks this
  deliberately — `assistant_prompt_sent` carries the prompt text, because what
  people ask is the only way to tell whether the assistant answers it. A prompt
  routinely names a trip's guests and where they are sleeping, and those people
  are not users of this app. `prompt_length` rides alongside so dropping `prompt`
  costs no other insight. Do not add a second exception without deciding to.
- **Mock it to test a capture.** The real export is `undefined` in tests, so an
  assertion on `capture` passes vacuously without
  `vi.mock('@/lib/posthog', () => ({ default: { capture: … } }))`. Find the call
  by event name, not by position: `calls.at(-1)` broke the moment a second event
  started firing after the one under test.
- **Identity follows the Supabase session, and enriches rather than creates.**
  `AuthContext` calls
  `identify(user.id, { supabase_user_id, email, name, auth_provider }, { signed_up_at })`
  on sign-in and `reset()` on sign-out. The person already exists — see
  `person_profiles` above — so `identify()` merges the anonymous person into the
  account and adds what only the account knows. Both calls fire on the
  *transition* only: that handler also runs on every token refresh, and
  `reset()` mints a fresh anonymous id, so calling it on each cold load would
  give a signed-out visitor a new identity every time and inflate unique users.
  The sign-out `reset()` is what stops the next person on a shared browser
  inheriting the last one's identity — and, now that every visitor is a person,
  what makes the next one their own person rather than an extra session on the
  last one's. The properties are not decoration: identified with the id alone, a
  person is a bare UUID that nobody can line up against its `auth.users` row.
  `signed_up_at` goes in the third argument, posthog-js's `$set_once` bucket,
  because the account's creation date cannot change and is what separates the
  sign-in that was a registration from the thousandth one. Absent fields are
  omitted rather than sent blank — `identify()` merges, so a blank overwrites a
  good value.
- **Sign out through `resetAnalyticsIdentity()`, never `posthog.reset()`.**
  `reset()` calls `persistence.clear()` internally, which drops *every* persisted
  property — super properties included — so a bare `reset()` leaves the rest of
  that tab reporting no `app_version` and no `signed_in`, and every event after a
  sign-out falls out of the breakdowns the project is sliced by. The helper puts
  back what `lib/posthog` registered; whoever registered a super property
  elsewhere restores their own (`AuthContext` re-registers `signed_in`).
- **A dev server must never reach PostHog, and three separate things enforce
  that.** They exist because the project once held 20 people against 3 Supabase
  accounts: 19 were anonymous ids and every one of their events came from
  `localhost:3000`, `localhost:5173` or the e2e servers. Do not remove any of
  them for being redundant — the redundancy is the point, and `person_profiles:
  'always'` raised the stakes: a development load that reaches PostHog now adds
  a person, not merely an event.
  1. `lib/posthog` refuses to `init()` when `window.location.hostname` looks
     like a development host — loopback, but also the RFC 1918 and link-local
     ranges, `.local` and `.localhost`, because `vite --host` serves a phone on
     the LAN a `192.168.x.x` address and that is exactly when somebody is poking
     at the app by hand. Overridden only by `VITE_POSTHOG_ALLOW_LOCALHOST=true`,
     set deliberately for one session. This is the layer that does not have to be
     remembered by each new entry point.
  2. `internal_or_test_user_hostname: null`. `defaults: '2026-05-30'` otherwise
     sets it to `/^(localhost|127\.0\.0\.1)$/`, and a match calls
     `setInternalOrTestUser()` → `setPersonProperties()`, which is one of the
     library calls that **force `$process_person_profile = true`**. Under the
     old `identified_only` that override was the whole mechanism behind the 19.
     It survives `'always'` for a smaller reason: it still stamps a person as an
     internal user off a hostname, a property nothing here can unset in bulk.
  3. `playwright.config.ts` (all three `webServer` env blocks) and
     `vitest.config.ts` blank `VITE_POSTHOG_KEY`/`VITE_POSTHOG_HOST` next to the
     Supabase pair — Vite loads `.env.local` for those servers too — and
     `.dockerignore` keeps `.env*` out of the Docker build context, where
     `COPY . .` used to inline a developer's real key into the bundle nginx
     serves on :3000. `e2e/support/external-services` additionally routes every
     `posthog.com`/`posthog.io` request to a local stub, and
     `e2e/analytics-privacy.spec.ts` asserts a run makes zero of them.
- **Super properties carry the context**, so a call site does not have to
  remember it: `app_version` registered at init, `signed_in` on every auth
  change. Most of this app works signed out, so that flag is the difference
  between "nobody uses sharing" and "nobody signs in".
- **Event names are `noun_verb_past`** — `trip_joined`, `assistant_answer_failed`
  — and a failure carries a `reason`, because "the invite did not work" and "the
  invite was revoked" are the same dead end to the user and different problems to
  fix.
- **`account_registered` is the signup event, and it needs two guards, not
  one.** Supabase fires the same `SIGNED_IN` for a registration and for the
  thousandth login, so `AuthContext` compares `last_sign_in_at` to `created_at`
  — both server timestamps, so a wrong browser clock cannot break it, which is
  why it is not a comparison against `now`. That alone is not enough:
  `last_sign_in_at` only moves on a *new* sign-in, so for somebody who registers
  and stays signed in it sits a beat after `created_at` for the life of the
  session, and every cold load would report a fresh signup. A
  `kikouchou_registered_<user id>` key in localStorage is the second half. It
  shares the fate of the thing it describes — the Supabase session is in
  localStorage too, so clearing site data drops both, the next sign-in is real,
  and the timestamps then say "not a registration" on their own.
- **An activity event goes through `captureUsage()`, never `posthog?.capture`.**
  PostHog's project setting for active users and stickiness takes a *single*
  event name, and no domain event fits — `activity_saved` misses everybody who
  only edited rooms, `$pageview` counts anyone who merely landed. So
  `captureUsage(action, properties)` fires the domain event unchanged and
  `app_used` beside it, carrying `{ action }`. That is the event the PostHog
  setting points at. The nine actions that count are the `UsageAction` union in
  `lib/posthog`, and what is left out is listed there with the reason: sync and
  connectivity events are machine-driven, `*_failed` and `*_blocked` are
  attempts that went nowhere, `assistant_answer_received` would double-count its
  own prompt, `pwa_install_completed` happens once per device. Note `app_used`
  is deliberately not named after "activity" — in this app an *Activity* is an
  itinerary item, which is a different thing entirely.

## Styling

- Tailwind CSS utility classes only — no inline styles, no CSS modules.
- **`cn()`** (`@/lib/utils`) for conditional/merged classes — wraps `clsx` + `tailwind-merge`.
- shadcn/ui components from `@/components/ui/*`; do not modify generated files directly.
- Theme tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, etc.) over raw colors.
- **Status colours go through `statusVariants`** (`@/components/ui/status.variants`), not
  raw palette shades. It encodes the four meanings `DESIGN_BOARD_BRIEF.md` §5 defines —
  green = arrival / success / online, orange = departure, amber = warning / offline
  reassurance / pickups / guest onboarding, red = destructive / errors — as
  `tone` × `emphasis` (`solid` · `soft` · `surface` · `outline` · `text`) over the
  semantic tokens in `src/index.css`. A single-property tint may name the token directly
  (`text-warning-on-surface`, `border-success-border`) — what must not come back is the
  palette shade. Needing a fifth spelling of amber means adding a variant there, not a
  `bg-amber-*` at the call site. Colour still never carries meaning alone: keep the
  `↓`/`↑` on arrival/departure and the text on a warning.

### The inline-style carve-out

"No inline styles" has exactly two exceptions, both because the value is only known at
runtime and therefore cannot be a utility class:

1. **A user-chosen colour** — `style={{ backgroundColor: person.color }}` and the guest
   swatches in `ColorPicker`. The palette lives in the database, not in the theme.
2. **Computed pixel geometry** — the timeline rows (`CalendarTimelineRow`,
   `ActivityTimelineRow`, `RoomOccupancyTimeline`, `TripTimelineFrame`) and progress-bar
   widths, where a position is a percentage of measured content.

Anything else — a colour, a spacing, a radius you could have written down in advance —
is a utility class. Nearby, `bg-white`/`text-white` similarly survive only where the
literal is the requirement rather than a theme choice: a QR code's quiet zone, and text
laid over a user-chosen colour where neither `--foreground` nor `--background` applies.

---

## Error Handling

- Async handlers: `try/catch/finally`; reset loading state in `finally`.
- Log with context: `console.error('Failed to save trip:', error)`.
- User feedback: `toast.success(t('…'))` / `toast.error(t('…'))` via `sonner`.
- `ErrorBoundary` wraps every route in `router.tsx`.
- Validation: **Zod schemas** in `src/lib/validation/schemas.ts`; parse at form submit / DB write boundaries.

---

## Internationalization

- **All** user-facing strings via `t('section.key')` — never hardcode text.
- Translation files: `src/locales/{en,fr}/translation.json`.
- Nested keys: `common.save`, `trips.name`, `errors.saveFailed`.
- Provide fallback for new keys: `t('errors.new', 'Fallback')`.

---

## Type Safety — Branded Types

IDs and special strings are branded to prevent mixing:

```typescript
export type TripId  = Brand<'TripId'>;   // never pass a RoomId where TripId expected
export type ISODateString = Brand<'ISODateString'>;  // use toISODateString(date) to create
export type HexColor      = Brand<'HexColor'>;       // use toHexColor('#rrggbb') to create
```

Use `toISODateStringFromString()` / `toISODateString()` / `toHexColor()` from `@/lib/db/utils` — never cast directly in production code.

---

## Testing Conventions

**Unit tests** — `src/{path}/__tests__/{Name}.test.tsx`; import from `@/test/utils` (not RTL directly):

```typescript
import { render, screen, waitForDb, createTestTrip, isoDate } from '@/test/utils';
```

- `render()` wraps with `MemoryRouter + AppProviders`; pass `{ withProviders: false }` for isolation.
- IndexedDB is mocked via `fake-indexeddb/auto` (auto-imported in `src/test/setup.ts`).
- DB is cleared before each test; do not share state between tests.
- `waitForDb()` flushes async DB microtasks when needed.
- i18next is mocked — `t('key')` returns the key string.

**E2E tests** — `e2e/{feature}.spec.ts`; use `@playwright/test`; `@axe-core/playwright` available for a11y checks.

---

## Accessibility

- ARIA labels on all icon-only buttons: `aria-label={t('common.menu')}`.
- Decorative icons: `aria-hidden="true"`.
- Form fields: `htmlFor`/`id`, `aria-invalid`, `aria-describedby` linking error `<p role="alert">`.
- Keyboard nav: `focus-visible:ring-2 focus-visible:ring-ring` on all interactive elements.
- Skip link: `<a href="#main-content" className="sr-only focus:not-sr-only …">`.

---

## Directory Structure

```
src/
├── components/
│   ├── ui/          # shadcn/ui primitives (do not edit directly)
│   ├── shared/      # Layout, ErrorBoundary, LoadingState, PageHeader
│   └── pwa/         # InstallPrompt, OfflineIndicator
├── contexts/        # React Context providers + hooks
├── features/        # trips | rooms | persons | guest-groups | transports | activities | calendar | analytics | assistant | sharing | settings
│   └── {name}/      # pages/ · components/ · routes.tsx · index.ts
├── hooks/           # Shared custom hooks
├── lib/
│   ├── db/          # Dexie database, repositories, utils
│   ├── i18n/        # i18next setup
│   ├── map/         # Leaflet helpers
│   ├── posthog.ts   # Analytics client (undefined without env config)
│   ├── supabase/    # Client, generated database.types.ts, auth callback
│   ├── sync/        # Server sync: provider, cursors, outbox, invites, join,
│   │                #   account sweep (every trip, both ways, on sign-in)
│   ├── utils/       # Shared utilities
│   ├── validation/  # Zod schemas
│   └── yjs/         # CRDT doc model and the Dexie bridge
├── locales/         # en/ · fr/
├── test/            # setup.ts · utils.tsx (test helpers)
├── types/           # index.ts (all branded types + entity interfaces)
└── router.tsx
```

Plus, outside `src/`:

```
supabase/
├── config.toml      # Local stack configuration
├── migrations/      # Ordered SQL; RLS enabled in the same file as the table
└── tests/           # pgTAP — run with `bunx supabase test db`
e2e/
├── support/         # supabase-stub.ts: the REST surface, for the sync project
└── *.spec.ts        # See playwright.config.ts for which project runs which
```

For detailed convention rationale, see `CONVENTIONS.md`. For why the sync
architecture is shaped as it is, and the bugs that shaped it, see
`plans/2026-08-31-server-backed-trip-sync-v1.md`.
