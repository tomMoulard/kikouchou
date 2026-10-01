# QR Code P2P Trip Sharing System

## Objective

Implement a peer-to-peer trip synchronization system using QR codes. The host (trip creator) shares a trip snapshot to a guest via QR code. The guest imports it, makes modifications locally (room preferences, transport details, stay dates), then exports their changes as a QR code. The host scans the guest's QR code to merge modifications back, with a conflict resolution UI for overlapping changes.

## Problem Analysis: QR Code Capacity vs Trip Data Size

**QR Code limits:**
- Binary mode: ~2,953 bytes max (at error correction level L)
- Alphanumeric mode: ~4,296 characters max
- Level M correction (current): ~2,331 bytes binary

**Estimated trip data size (full export):**
A trip with 5 rooms, 10 persons, 20 assignments, 20 transports would be ~8-15 KB as raw JSON — far exceeding QR capacity.

**Solution: Multi-QR "Animated" Approach + Delta-Based Sync**

Rather than encoding full trip data, use a **two-strategy approach**:

1. **Host-to-Guest (initial share):** Use the existing URL-based share mechanism (current ShareDialog QR). The guest gets the trip locally via the onboarding wizard. This already works.

2. **Guest-to-Host (sync back):** Use a **delta/changeset QR** encoding only what the guest modified. A guest typically adds/changes their own Person record, 1-2 RoomAssignments, and 1-2 Transports. This is ~500-1500 bytes compressed — fits in a single QR.

3. **Fallback for large changesets:** Support **multi-frame animated QR codes** (like QR-based file transfer apps) that cycle through chunks, or use a copy-pasteable base64 text blob.

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

### Data Model: TripSnapshot and Changeset

```typescript
// Snapshot: full state of relevant entities at a point in time
interface TripSnapshot {
  v: 1;                           // schema version
  tripId: TripId;
  exportedAt: number;             // unix timestamp
  exportedBy?: PersonId;          // who exported (the guest)
  persons: Person[];
  rooms: Room[];                  // read-only context for guest
  assignments: RoomAssignment[];
  transports: Transport[];
}

// Changeset: only what the guest added or modified
interface TripChangeset {
  v: 1;
  tripId: TripId;
  shareId: ShareId;               // for lookup
  exportedAt: number;
  exportedBy: PersonId;           // the guest who made changes
  baseSnapshotAt: number;         // timestamp of snapshot they imported
  added: {
    persons: Person[];
    assignments: RoomAssignment[];
    transports: Transport[];
  };
  modified: {
    persons: PersonUpdate[];      // { id, ...changed fields }
    assignments: AssignmentUpdate[];
    transports: TransportUpdate[];
  };
}
```

### Encoding Strategy

1. **Minify keys**: Map verbose field names to 1-2 char abbreviations in a compact schema (e.g., `personId` → `p`, `startDate` → `s`, `transportMode` → `m`)
2. **Compress**: Use `CompressionStream` (native browser API) with gzip, then base64url encode
3. **QR encode**: The resulting string goes into a QR code at error correction level L (max capacity)
4. **Multi-frame fallback**: If compressed payload > 2,500 bytes, split into numbered frames and animate the QR code display (cycling ~200ms per frame), plus offer a "Copy as text" option

### Merge Strategy

The merge follows a **"host is truth, guest additions win, conflicts shown"** model:

| Scenario | Resolution |
|----------|-----------|
| Guest added a new Person | Auto-add (match by name to prevent duplicates) |
| Guest modified their own Person (stay dates, color) | Auto-apply if host didn't also modify |
| Guest added RoomAssignment for themselves | Auto-add if no conflict with host's assignments |
| Guest added Transport for themselves | Auto-add |
| Guest modified a Transport | Auto-apply if host didn't modify the same transport |
| Both modified the same entity | **Show conflict UI** — side-by-side comparison with "Keep mine" / "Use theirs" / "Merge" options |
| Host deleted an entity the guest modified | Show as conflict — "This was deleted, re-add?" |
| Guest data references unknown IDs (room deleted by host) | Show as warning — "Room no longer exists, skip assignment?" |

### Conflict Resolution UI

A dedicated import review page:
- **Summary header**: "Importing changes from [Guest Name]"
- **Auto-applied section**: Green checkmarks for non-conflicting additions
- **Conflicts section**: Orange warning cards, each showing:
  - Entity type + name
  - Side-by-side "Your version" vs "Their version"
  - Action buttons: "Keep mine", "Use theirs"
- **Warnings section**: Yellow cards for orphaned references
- **Apply button**: Commits all resolved changes in a single Dexie transaction

## Implementation Plan

### Phase 1: Core Sharing Infrastructure

- [ ] **1.1 Create sharing types** (`src/types/index.ts` additions or new `src/lib/sharing/types.ts`)
  - Define `TripSnapshot`, `TripChangeset`, `MergeConflict`, `MergeResult`, `ChangesetEntity` types
  - Define compact encoding key maps as const objects
  - Rationale: All subsequent work depends on a well-defined type contract

- [ ] **1.2 Implement snapshot/export service** (`src/lib/sharing/export.ts`)
  - `exportTripSnapshot(tripId): Promise<TripSnapshot>` — reads all entities for a trip from IndexedDB
  - `exportGuestChangeset(tripId, personId, baseSnapshotAt): Promise<TripChangeset>` — computes diff of what the guest added/modified since import
  - Rationale: Separates data gathering from encoding concerns

- [ ] **1.3 Implement encoding/compression utilities** (`src/lib/sharing/codec.ts`)
  - `compressChangeset(changeset: TripChangeset): Promise<string>` — minify keys → JSON.stringify → gzip via CompressionStream → base64url
  - `decompressChangeset(encoded: string): Promise<TripChangeset>` — reverse: base64url → gunzip via DecompressionStream → parse → expand keys
  - `estimateQrFrames(encoded: string): number` — calculate if multi-frame needed
  - Include fallback for browsers without CompressionStream (raw base64 without compression)
  - Rationale: Native browser compression keeps bundle small; base64url is QR-friendly

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
  - Validates that IDs don't collide with existing data
  - Updates trip's `updatedAt` timestamp
  - Rationale: Separating resolution from application enables preview/confirm UX

### Phase 2: QR Code Scanning Infrastructure

- [ ] **2.1 Add QR scanner dependency**
  - Add `html5-qrcode` (or equivalent lightweight scanner library) to `package.json`
  - This provides camera-based QR scanning capability for the import flow
  - Rationale: The app currently generates QR codes (`qrcode.react`) but cannot read them; a scanner is needed for the host to import guest changes

- [ ] **2.2 Create QR Scanner component** (`src/components/shared/QrScanner.tsx`)
  - Wraps the QR scanner library in a React component
  - Props: `onScan(data: string)`, `onError(error: Error)`, `active: boolean`
  - Handles camera permissions gracefully with user-friendly messages
  - Supports stopping/starting the camera
  - Mobile-first design (fullscreen viewfinder overlay)
  - Rationale: Reusable component for any future QR scanning needs

- [ ] **2.3 Create multi-frame QR display component** (`src/components/shared/AnimatedQrCode.tsx`)
  - For changesets that exceed single QR capacity
  - Splits encoded string into frames with header `{frame}:{total}:{data}`
  - Cycles display at configurable interval (default 300ms)
  - Shows progress indicator ("Frame 2/5")
  - Also provides "Copy to clipboard" fallback button
  - Rationale: Graceful handling of larger-than-QR payloads without requiring network

- [ ] **2.4 Create multi-frame QR scanner logic** (extend `QrScanner.tsx` or create `src/hooks/useMultiFrameQrScan.ts`)
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
  - Only visible to the trip "host" (or always visible since there's no auth distinction — the host is whoever has the trip)
  - Navigate to ImportScanPage
  - Rationale: Host needs a clear path to initiate the sync process

### Phase 5: Translation Keys

- [ ] **5.1 Add i18n keys for sharing sync**
  - Add keys under `sharing.sync.*` namespace in both `en/translation.json` and `fr/translation.json`
  - Keys needed: export preview labels, QR scanning instructions, merge review headers, conflict descriptions, resolution button labels, success/error messages, multi-frame progress
  - Rationale: All user-facing text must go through i18n per project conventions

### Phase 6: Testing

- [ ] **6.1 Unit tests for codec** (`src/lib/sharing/__tests__/codec.test.ts`)
  - Test compress/decompress round-trip
  - Test with various payload sizes
  - Test frame splitting logic
  - Test base64url encoding edge cases

- [ ] **6.2 Unit tests for merge engine** (`src/lib/sharing/__tests__/merge.test.ts`)
  - Test all merge scenarios from the matrix above
  - Test person deduplication by name
  - Test referential integrity warnings
  - Test concurrent modifications (both sides changed same entity)
  - Test empty changesets

- [ ] **6.3 Unit tests for export service** (`src/lib/sharing/__tests__/export.test.ts`)
  - Test snapshot creation with various entity counts
  - Test changeset computation (added vs modified detection)

- [ ] **6.4 Component tests for QR Scanner** (`src/components/shared/__tests__/QrScanner.test.tsx`)
  - Test camera permission handling
  - Test scan success callback
  - Test error states

- [ ] **6.5 Component tests for merge review UI** (`src/features/sharing/pages/__tests__/MergeReviewPage.test.tsx`)
  - Test rendering of auto-applied, conflicts, warnings sections
  - Test conflict resolution flow
  - Test apply button state management

- [ ] **6.6 E2E test for full sync flow** (`e2e/sharing-sync.spec.ts`)
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
- Compressed changesets for a typical guest (1 person, 1-2 rooms, 2 transports) fit in a single QR code

## Potential Risks and Mitigations

1. **QR code capacity exceeded for large changesets**
   Mitigation: Multi-frame animated QR + "Copy as text" fallback. Typical guest changesets (1 person + 2 assignments + 2 transports) should be ~500-800 bytes compressed, well within single QR limits.

2. **Browser CompressionStream not supported**
   Mitigation: Feature-detect CompressionStream; fallback to uncompressed base64 (larger but still works). CompressionStream is supported in Chrome 80+, Firefox 113+, Safari 16.4+ — covers >95% of mobile browsers.

3. **ID collisions when importing guest-created entities**
   Mitigation: The merge engine generates new IDs for imported entities and maintains an ID mapping table for referential integrity (e.g., if a guest-created person is referenced by a guest-created transport).

4. **Stale guest data after host made structural changes**
   Mitigation: The merge engine checks referential integrity — if a guest's room assignment references a room the host deleted, it surfaces as a warning rather than silently failing.

5. **Camera permissions denied for QR scanning**
   Mitigation: The "Paste text" tab provides a non-camera alternative. Clear permission-request messaging in the scan UI.

6. **Guest modifies entities they shouldn't (other people's data)**
   Mitigation: The changeset is scoped to the guest's `personId`. The merge engine can optionally filter to only accept changes related to the exporting person (their person record, their assignments, their transports). Flag changes to other people's data as requiring explicit host approval.

## Alternative Approaches

1. **WebRTC peer-to-peer sync**: Real-time but requires both devices online simultaneously and complex connection negotiation. Overkill for async exchange.

2. **Bluetooth/NFC transfer**: Platform-dependent, requires native APIs not available in PWA context. Not viable.

3. **Full trip in QR (paginated)**: Export the entire trip state as multi-frame QR. Simpler logic but much larger payload, slower scanning, and no selective merge.

4. **Clipboard-only (no QR)**: Copy/paste base64 encoded changeset via messaging app. Works but poor UX. Kept as fallback within the QR approach.

5. **CRDTs (Conflict-free Replicated Data Types)**: Theoretically elegant for P2P sync, but adds significant complexity to the data model (vector clocks, operation logs). Better suited for the future PostgreSQL backend phase. The current changeset model is simpler and sufficient for the described workflow.

## File Structure

```
src/lib/sharing/
├── types.ts          # TripSnapshot, TripChangeset, MergeResult types
├── codec.ts          # compress/decompress, frame splitting, base64url
├── export.ts         # exportTripSnapshot, exportGuestChangeset
├── merge.ts          # mergeChangeset (pure logic)
├── apply.ts          # applyMergeResult (Dexie transaction)
├── key-maps.ts       # Compact key abbreviation maps
└── __tests__/
    ├── codec.test.ts
    ├── merge.test.ts
    └── export.test.ts

src/components/shared/
├── QrScanner.tsx
└── AnimatedQrCode.tsx

src/features/sharing/
├── pages/
│   ├── GuestExportPage.tsx
│   ├── ImportScanPage.tsx
│   └── MergeReviewPage.tsx
└── components/
    ├── MergeConflictCard.tsx
    └── MergePreviewList.tsx
```
