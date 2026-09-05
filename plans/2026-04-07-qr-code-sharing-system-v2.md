# QR Code P2P Trip Sharing System

## Objective

Implement a peer-to-peer trip synchronization system using QR codes. The host (trip creator) shares a trip snapshot to a guest via QR code. The guest imports it, makes modifications locally (room preferences, transport details, stay dates), then exports their changes as a QR code. The host scans the guest's QR code to merge modifications back, with a conflict resolution UI for overlapping changes.

## Encoding Strategy: Protobuf with Build-Time Code Generation

### Why Protobuf over JSON

| Aspect | JSON + gzip | Protobuf binary |
|--------|------------|-----------------|
| Field names | Repeated as strings (`"personId"`, `"startDate"`) | 1-2 byte numeric tags |
| Strings | Quoted, escaped | Length-prefixed, raw bytes |
| Numbers | Text digits (`"1719849600"`) | Varint encoding (1-5 bytes) |
| Booleans | 4-5 bytes (`true`/`false`) | 1 byte |
| Structure | `{`, `}`, `[`, `]`, `,` overhead | Zero structural overhead |
| Compression needed? | Yes (gzip ~60% reduction) | Usually not needed — already compact |
| **Typical guest changeset** | **~400-500 B** (after gzip) | **~200-350 B** (raw, no compression) |

Protobuf binary encoding is ~2-3x smaller than JSON even after gzip. For QR codes where every byte matters, this is the optimal format.

### Toolchain: `buf` + `protobuf-es` (Build-Time Generation)

**Recommended stack:**

| Tool | Role | Install scope |
|------|------|--------------|
| `@bufbuild/protobuf` | Runtime: `toBinary()`, `fromBinary()`, `create()` | **dependency** (ships to client, ~4KB tree-shaken) |
| `@bufbuild/protoc-gen-es` | Code generator plugin: `.proto` → `.ts` | **devDependency** (build-time only) |
| `@bufbuild/buf` | CLI orchestrator: runs `buf generate` | **devDependency** (build-time only) |

**Why `protobuf-es` over `ts-proto`:**
- `protobuf-es` is the only fully Protobuf-conformant JS library (passes all conformance tests)
- Generates clean ESM TypeScript that tree-shakes excellently with Vite/Rollup
- The `@bufbuild/protobuf` runtime is very small after tree-shaking (~4KB for encode/decode paths only)
- Created by Buf, the team behind the `buf` CLI — tight integration
- Explicit Bun compatibility noted in their docs
- `ts-proto` 2.x actually migrated its own internals to `@bufbuild/protobuf` wire format, confirming it as the standard

**What ships to the client:** Only the tree-shaken parts of `@bufbuild/protobuf` (~4KB gzipped) plus the generated schema descriptors. The `buf` CLI and `protoc-gen-es` plugin are purely build-time tools.

### Build Pipeline

```
proto/changeset.proto  (schema definition)
         │
         ▼  buf generate  (build-time, via bun run generate-proto)
         │
src/gen/changeset_pb.ts  (generated TypeScript — committed to repo)
         │
         ▼  Vite bundle  (tree-shakes @bufbuild/protobuf)
         │
dist/assets/*.js  (only encode/decode + schema descriptors, ~4KB)
```

### Proto Schema

```protobuf
syntax = "proto3";

package kikouchou.sharing;

// Top-level changeset message — this is what goes into the QR code
message TripChangeset {
  uint32 version = 1;           // schema version (1)
  string trip_id = 2;
  string share_id = 3;
  string exported_by = 4;       // PersonId of the guest
  int64 exported_at = 5;        // unix timestamp ms
  int64 base_snapshot_at = 6;   // timestamp of when guest imported the trip
  
  EntityList added = 7;
  EntityList modified = 8;
}

message EntityList {
  repeated Person persons = 1;
  repeated RoomAssignment assignments = 2;
  repeated Transport transports = 3;
}

message Person {
  string id = 1;
  string trip_id = 2;
  string name = 3;
  string color = 4;             // hex color "#rrggbb"
  optional string stay_start_date = 5;  // ISO date
  optional string stay_end_date = 6;
}

message RoomAssignment {
  string id = 1;
  string trip_id = 2;
  string room_id = 3;
  string person_id = 4;
  string start_date = 5;
  string end_date = 6;
}

message Transport {
  string id = 1;
  string trip_id = 2;
  string person_id = 3;
  TransportType type = 4;
  string datetime = 5;          // ISO datetime
  string location = 6;
  optional Coordinates coordinates = 7;
  optional TransportMode transport_mode = 8;
  optional string transport_number = 9;
  optional string driver_id = 10;
  bool needs_pickup = 11;
  optional string notes = 12;
}

message Coordinates {
  double lat = 1;
  double lon = 2;
}

enum TransportType {
  TRANSPORT_TYPE_UNSPECIFIED = 0;
  TRANSPORT_TYPE_ARRIVAL = 1;
  TRANSPORT_TYPE_DEPARTURE = 2;
}

enum TransportMode {
  TRANSPORT_MODE_UNSPECIFIED = 0;
  TRANSPORT_MODE_TRAIN = 1;
  TRANSPORT_MODE_PLANE = 2;
  TRANSPORT_MODE_CAR = 3;
  TRANSPORT_MODE_BUS = 4;
  TRANSPORT_MODE_OTHER = 5;
}
```

### Encoding Pipeline (at export time)

```
App entities (Person, RoomAssignment, Transport)
    │
    ▼  Convert to protobuf message objects (mappers in src/lib/sharing/mappers.ts)
    │
TripChangeset protobuf message
    │
    ▼  toBinary(TripChangesetSchema, changeset)  — from @bufbuild/protobuf
    │
Uint8Array (compact binary, ~200-350 bytes typical)
    │
    ▼  base64url encode  (built-in btoa or custom for URL-safety)
    │
String (~270-470 chars)
    │
    ▼  QR code  (well within single QR capacity of ~2,953 bytes)
```

### Size Estimates with Protobuf

| Scenario | Protobuf binary | Base64url | Fits single QR? |
|----------|----------------|-----------|-----------------|
| 1 person + 1 assignment + 2 transports | ~180 B | ~240 chars | Yes (easily) |
| 1 person + 3 assignments + 4 transports | ~400 B | ~535 chars | Yes |
| 3 persons + 5 assignments + 6 transports | ~800 B | ~1,070 chars | Yes |
| Extreme: 10 persons + 20 assignments + 20 transports | ~2,200 B | ~2,935 chars | Borderline — may need multi-frame |

With protobuf, gzip is **not needed** for typical cases. The binary format is already compact enough. This eliminates the `CompressionStream` browser compatibility concern entirely.

## Architecture Design

### Core Concept: Snapshot + Changeset Model

```
Host creates trip → captures SNAPSHOT (version 0)
Host shares trip to Guest (via URL QR — existing flow)
Guest receives trip data in their local IndexedDB
Guest makes changes locally (person, room, transport)
Guest exports CHANGESET (diff between their current state and the snapshot they received)
Host scans Guest's changeset QR
Host's merge engine applies changes with conflict detection
Host resolves any conflicts via UI
```

### Merge Strategy

The merge follows a **"host is truth, guest additions win, conflicts shown"** model:

| Scenario | Resolution |
|----------|-----------|
| Guest added a new Person | Auto-add (match by name to prevent duplicates) |
| Guest modified their own Person (stay dates, color) | Auto-apply if host didn't also modify |
| Guest added RoomAssignment for themselves | Auto-add if no conflict with host's assignments |
| Guest added Transport for themselves | Auto-add |
| Guest modified a Transport | Auto-apply if host didn't modify the same transport |
| Both modified the same entity | **Show conflict UI** — side-by-side comparison |
| Host deleted an entity the guest modified | Show as conflict — "This was deleted, re-add?" |
| Guest data references unknown IDs (room deleted by host) | Show as warning — "Room no longer exists, skip?" |

### Conflict Resolution UI

A dedicated import review page:
- **Summary header**: "Importing changes from [Guest Name]"
- **Auto-applied section**: Green checkmarks for non-conflicting additions
- **Conflicts section**: Orange warning cards with side-by-side "Your version" vs "Their version" and action buttons: "Keep mine", "Use theirs"
- **Warnings section**: Yellow cards for orphaned references
- **Apply button**: Commits all resolved changes in a single Dexie transaction

## Implementation Plan

### Phase 0: Protobuf Toolchain Setup

- [ ] **0.1 Install protobuf dependencies**
  - `bun add @bufbuild/protobuf` (runtime — ships to client, ~4KB tree-shaken)
  - `bun add -D @bufbuild/protoc-gen-es @bufbuild/buf` (build-time only)
  - Rationale: `@bufbuild/buf` provides the `buf` CLI, `@bufbuild/protoc-gen-es` is the code gen plugin, `@bufbuild/protobuf` is the minimal runtime for `toBinary`/`fromBinary`

- [ ] **0.2 Create protobuf schema file** (`proto/changeset.proto`)
  - Define `TripChangeset`, `EntityList`, `Person`, `RoomAssignment`, `Transport`, `Coordinates`, `TransportType`, `TransportMode` messages
  - Use proto3 syntax with `optional` for nullable fields matching the app's type system
  - Rationale: Single source of truth for the wire format; changes here auto-propagate via code generation

- [ ] **0.3 Create buf configuration files**
  - `buf.yaml` at project root: defines the proto module, lint rules
  - `buf.gen.yaml` at project root: configures `protoc-gen-es` plugin with `target=ts`, output to `src/gen/`
  - Rationale: Standard buf project configuration; enables `npx buf generate` to produce TypeScript

- [ ] **0.4 Add code generation script to package.json**
  - Add `"generate-proto": "buf generate"` script
  - Add `"prebuild": "bun run generate-proto"` to run before builds
  - Include in `validate` script chain
  - Rationale: Generated code is always fresh before build; consistent with existing `generate-icons` script pattern

- [ ] **0.5 Generate and commit initial TypeScript code**
  - Run `bun run generate-proto` to produce `src/gen/changeset_pb.ts`
  - Commit the generated file to the repository (not gitignored)
  - Rationale: Committing generated code avoids requiring `buf` in CI for non-proto changes; matches the `generate-icons` pattern already used in the project

### Phase 1: Core Sharing Infrastructure

- [ ] **1.1 Create type mappers** (`src/lib/sharing/mappers.ts`)
  - `appPersonToProto(person: Person): ProtoPersonMsg` — converts app `Person` to protobuf `Person` message
  - `protoPersonToApp(proto: ProtoPersonMsg): Person` — converts back with branded type casting
  - Same pattern for `RoomAssignment` and `Transport`
  - Handle enum mapping: `TransportType` ↔ proto `TransportType`, `TransportMode` ↔ proto `TransportMode`
  - Rationale: Clean separation between app domain types (branded, with runtime constraints) and wire format types (plain protobuf messages)

- [ ] **1.2 Implement export service** (`src/lib/sharing/export.ts`)
  - `exportGuestChangeset(tripId, personId, baseSnapshotAt): Promise<TripChangeset>` — reads guest's entities from IndexedDB, computes diff vs baseline timestamp, builds protobuf `TripChangeset` message
  - `encodeChangeset(changeset: TripChangeset): string` — `toBinary()` → base64url encode
  - Rationale: Separates data gathering from encoding; the changeset captures only what the guest added/modified

- [ ] **1.3 Implement decode service** (`src/lib/sharing/decode.ts`)
  - `decodeChangeset(encoded: string): TripChangeset` — base64url decode → `fromBinary()` → validate schema version
  - Include version check: reject if `version > CURRENT_VERSION` with user-friendly message
  - Rationale: Robust decoding with forward-compatibility check

- [ ] **1.4 Implement merge engine** (`src/lib/sharing/merge.ts`)
  - `mergeChangeset(tripId, changeset, currentState): Promise<MergeResult>`
  - Produces lists of: auto-applied changes, conflicts, warnings
  - Person deduplication by name (case-insensitive)
  - Referential integrity checks (do referenced rooms/persons still exist?)
  - Returns `MergeResult` with `autoApplied`, `conflicts`, `warnings` arrays
  - Rationale: Core business logic; must be pure and testable without UI

- [ ] **1.5 Implement merge applicator** (`src/lib/sharing/apply.ts`)
  - `applyMergeResult(tripId, result: ResolvedMergeResult): Promise<void>`
  - Applies all resolved changes in a single Dexie transaction
  - Generates new IDs for imported entities, maintains ID mapping for referential integrity
  - Updates trip's `updatedAt` timestamp
  - Rationale: Separating resolution from application enables preview/confirm UX

- [ ] **1.6 Create sharing types** (`src/lib/sharing/types.ts`)
  - Define `MergeConflict`, `MergeResult`, `ResolvedMergeResult`, `MergeWarning` types
  - These are app-level types (not wire format) used by the merge engine and UI
  - Rationale: The protobuf types handle the wire format; these types handle the merge domain logic

### Phase 2: QR Code Scanning Infrastructure

- [ ] **2.1 Add QR scanner dependency**
  - Add `html5-qrcode` (or equivalent lightweight scanner library) to `package.json`
  - Rationale: The app currently generates QR codes (`qrcode.react`) but cannot read them

- [ ] **2.2 Create QR Scanner component** (`src/components/shared/QrScanner.tsx`)
  - Wraps the QR scanner library in a React component
  - Props: `onScan(data: string)`, `onError(error: Error)`, `active: boolean`
  - Handles camera permissions gracefully with user-friendly messages
  - Mobile-first design (fullscreen viewfinder overlay)
  - Rationale: Reusable component for any future QR scanning needs

- [ ] **2.3 Create multi-frame QR display component** (`src/components/shared/AnimatedQrCode.tsx`)
  - For the rare case of changesets that exceed single QR capacity (~2,953 bytes)
  - Splits encoded string into frames with header `{frame}:{total}:{data}`
  - Cycles display at configurable interval (default 300ms)
  - Shows progress indicator ("Frame 2/5")
  - Also provides "Copy to clipboard" fallback button
  - Rationale: Graceful handling of larger-than-QR payloads without requiring network

- [ ] **2.4 Create multi-frame QR scanner logic** (`src/hooks/useMultiFrameQrScan.ts`)
  - Accumulates scanned frames, tracking which have been received
  - Progress indicator ("Scanned 3/5 frames")
  - Handles out-of-order scanning
  - Emits complete payload once all frames collected
  - Rationale: Complements AnimatedQrCode for the receiving end

### Phase 3: Guest Export Flow (Guest-side UI)

- [ ] **3.1 Track import baseline** (modify guest onboarding wizard)
  - When a guest completes the onboarding wizard (SummaryStepPage "Enter trip"), persist a `baseSnapshotAt` timestamp to localStorage alongside the existing guest identity
  - Key: `kikouchou_guest_{shareId}` → add `baseSnapshotAt` field
  - Rationale: The changeset computation needs to know what state existed when the guest started

- [ ] **3.2 Create Guest Export page** (`src/features/sharing/pages/GuestExportPage.tsx`)
  - Route: `/trips/:tripId/export` (inside app layout, requires trip context)
  - Shows a preview of what will be exported (person info, room assignments, transports)
  - "Generate QR Code" button triggers changeset computation + encoding
  - Displays the QR code (single or animated multi-frame)
  - "Copy as text" fallback button
  - Rationale: Gives the guest visibility into what they're sharing back

- [ ] **3.3 Add export entry point in trip UI**
  - Add an "Export my changes" button/menu item in the trip navigation or settings
  - Only visible when the user is identified as a guest (has `kikouchou_guest_*` in localStorage)
  - Navigate to GuestExportPage
  - Rationale: Discoverability — guests need to know how to share their changes back

### Phase 4: Host Import Flow (Host-side UI)

- [ ] **4.1 Create Import/Scan page** (`src/features/sharing/pages/ImportScanPage.tsx`)
  - Route: `/trips/:tripId/import` (inside app layout)
  - Two tabs: "Scan QR Code" and "Paste Text"
  - Scan tab: Uses QrScanner component, handles single and multi-frame
  - Paste tab: Textarea for pasting base64-encoded changeset
  - On successful decode: navigate to merge review page
  - Rationale: Two input methods ensure the feature works even if camera scanning fails

- [ ] **4.2 Create Merge Review page** (`src/features/sharing/pages/MergeReviewPage.tsx`)
  - Route: `/trips/:tripId/import/review` (or modal/sheet overlay)
  - Displays MergeResult: auto-applied items, conflicts, warnings
  - Each conflict card shows side-by-side comparison with resolution buttons
  - "Apply all" button at bottom, disabled until all conflicts resolved
  - Success toast + navigate to calendar on completion
  - Rationale: This is the key UX differentiator — making conflict resolution intuitive

- [ ] **4.3 Add import entry point in trip UI**
  - Add "Import guest changes" button in the ShareDialog or trip settings
  - Navigate to ImportScanPage
  - Rationale: Host needs a clear path to initiate the sync process

### Phase 5: Translation Keys

- [ ] **5.1 Add i18n keys for sharing sync**
  - Add keys under `sharing.sync.*` namespace in both `en/translation.json` and `fr/translation.json`
  - Keys needed: export preview labels, QR scanning instructions, merge review headers, conflict descriptions, resolution button labels, success/error messages, multi-frame progress
  - Rationale: All user-facing text must go through i18n per project conventions

### Phase 6: Testing

- [ ] **6.1 Unit tests for codec** (`src/lib/sharing/__tests__/codec.test.ts`)
  - Test encode/decode round-trip with protobuf binary
  - Test with various payload sizes
  - Test frame splitting logic for multi-frame QR
  - Test base64url encoding edge cases
  - Test version compatibility check

- [ ] **6.2 Unit tests for merge engine** (`src/lib/sharing/__tests__/merge.test.ts`)
  - Test all merge scenarios from the matrix above
  - Test person deduplication by name
  - Test referential integrity warnings
  - Test concurrent modifications (both sides changed same entity)
  - Test empty changesets

- [ ] **6.3 Unit tests for mappers** (`src/lib/sharing/__tests__/mappers.test.ts`)
  - Test round-trip: app type → proto → app type preserves all data
  - Test enum mapping for transport types and modes
  - Test optional field handling (coordinates, notes, etc.)
  - Test branded type preservation

- [ ] **6.4 Unit tests for export service** (`src/lib/sharing/__tests__/export.test.ts`)
  - Test snapshot creation with various entity counts
  - Test changeset computation (added vs modified detection)

- [ ] **6.5 Component tests for QR Scanner** (`src/components/shared/__tests__/QrScanner.test.tsx`)
  - Test camera permission handling
  - Test scan success callback
  - Test error states

- [ ] **6.6 Component tests for merge review UI** (`src/features/sharing/pages/__tests__/MergeReviewPage.test.tsx`)
  - Test rendering of auto-applied, conflicts, warnings sections
  - Test conflict resolution flow
  - Test apply button state management

- [ ] **6.7 E2E test for full sync flow** (`e2e/sharing-sync.spec.ts`)
  - Test export → import → merge → apply cycle
  - Test conflict resolution UI interaction

### Phase 7: Route Registration

- [ ] **7.1 Register new routes**
  - Add `GuestExportPage` route to sharing routes or trip routes
  - Add `ImportScanPage` and `MergeReviewPage` routes
  - Ensure proper lazy loading and error boundary wrapping
  - Update router.tsx if needed

## Verification Criteria

- A guest can export their modifications as a QR code (single or multi-frame)
- A host can scan the QR code and see a preview of incoming changes
- Non-conflicting changes are auto-applied with visual confirmation
- Conflicting changes display a side-by-side comparison with resolution options
- Orphaned references (deleted rooms, etc.) show as warnings
- The merge is atomic — either all resolved changes apply or none do
- All user-facing text uses i18n translation keys
- The feature works fully offline (no network required)
- Protobuf-encoded changesets for a typical guest (1 person, 1-2 rooms, 2 transports) produce ~200-350 bytes binary, well within single QR capacity
- `bun run generate-proto` produces valid TypeScript from proto schema
- `bun run validate` passes (includes proto generation + build + tests)

## Potential Risks and Mitigations

1. **Protobuf runtime size concern**
   Mitigation: `@bufbuild/protobuf` tree-shakes to ~4KB gzipped when only using `toBinary`/`fromBinary`/`create`. Vite handles this automatically. This is smaller than any JSON+gzip compression library would be.

2. **Proto schema evolution / versioning**
   Mitigation: Protobuf's built-in forward/backward compatibility rules apply. New optional fields can be added freely. The `version` field in `TripChangeset` allows graceful rejection of incompatible future formats. Proto3's default-value semantics ensure old clients can read new messages.

3. **ID collisions when importing guest-created entities**
   Mitigation: The merge engine generates new IDs for imported entities and maintains an ID mapping table for referential integrity (e.g., if a guest-created person is referenced by a guest-created transport).

4. **Stale guest data after host made structural changes**
   Mitigation: The merge engine checks referential integrity — if a guest's room assignment references a room the host deleted, it surfaces as a warning rather than silently failing.

5. **Camera permissions denied for QR scanning**
   Mitigation: The "Paste text" tab provides a non-camera alternative. Clear permission-request messaging in the scan UI.

6. **Guest modifies entities they shouldn't (other people's data)**
   Mitigation: The changeset is scoped to the guest's `personId`. The merge engine filters to only accept changes related to the exporting person. Changes to other people's data require explicit host approval.

7. **Generated protobuf code drift**
   Mitigation: Generated `src/gen/changeset_pb.ts` is committed to the repo and regenerated via `bun run generate-proto`. The `validate` script chain ensures proto generation runs before build. CI catches any proto schema ↔ generated code mismatch.

## Alternative Approaches Considered

1. **JSON + gzip (v1 plan)**: Simpler but ~2-3x larger payloads. Requires `CompressionStream` browser API or a compression library. JSON field names waste significant space in QR codes. Protobuf is strictly better for this use case.

2. **JSON + manual key minification + gzip**: Custom key abbreviation maps (e.g., `personId` → `p`). More compact than raw JSON but error-prone, hard to maintain, and still larger than protobuf. Also requires maintaining hand-written minification maps.

3. **Custom binary format**: Maximum compactness but requires hand-writing encode/decode logic, no schema validation, no forward compatibility, high maintenance burden.

4. **ts-proto instead of protobuf-es**: `ts-proto` generates idiomatic TypeScript interfaces with inline `encode`/`decode` methods. Its 2.x version migrated to `@bufbuild/protobuf` wire format internally. However, `protobuf-es` is the canonical implementation from Buf, has full conformance, and integrates cleanly with the `buf` CLI. Either would work; `protobuf-es` is preferred for its conformance guarantee and tighter `buf` integration.

5. **CRDTs**: Theoretically elegant for P2P sync, but adds significant complexity. Better suited for the future PostgreSQL backend phase.

## File Structure

```
proto/
└── changeset.proto              # Protobuf schema definition

buf.yaml                          # Buf module configuration
buf.gen.yaml                      # Buf code generation configuration

src/gen/
└── changeset_pb.ts              # Generated TypeScript (committed)

src/lib/sharing/
├── types.ts                     # MergeResult, MergeConflict types (app-level)
├── mappers.ts                   # App type ↔ Protobuf message converters
├── export.ts                    # exportGuestChangeset, encodeChangeset
├── decode.ts                    # decodeChangeset (base64url → fromBinary)
├── merge.ts                     # mergeChangeset (pure logic)
├── apply.ts                     # applyMergeResult (Dexie transaction)
└── __tests__/
    ├── codec.test.ts
    ├── mappers.test.ts
    ├── merge.test.ts
    └── export.test.ts

src/components/shared/
├── QrScanner.tsx                # Camera-based QR scanner
└── AnimatedQrCode.tsx           # Multi-frame QR display

src/hooks/
└── useMultiFrameQrScan.ts       # Multi-frame QR accumulation

src/features/sharing/
├── pages/
│   ├── GuestExportPage.tsx      # Guest exports their changes as QR
│   ├── ImportScanPage.tsx       # Host scans/pastes guest's QR
│   └── MergeReviewPage.tsx      # Conflict resolution UI
└── components/
    ├── MergeConflictCard.tsx     # Side-by-side conflict display
    └── MergePreviewList.tsx      # List of auto-applied changes
```
