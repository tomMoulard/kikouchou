# Trip Import from Previous Location

## Objective

When creating a new trip, allow the user to type a location in the location field and see a dropdown of previous trips at matching locations. Selecting a previous trip imports its configuration (location, description, coordinates, and rooms) into the new trip, saving the user from re-entering data for recurring destinations (e.g., a family vacation home).

## Context & Architecture Analysis

### Current State
- **TripForm** (`src/features/trips/components/TripForm.tsx:149-628`) is a controlled `memo` component used for both create and edit modes. The location field is a plain `<Input>` at lines 462-472.
- **TripCreatePage** (`src/features/trips/pages/TripCreatePage.tsx:43-125`) wraps TripForm, handles `createTrip()` from the repository, then navigates to the calendar.
- **Trip entity** (`src/types/index.ts:192-244`) has `location?`, `description?`, and `coordinates?` fields.
- **Room entity** (`src/types/index.ts:267-302`) has `name`, `capacity`, `description?`, `icon?`, `order`, scoped via `tripId`.
- **Room repository** (`src/lib/db/repositories/room-repository.ts`) provides `getRoomsByTripId()` and `createRoom()`.
- **Trip repository** (`src/lib/db/repositories/trip-repository.ts`) provides `getAllTrips()` (ordered by startDate desc).
- **Database** (`src/lib/db/database.ts`) has no `location` index on trips, and the location field is optional.
- **UI components available**: `Popover`, `Input`, `Button`, `Card`, `Badge`, `Dialog`, `Select`, `DropdownMenu`. Notably, **no `Command`/`Combobox` component** exists yet.
- **i18n**: All user-facing strings via `t()`, translation files at `src/locales/{en,fr}/translation.json`.

### What Gets Imported
When the user selects a previous trip to import from:
1. **Trip-level data**: `location`, `description`, `coordinates` (pre-fill the form fields)
2. **Rooms**: All rooms from the source trip (cloned with new IDs after trip creation)

**Not imported** (trip-specific): persons, room assignments, transports, dates.

---

## Implementation Plan

### Phase 1: Data Layer — Query Function for Location Matching

- [ ] **1.1** Create a new function `getTripsByLocation(query: string): Promise<Trip[]>` in `src/lib/db/repositories/trip-repository.ts`. This function should:
  - Accept a search string and return trips whose `location` field contains the query (case-insensitive)
  - Use `db.trips.filter()` since Dexie does not support case-insensitive substring indexes natively
  - Deduplicate results by normalized location string (so "Beach house, Brittany" appears once even if there are 3 trips there), returning the most recent trip per unique location
  - Return results ordered by `startDate` descending (most recent trip first)
  - Limit to a reasonable count (e.g., 10 suggestions)
  
  **Rationale**: This provides the data backbone for the autocomplete. Filtering client-side is acceptable since the total trip count per user will be small (tens, not thousands).

- [ ] **1.2** Create a new function `cloneRoomsToTrip(sourceTripId: TripId, targetTripId: TripId): Promise<Room[]>` in `src/lib/db/repositories/room-repository.ts`. This function should:
  - Fetch all rooms from the source trip via `getRoomsByTripId(sourceTripId)`
  - For each room, call `createRoom(targetTripId, { name, capacity, description, icon })` to create a clone with a new ID and proper order
  - Wrap in a Dexie transaction for atomicity
  - Return the newly created rooms
  
  **Rationale**: Rooms need new IDs and must be scoped to the new trip. Using `createRoom()` ensures proper ID generation, sanitization, and order assignment.

- [ ] **1.3** Export the new functions from `src/lib/db/index.ts` barrel file by adding `getTripsByLocation` to the trip repository exports and `cloneRoomsToTrip` to the room repository exports.

### Phase 2: UI Component — Location Autocomplete with Import Suggestion

- [ ] **2.1** Install the shadcn/ui `Command` (cmdk) component by running `bunx shadcn@latest add command`, which creates `src/components/ui/command.tsx`. This provides the accessible combobox/autocomplete primitive used elsewhere in the shadcn ecosystem.

  **Rationale**: The `Command` component (built on cmdk) provides keyboard navigation, accessible ARIA attributes, search filtering, and a dropdown overlay — all needed for the location autocomplete. This follows the project convention of using shadcn/ui primitives.

- [ ] **2.2** Create a new component `LocationAutocomplete` at `src/features/trips/components/LocationAutocomplete.tsx`. This component should:
  - Accept props: `value: string`, `onChange: (value: string) => void`, `onImportTrip: (trip: Trip) => void`, `disabled?: boolean`, `placeholder?: string`
  - Render an `Input` for typing the location (preserving the current UX for free-text entry)
  - On input change with a debounce (~300ms), call `getTripsByLocation(query)` to fetch matching previous trips
  - Display a floating dropdown (using `Popover` or the `Command` popover pattern) below the input showing matching trips with their name, location, and date range
  - Each suggestion row shows: location (bold), trip name (muted), date range (muted), and an "Import" button/action
  - Clicking a suggestion triggers `onImportTrip(trip)` — the parent decides what to do with it
  - The dropdown only appears when there are matches AND the input has focus AND at least 2 characters are typed
  - Pressing Escape or clicking outside closes the dropdown
  - Fully accessible: `role="listbox"`, `aria-expanded`, `aria-activedescendant` for keyboard nav
  - All strings via `t()` with new i18n keys
  
  **Rationale**: Keeping this as a separate component maintains TripForm's simplicity and allows reuse in edit mode if desired later.

- [ ] **2.3** Add an `ImportConfirmDialog` section within the `LocationAutocomplete` or as a sibling component. When the user clicks "Import" on a suggestion:
  - Show a lightweight confirmation indicating what will be imported: "Import location details and N rooms from [Trip Name]?"
  - List the rooms that will be cloned (names + capacities)
  - Provide "Import" and "Cancel" buttons
  - Use the existing shadcn `Dialog` component
  
  **Rationale**: Importing rooms is a significant action; a confirmation prevents accidental overwrites and gives the user visibility into what will happen.

### Phase 3: Integration into TripForm

- [ ] **3.1** Modify `TripForm` (`src/features/trips/components/TripForm.tsx`) to:
  - Replace the plain `<Input>` for location (lines 462-472) with the new `LocationAutocomplete` component
  - Add a new prop `onImportFromTrip?: (tripId: TripId) => void` to TripFormProps (lines 52-61) for signaling the parent that rooms should be cloned after trip creation
  - Add state `importSourceTripId: TripId | null` to track which trip was selected for import
  - When `onImportTrip` fires from `LocationAutocomplete`:
    - Pre-fill the `location` field with the source trip's location
    - Pre-fill the `description` field with the source trip's description (if present and current description is empty)
    - Store the `coordinates` for inclusion in the submitted `TripFormData`
    - Set `importSourceTripId` to the source trip's ID
    - Show a visual indicator (e.g., a `Badge` or info bar) confirming "Importing from [Trip Name]" with an "x" to cancel the import
  - Pass `importSourceTripId` up via the new `onImportFromTrip` callback when the form submits successfully
  - Extend `TripFormData` or use a separate callback so the parent knows to clone rooms
  
  **Rationale**: The form handles field pre-filling (its domain), while the parent page handles the room cloning (business logic), maintaining separation of concerns.

- [ ] **3.2** Modify `TripCreatePage` (`src/features/trips/pages/TripCreatePage.tsx`) to:
  - Accept the `importSourceTripId` from TripForm (via callback or extended submit data)
  - After `createTrip(data)` succeeds (line 69), if `importSourceTripId` is set, call `cloneRoomsToTrip(importSourceTripId, newTrip.id)`
  - Handle errors from room cloning gracefully (trip is created, rooms fail = show warning toast but still navigate)
  - Update the success toast to indicate import: `t('trips.createdWithImport', 'Trip created with rooms imported')`
  
  **Rationale**: The page is the right place for orchestrating multi-repository writes. If room cloning fails, the trip is still valid.

### Phase 4: Internationalization

- [ ] **4.1** Add new translation keys to `src/locales/en/translation.json` under the `trips` section:
  - `trips.importFrom`: "Import from previous trip"
  - `trips.importSuggestion`: "Previously used location"
  - `trips.importConfirm`: "Import from \"{{tripName}}\"?"
  - `trips.importConfirmDescription`: "This will pre-fill the location, description, and copy {{roomCount}} room(s) to your new trip."
  - `trips.importAction`: "Import"
  - `trips.importCancel`: "Cancel"
  - `trips.importedFrom`: "Importing from {{tripName}}"
  - `trips.removeImport`: "Remove import"
  - `trips.createdWithImport`: "Trip created with rooms imported"
  - `trips.importRoomsFailed`: "Trip created but room import failed"
  - `trips.noMatchingLocations`: "No matching previous locations"

- [ ] **4.2** Add corresponding French translations to `src/locales/fr/translation.json`:
  - `trips.importFrom`: "Importer d'un voyage precedent"
  - `trips.importSuggestion`: "Lieu deja utilise"
  - `trips.importConfirm`: "Importer depuis \"{{tripName}}\" ?"
  - `trips.importConfirmDescription`: "Cela pre-remplira le lieu, la description, et copiera {{roomCount}} chambre(s) dans votre nouveau voyage."
  - `trips.importAction`: "Importer"
  - `trips.importCancel`: "Annuler"
  - `trips.importedFrom`: "Import depuis {{tripName}}"
  - `trips.removeImport`: "Annuler l'import"
  - `trips.createdWithImport`: "Voyage cree avec les chambres importees"
  - `trips.importRoomsFailed`: "Voyage cree mais l'import des chambres a echoue"
  - `trips.noMatchingLocations`: "Aucun lieu correspondant"

### Phase 5: Testing

- [ ] **5.1** Add unit tests for `getTripsByLocation()` in `src/lib/db/repositories/__tests__/trip-repository.test.ts`:
  - Test case-insensitive matching
  - Test deduplication by location
  - Test that results are ordered by most recent first
  - Test empty query returns no results
  - Test minimum character threshold

- [ ] **5.2** Add unit tests for `cloneRoomsToTrip()` in `src/lib/db/repositories/__tests__/room-repository.test.ts`:
  - Test that rooms are cloned with new IDs
  - Test that room properties (name, capacity, description, icon) are preserved
  - Test that order is maintained
  - Test cloning from a trip with no rooms returns empty array
  - Test that the target trip's existing rooms are not affected

- [ ] **5.3** Add component tests for `LocationAutocomplete` in `src/features/trips/components/__tests__/LocationAutocomplete.test.tsx`:
  - Test rendering with empty value
  - Test that typing triggers search after debounce
  - Test dropdown appears with matching results
  - Test selecting a suggestion fires `onImportTrip`
  - Test keyboard navigation (arrow keys, enter, escape)
  - Test accessibility attributes (aria-expanded, role)
  - Test that the dropdown closes on blur/escape

- [ ] **5.4** Update existing `TripForm` tests in `src/features/trips/components/__tests__/TripForm.test.tsx`:
  - Add test for location field rendering the autocomplete variant
  - Test import badge display and removal
  - Test form submission includes import source ID when set
  - Test that pre-filled fields from import are included in submission

- [ ] **5.5** Add E2E test in `e2e/trip-import.spec.ts`:
  - Create a trip with rooms at a specific location
  - Create a second trip, type the same location
  - Verify the suggestion dropdown appears
  - Select the import option
  - Verify form fields are pre-filled
  - Submit and verify rooms were cloned to the new trip

### Phase 6: Feature Barrel Export

- [ ] **6.1** Export `LocationAutocomplete` from `src/features/trips/index.ts` barrel file for potential reuse.

---

## Verification Criteria

- Typing a location that matches a previous trip's location shows a suggestion dropdown
- Selecting a suggestion pre-fills location, description, and coordinates in the form
- After trip creation, rooms from the source trip are cloned to the new trip with correct properties
- The feature works in both English and French
- Free-text location entry still works (no regression — user can ignore suggestions)
- Keyboard navigation works for the autocomplete dropdown
- Room cloning failure does not prevent trip creation
- Import can be canceled/removed before submission
- All existing TripForm tests continue to pass
- New unit, component, and E2E tests pass

## Potential Risks and Mitigations

1. **Performance with many trips**
   Mitigation: `getTripsByLocation` uses client-side filtering which is fine for the expected scale (tens of trips). If needed later, a Dexie `location` index could be added in a schema v4 migration.

2. **Stale import data if source trip is modified between selection and submission**
   Mitigation: Room cloning reads the source trip's rooms at submission time (not at selection time for rooms). Trip-level fields (location, description) are copied into the form state immediately, so the user can review/edit before submitting.

3. **Command component dependency (cmdk)**
   Mitigation: cmdk is already a dependency of the shadcn/ui ecosystem, well-maintained, and lightweight. Alternatively, the autocomplete can be built with `Popover` + custom listbox if adding cmdk is undesirable.

4. **Dirty state tracking may trigger from import pre-fill**
   Mitigation: The import pre-fill sets form state which will make `isDirty` true. This is correct behavior — the user has made a meaningful change to the form.

5. **Accessibility of autocomplete**
   Mitigation: Using cmdk (via shadcn Command) provides built-in ARIA patterns. Manual testing with screen reader recommended in the E2E phase.

## Alternative Approaches

1. **Full "duplicate trip" button on trip list**: Instead of inline autocomplete, add a "Duplicate" action to existing trip cards. Simpler but less discoverable during creation flow and doesn't connect the location-matching concept.

2. **Popover search without cmdk**: Build the dropdown manually with `Popover` + `ul/li` + custom keyboard handling. Avoids a new dependency but requires more code and is harder to make fully accessible.

3. **Import as a separate step**: After creating a blank trip, show an "Import from..." dialog. Simpler TripForm changes but worse UX — the user has already moved past the creation screen.

4. **Location field as a Select/Combobox of previous locations**: Replace free-text with a combobox that also allows free input. Tighter UX but removes the "import rooms" dimension and forces all locations through the combobox pattern.
