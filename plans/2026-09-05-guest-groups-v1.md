# Guest groups — reusable rosters that import into a trip

## Objective

A guest group is a saved roster of people — "Family", "The Lyon crew" — that
lives *beside* trips rather than inside one. Adding a group to a trip creates
ordinary guests from the members the user picks, so the same family does not get
retyped every summer.

Decided with the user before implementation:

| Question | Decision |
|---|---|
| Import semantics | **One-off copy.** A member is cloned into a `Person`; neither side tracks the other afterwards. |
| Storage | **Device-local Dexie table, synced per account to Supabase.** |
| Entry points | Global `/groups` page · import from a trip's guest list · "save these guests as a group" · import while creating a trip |
| Assistant | Reads groups, and can import one. |

## Why a copy, and what that buys

The trip document is a CRDT synced to every member of the trip; a guest group is
personal and synced to the *account*. Keeping the import a copy means those two
worlds never have to meet: an imported guest is an ordinary `Person`, so it
projects into the Yjs document, exports to a QR changeset and reaches a co-
traveller who has never heard of the group — with no new field on `Person` and no
change to `doc-model.ts`.

A linked member would have needed the reverse: a `groupMemberId` on `Person`
travelling through sync to devices that cannot resolve it, plus a conflict rule
for a guest edited locally. Rejected for this reason, not for effort.

## Data model

```ts
export interface GuestGroupMember {
  readonly id: GuestGroupMemberId;
  name: string;
  color: HexColor;
  headcount?: number;   // "Tom+Léa" is one member standing for two people
  notes?: string;       // allergies, diet — copied onto the guest
}

export interface GuestGroup extends Identifiable, WithTimestamps {
  readonly id: GuestGroupId;
  name: string;
  members: GuestGroupMember[];
  remoteGroupId?: string;   // server row, once uploaded
}
```

Members are embedded rather than given their own table. They are inert value
objects — nothing references a member id, and a member is only ever read as part
of its group — so a second table would buy a join and cost a cascade.

`headcount` is the field that answers the user's example directly: "me and my
wife" is one member with `headcount: 2`, and each daughter is a member of her
own, so the selector offers three rows and the trip gains four people.

## Sync — last-write-wins on a personal record

Groups belong to an account, not to a trip, so none of the Yjs machinery
applies. The server table is a plain mirror and the client reconciles by
`updatedAt`:

- **push** upserts on `(owner_id, local_id)` — the client nanoid travels as
  `local_id`, exactly as `remote-trip.ts` does for trips, so a retry, a second
  tab and a reinstall all resolve to the same row.
- **pull** takes the server row when its `updatedAt` is newer, and drops a local
  group **only when it carries a `remoteGroupId` that the server no longer
  lists**. That is the narrow form of AGENTS.md's rule that a deletion is never
  inferred from a possibly-incomplete mirror: a group this device has never
  pushed is not evidence of anything and is never pruned.
- A group edited offline on one device while deleted on another comes back on
  the next push. LWW on a personal record; documented, not fixed.

Every field arriving from the server is bounded before it is written — name
length, member count, headcount range, hex colour, notes length — and an invalid
member is dropped on its own rather than taking its group with it.

## Plan

1. **Types** — `GuestGroupId`, `GuestGroupMemberId`, `GuestGroup`,
   `GuestGroupMember`, `GuestGroupFormData`, `MAX_GUEST_GROUP_MEMBERS`.
2. **Validation & sanitising** — Zod schemas beside the existing ones,
   `MAX_LENGTHS.guestGroupName`, `sanitizeGuestGroupData`.
3. **Dexie** — schema **version 9** adds `guestGroups: 'id, name, remoteGroupId'`.
   Not trip-scoped, so it deliberately joins neither `deleteTrip`'s cascade nor
   any `tripId` index; `src/test/setup.ts` derives its reset list from
   `db.tables` and needs nothing.
4. **Repository** — CRUD, `importGuestGroupMembers(tripId, groupId, memberIds)`
   in one transaction, `createGuestGroupFromPersons(name, persons)`.
5. **Server** — migration creating `public.guest_groups` with RLS enabled in the
   same file, revoke-first grants, owner-only policies; pgTAP covering "a
   stranger reads nothing" and "the grants are actually gone".
6. **Client sync** — `lib/sync/guest-groups.ts` (`pushGuestGroups`,
   `pullGuestGroups`, `syncGuestGroups`) plus a `GuestGroupSync` mount that runs
   on sign-in and after a local write, and does nothing at all without a session.
7. **UI** — `features/guest-groups/`: list page at `/groups`, group form with a
   member editor, import dialog with per-member checkboxes, "save as group"
   dialog. Global nav entry beside "My trips".
8. **Integration** — guest list gains *Add from a group* and *Save as group*;
   the create-trip form gains the group picker next to the existing
   import-from-a-previous-location suggestion.
9. **Assistant** — a `## Guest groups` section in the trip system prompt and an
   `importGuestGroup` action. The generated action prompt sits at 3525 of its
   3700-char budget, so existing wording is trimmed to pay for it rather than
   the cap being raised.
10. **i18n** — every key in `en` *and* `fr`.
11. **Tests** — unit per layer, pgTAP for the policies, e2e for the round trip
    (create a group → import two of its three members into a trip).
