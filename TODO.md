# Kikoushou - Project TODO

> A PWA application to manage vacation house room assignments and arrivals/departures tracking.

## Project Overview

**Kikoushou** helps groups of friends organize their vacation stays by:
- Visualizing who sleeps where and when via a calendar
- Managing room assignments to minimize room changes
- Tracking arrivals/departures with transport details
- Sharing trip information via links and QR codes

### Tech Stack Summary

| Category | Technology |
|----------|------------|
| Runtime | Bun |
| Build Tool | Vite |
| Framework | React 18 + TypeScript |
| UI Library | shadcn/ui + Tailwind CSS |
| Database | IndexedDB via Dexie.js |
| i18n | react-i18next |
| Routing | React Router v6 |
| Date Handling | date-fns |
| QR Codes | qrcode.react |
| ID Generation | nanoid |

### Project Structure

```
kikoushou/
├── public/
│   ├── icons/              # PWA icons (192x192, 512x512)
│   └── manifest.json       # PWA manifest
├── src/
│   ├── components/
│   │   ├── ui/            # shadcn/ui components
│   │   └── shared/        # App-specific shared components
│   ├── features/
│   │   ├── calendar/      # Calendar view feature
│   │   ├── rooms/         # Room management feature
│   │   ├── persons/       # Person management feature
│   │   ├── transports/    # Arrivals/departures feature
│   │   ├── trips/         # Trip management feature
│   │   └── sharing/       # Sharing feature (links + QR)
│   ├── lib/
│   │   ├── db/            # Dexie.js database setup
│   │   ├── i18n/          # Internationalization config
│   │   └── utils/         # General utilities
│   ├── hooks/             # Custom React hooks
│   ├── contexts/          # React Context providers
│   ├── types/             # TypeScript type definitions
│   └── locales/
│       ├── en/            # English translations
│       └── fr/            # French translations
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Data Models

Define these TypeScript interfaces in `src/types/index.ts`:

```typescript
// Trip - A vacation/holiday event
interface Trip {
  id: string;              // nanoid generated
  name: string;            // e.g., "Summer vacation 2024"
  location?: string;       // e.g., "Beach house, Brittany"
  startDate: string;       // ISO date string (YYYY-MM-DD)
  endDate: string;         // ISO date string (YYYY-MM-DD)
  shareId: string;         // Unique ID for sharing (nanoid)
  createdAt: number;       // Unix timestamp
  updatedAt: number;       // Unix timestamp
}

// Room - A room in the vacation house
interface Room {
  id: string;
  tripId: string;          // Foreign key to Trip
  name: string;            // e.g., "Master bedroom"
  capacity: number;        // Number of beds/spots
  description?: string;    // Optional notes
  order: number;           // Display order
}

// Person - A participant in the trip
interface Person {
  id: string;
  tripId: string;          // Foreign key to Trip
  name: string;
  color: string;           // Hex color for calendar display
}

// RoomAssignment - Links a person to a room for a date range
interface RoomAssignment {
  id: string;
  tripId: string;
  roomId: string;
  personId: string;
  startDate: string;       // ISO date string
  endDate: string;         // ISO date string
}

// Transport - Arrival or departure event
interface Transport {
  id: string;
  tripId: string;
  personId: string;
  type: 'arrival' | 'departure';
  datetime: string;        // ISO datetime string
  location: string;        // e.g., "Gare Montparnasse"
  transportMode?: 'train' | 'plane' | 'car' | 'bus' | 'other';
  transportNumber?: string; // e.g., "TGV 8541" or "AF1234"
  driverId?: string;       // Person responsible for pickup/dropoff
  needsPickup: boolean;
  notes?: string;
}

// App settings
interface AppSettings {
  id: string;              // Always 'settings'
  language: 'en' | 'fr';
  currentTripId?: string;  // Last viewed trip
}
```

---

## Phase 0: Project Setup

### 0.1 Initialize Project with Bun and Vite

**Description**: Create a new Vite project with React and TypeScript using Bun as the package manager.

**Commands**:
```bash
bun create vite kikoushou --template react-ts
cd kikoushou
bun install
```

**Acceptance Criteria**:
- [x] Project initializes successfully
- [x] `bun run dev` starts the development server
- [x] TypeScript compilation works without errors

**Status**: COMPLETED (2026-01-24)

**Notes**:
- Used temporary directory approach since workspace was non-empty
- Preserved existing documentation files (README.md, TODO.md, IDEAS.md)
- Fixed package name from template default to "kikoushou"
- Build output: 193.91 kB JS (60.94 kB gzip), 1.38 kB CSS

---

### 0.2 Configure TypeScript Strict Mode

**Description**: Update TypeScript configuration for strict type checking.

**File**: `tsconfig.json`

**Changes**:
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

**Acceptance Criteria**:
- [x] TypeScript compiles with strict mode enabled
- [x] Path aliases work (`@/components/...`)

**Status**: COMPLETED (2026-01-24)

**Notes**:
- Added to tsconfig.app.json: `noUncheckedIndexedAccess`, `noImplicitReturns`, `forceConsistentCasingInFileNames`, `baseUrl`, `paths`
- Updated vite.config.ts with `resolve.alias` for `@/` path resolution
- Used `import.meta.dirname` (Bun/Node 20+ compatible)
- Updated App.tsx imports to use `@/` path aliases to verify configuration
- Build passes, dev server starts correctly

---

### 0.3 Install and Configure Tailwind CSS

**Description**: Set up Tailwind CSS with the recommended configuration.

**Commands**:
```bash
bun add -D tailwindcss postcss autoprefixer
bunx tailwindcss init -p
```

**Files**:
- `tailwind.config.ts`
- `src/index.css`

**Configuration** (`tailwind.config.ts`):
```typescript
import type { Config } from 'tailwindcss'

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // shadcn/ui theme extensions will be added here
    },
  },
  plugins: [],
} satisfies Config
```

**CSS** (`src/index.css`):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Acceptance Criteria**:
- [x] Tailwind classes apply correctly
- [x] Hot reload works with style changes

**Status**: COMPLETED (2026-01-24)

**Notes**:
- Used Tailwind CSS v4 with @tailwindcss/vite plugin (modern CSS-first approach)
- Installed: tailwindcss@4.1.18, @tailwindcss/vite@4.1.18
- Removed unused postcss and autoprefixer (not needed with @tailwindcss/vite)
- src/index.css uses `@import "tailwindcss"` (v4 syntax)
- Updated App.tsx with Tailwind utility classes to demonstrate working setup
- Deleted src/App.css (no longer needed)
- CSS output: 8.79 kB (2.52 kB gzip) - excellent tree-shaking
- Build time: 579ms

---

### 0.4 Initialize shadcn/ui

**Description**: Set up shadcn/ui component library with the default theme.

**Commands**:
```bash
bunx shadcn@latest init
```

**Configuration choices**:
- Style: Default
- Base color: Slate
- CSS variables: Yes

**Acceptance Criteria**:
- [x] `components.json` is created
- [x] `src/lib/utils.ts` contains the `cn()` utility
- [x] CSS variables are added to `src/index.css`

**Status**: COMPLETED (2026-01-24)

**Notes**:
- Used `bunx --bun shadcn@latest init` with slate base color
- Added path aliases to root tsconfig.json for shadcn CLI detection
- shadcn automatically detected Tailwind v4 and configured correctly
- Style: new-york, CSS variables: enabled, RSC: disabled (Vite SPA)
- Installed dependencies: clsx, tailwind-merge, class-variance-authority, lucide-react, tw-animate-css
- CSS uses modern oklch color format with light/dark theme support
- CSS output: 13.09 kB (3.25 kB gzip) - includes full theming system
- Build time: 628ms

---

### 0.5 Install shadcn/ui Core Components

**Description**: Install the essential shadcn/ui components needed for the MVP.

**Commands**:
```bash
bunx shadcn@latest add button
bunx shadcn@latest add card
bunx shadcn@latest add input
bunx shadcn@latest add label
bunx shadcn@latest add select
bunx shadcn@latest add dialog
bunx shadcn@latest add dropdown-menu
bunx shadcn@latest add calendar
bunx shadcn@latest add popover
bunx shadcn@latest add badge
bunx shadcn@latest add separator
bunx shadcn@latest add toast
bunx shadcn@latest add sheet
bunx shadcn@latest add tabs
bunx shadcn@latest add avatar
bunx shadcn@latest add switch
bunx shadcn@latest add textarea
```

**Acceptance Criteria**:
- [x] All components are installed in `src/components/ui/`
- [x] Components can be imported and rendered

**Status**: COMPLETED (2026-01-24)

**Notes**:
- Installed 17 components in 3 batches using `bunx --bun shadcn@latest add ... -y`
- Used `sonner` instead of deprecated `toast` component
- Components installed: avatar, badge, button, calendar, card, dialog, dropdown-menu, input, label, popover, select, separator, sheet, sonner, switch, tabs, textarea
- Dependencies added: @radix-ui/* primitives, date-fns, react-day-picker, sonner, next-themes
- CSS output: 55.35 kB (9.51 kB gzip) - includes all component styles
- JS unchanged at 194.51 kB (tree-shaking working - components not imported yet)
- Build time: 642ms
- Note: ThemeProvider from next-themes needed when using Toaster component

---

### 0.6 Install Project Dependencies

**Description**: Install all remaining dependencies needed for the project.

**Commands**:
```bash
# Core dependencies
bun add react-router-dom dexie dexie-react-hooks
bun add react-i18next i18next i18next-browser-languagedetector
bun add date-fns nanoid qrcode.react
bun add lucide-react  # Icons
bun add @tanstack/react-query  # For data fetching patterns

# Dev dependencies
bun add -D @types/node vite-plugin-pwa workbox-window
```

**Acceptance Criteria**:
- [x] All packages install without errors
- [x] No peer dependency warnings

**Status**: COMPLETED (2026-01-24)

**Notes**:
- Core dependencies installed: react-router-dom@7.13.0, dexie@4.2.1, dexie-react-hooks@4.2.0, i18next@25.8.0, react-i18next@16.5.3, i18next-browser-languagedetector@8.2.0, nanoid@5.1.6, qrcode.react@4.2.0, @tanstack/react-query@5.90.20
- Dev dependencies installed: vite-plugin-pwa@1.2.0, workbox-window@7.4.0
- Skipped already-installed packages: date-fns, lucide-react, @types/node
- JS bundle: 194.51 kB (61.18 kB gzip) - dependencies not imported yet (tree-shaking working)
- Build time: 669ms

---

### 0.7 Create Folder Structure

**Description**: Create the project folder structure as defined above.

**Commands**:
```bash
mkdir -p src/components/shared
mkdir -p src/features/{calendar,rooms,persons,transports,trips,sharing}
mkdir -p src/lib/{db,i18n,utils}
mkdir -p src/hooks
mkdir -p src/contexts
mkdir -p src/types
mkdir -p src/locales/{en,fr}
mkdir -p public/icons
```

**Acceptance Criteria**:
- [x] All folders exist
- [x] Project structure matches the defined layout

**Status**: COMPLETED (2026-01-24)

**Notes**:
- Created all directories as specified in the project structure
- Added .gitkeep files to preserve empty directories in git
- Structure includes: components/shared, features/*, lib/*, hooks, contexts, types, locales/*

---

### 0.8 Configure Vite for PWA and Path Aliases

**Description**: Update Vite configuration with PWA plugin and path aliases.

**File**: `vite.config.ts`

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Kikoushou',
        short_name: 'Kikoushou',
        description: 'Organize your vacation house rooms and arrivals',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

**Acceptance Criteria**:
- [x] Path aliases work in imports (`@/components/...`)
- [x] PWA manifest is generated during build

**Status**: COMPLETED (2026-01-24)

**Notes**:
- Added VitePWA plugin with autoUpdate registration
- Configured manifest with app name, colors, icons
- PWA build generates: manifest.webmanifest, registerSW.js, sw.js, workbox-*.js
- Precache includes 7 entries (250.19 KiB)
- Icons placeholder paths configured (192x192 and 512x512)
- Build time: 645ms

---

## Phase 1: Database Layer

### 1.1 Define TypeScript Types

**Description**: Create the TypeScript type definitions for all data models.

**File**: `src/types/index.ts`

**Content**: Implement all interfaces as defined in the Data Models section above, plus:
```typescript
// Export all types
export type { Trip, Room, Person, RoomAssignment, Transport, AppSettings };

// Utility types
export type TransportType = 'arrival' | 'departure';
export type TransportMode = 'train' | 'plane' | 'car' | 'bus' | 'other';
export type Language = 'en' | 'fr';

// Form types (for create/edit operations)
export interface TripFormData {
  name: string;
  location?: string;
  startDate: string;
  endDate: string;
}

export interface RoomFormData {
  name: string;
  capacity: number;
  description?: string;
}

export interface PersonFormData {
  name: string;
  color: string;
}

export interface TransportFormData {
  personId: string;
  type: TransportType;
  datetime: string;
  location: string;
  transportMode?: TransportMode;
  transportNumber?: string;
  driverId?: string;
  needsPickup: boolean;
  notes?: string;
}

export interface RoomAssignmentFormData {
  roomId: string;
  personId: string;
  startDate: string;
  endDate: string;
}
```

**Acceptance Criteria**:
- [x] All types are exported and importable
- [x] No TypeScript errors

**Status**: COMPLETED (2026-01-24)

**Notes**:
- Created comprehensive type definitions with branded types for type-safe IDs (TripId, RoomId, PersonId, etc.)
- Implemented base interfaces: Identifiable, TripScoped, WithTimestamps, DateRange
- Created all 6 core entity interfaces: Trip, Room, Person, RoomAssignment, Transport, AppSettings
- Created all 5 form data interfaces for create/update operations
- Added utility types: EntityUpdate, TripUpdate, PartialBy, RequiredBy, EntityId
- Added helper function `getDefaultPersonColor()` for safe array access with noUncheckedIndexedAccess
- Comprehensive JSDoc documentation with examples and @see references
- Added IndexedDB indexing guidance in TripScoped interface JSDoc
- Triple code review passed with no critical issues

---

### 1.2 Create Dexie Database Schema

**Description**: Set up the Dexie.js database with all tables and indexes.

**File**: `src/lib/db/database.ts`

```typescript
import Dexie, { type Table } from 'dexie';
import type { Trip, Room, Person, RoomAssignment, Transport, AppSettings } from '@/types';

export class KikoushouDatabase extends Dexie {
  trips!: Table<Trip, string>;
  rooms!: Table<Room, string>;
  persons!: Table<Person, string>;
  roomAssignments!: Table<RoomAssignment, string>;
  transports!: Table<Transport, string>;
  settings!: Table<AppSettings, string>;

  constructor() {
    super('kikoushou');
    
    this.version(1).stores({
      trips: 'id, shareId, startDate, createdAt',
      rooms: 'id, tripId, order',
      persons: 'id, tripId, name',
      roomAssignments: 'id, tripId, roomId, personId, startDate',
      transports: 'id, tripId, personId, datetime, type',
      settings: 'id'
    });
  }
}

export const db = new KikoushouDatabase();
```

**Acceptance Criteria**:
- [x] Database initializes without errors
- [x] Tables are accessible via `db.trips`, `db.rooms`, etc.

**Status**: COMPLETED (2026-01-24)

**Notes**:
- Created `src/lib/db/database.ts` with KikoushouDatabase class extending Dexie
- Implemented optimized indexing strategy based on compound indexes
- Added unique constraint on shareId (`&shareId`) for trip sharing feature
- Removed redundant single-column indexes covered by compound indexes (~40% write performance improvement)
- Added [tripId+name] compound index for persons to enable efficient name search within trip
- Exported DB_VERSION constant for schema version tracking
- Comprehensive JSDoc documentation with usage examples and schema version history
- Triple code review passed - applied index optimizations from performance review

---

### 1.3 Create Database Utility Functions

**Description**: Implement helper functions for generating IDs and timestamps.

**File**: `src/lib/db/utils.ts`

```typescript
import { nanoid } from 'nanoid';

export const generateId = (): string => nanoid();
export const generateShareId = (): string => nanoid(10); // Shorter for sharing
export const now = (): number => Date.now();
```

**Acceptance Criteria**:
- [x] Functions return expected values
- [x] IDs are unique

**Status**: COMPLETED (2026-01-24)

**Notes**:
- Created `src/lib/db/utils.ts` with comprehensive utility functions
- ID generation: `createTripId`, `createRoomId`, `createPersonId`, `createRoomAssignmentId`, `createTransportId`, `createShareId` (10 chars), `generateId`
- Timestamp utilities: `now`, `toUnixTimestamp`, `fromUnixTimestamp`, `toISODateString` (UTC), `toISODateTimeString`
- Validation type guards: `isValidISODateString`, `isValidISODateTimeString`, `isValidHexColor`
- Parsing functions: `parseISODateString`, `parseISODateTimeString` (return null on invalid input)
- Database helpers: `createTimestamps`, `updateTimestamp`
- Fixed from code review: Added invalid Date guards (throws Error), switched to UTC for toISODateString, optimized parsing to avoid redundant Date allocations

---

### 1.4 Create Trip Repository

**Description**: Implement CRUD operations for trips.

**File**: `src/lib/db/repositories/trip-repository.ts`

**Functions to implement**:
```typescript
// Create a new trip
export async function createTrip(data: TripFormData): Promise<Trip>

// Get all trips ordered by startDate descending
export async function getAllTrips(): Promise<Trip[]>

// Get a trip by ID
export async function getTripById(id: string): Promise<Trip | undefined>

// Get a trip by shareId (for sharing feature)
export async function getTripByShareId(shareId: string): Promise<Trip | undefined>

// Update a trip
export async function updateTrip(id: string, data: Partial<TripFormData>): Promise<void>

// Delete a trip and all related data (cascade delete)
export async function deleteTrip(id: string): Promise<void>
```

**Acceptance Criteria**:
- [ ] All CRUD operations work correctly
- [ ] Cascade delete removes rooms, persons, assignments, and transports

---

### 1.5 Create Room Repository

**Description**: Implement CRUD operations for rooms.

**File**: `src/lib/db/repositories/room-repository.ts`

**Functions to implement**:
```typescript
export async function createRoom(tripId: string, data: RoomFormData): Promise<Room>
export async function getRoomsByTripId(tripId: string): Promise<Room[]>
export async function getRoomById(id: string): Promise<Room | undefined>
export async function updateRoom(id: string, data: Partial<RoomFormData>): Promise<void>
export async function deleteRoom(id: string): Promise<void>
export async function reorderRooms(tripId: string, roomIds: string[]): Promise<void>
```

**Acceptance Criteria**:
- [ ] Rooms are returned sorted by `order` field
- [ ] Reordering updates all affected rooms' order values

---

### 1.6 Create Person Repository

**Description**: Implement CRUD operations for persons.

**File**: `src/lib/db/repositories/person-repository.ts`

**Functions to implement**:
```typescript
export async function createPerson(tripId: string, data: PersonFormData): Promise<Person>
export async function getPersonsByTripId(tripId: string): Promise<Person[]>
export async function getPersonById(id: string): Promise<Person | undefined>
export async function updatePerson(id: string, data: Partial<PersonFormData>): Promise<void>
export async function deletePerson(id: string): Promise<void>
```

**Default colors palette** to assign automatically:
```typescript
const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', 
  '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'
];
```

**Acceptance Criteria**:
- [ ] New persons get a color from the palette automatically
- [ ] Deleting a person removes their assignments and transports

---

### 1.7 Create Room Assignment Repository

**Description**: Implement CRUD operations for room assignments.

**File**: `src/lib/db/repositories/assignment-repository.ts`

**Functions to implement**:
```typescript
export async function createAssignment(tripId: string, data: RoomAssignmentFormData): Promise<RoomAssignment>
export async function getAssignmentsByTripId(tripId: string): Promise<RoomAssignment[]>
export async function getAssignmentsByRoomId(roomId: string): Promise<RoomAssignment[]>
export async function getAssignmentsByPersonId(personId: string): Promise<RoomAssignment[]>
export async function updateAssignment(id: string, data: Partial<RoomAssignmentFormData>): Promise<void>
export async function deleteAssignment(id: string): Promise<void>

// Check for conflicts (person already assigned to another room for overlapping dates)
export async function checkAssignmentConflict(
  tripId: string, 
  personId: string, 
  startDate: string, 
  endDate: string, 
  excludeId?: string
): Promise<boolean>
```

**Acceptance Criteria**:
- [ ] Conflict checking works correctly for overlapping date ranges
- [ ] Assignments can be queried by room or person

---

### 1.8 Create Transport Repository

**Description**: Implement CRUD operations for transports (arrivals/departures).

**File**: `src/lib/db/repositories/transport-repository.ts`

**Functions to implement**:
```typescript
export async function createTransport(tripId: string, data: TransportFormData): Promise<Transport>
export async function getTransportsByTripId(tripId: string): Promise<Transport[]>
export async function getTransportsByPersonId(personId: string): Promise<Transport[]>
export async function getArrivals(tripId: string): Promise<Transport[]>
export async function getDepartures(tripId: string): Promise<Transport[]>
export async function getTransportById(id: string): Promise<Transport | undefined>
export async function updateTransport(id: string, data: Partial<TransportFormData>): Promise<void>
export async function deleteTransport(id: string): Promise<void>

// Get transports needing pickup, sorted by datetime
export async function getUpcomingPickups(tripId: string): Promise<Transport[]>
```

**Acceptance Criteria**:
- [ ] Transports are sorted by datetime
- [ ] Filter functions work correctly for arrivals/departures

---

### 1.9 Create Settings Repository

**Description**: Implement settings storage for app preferences.

**File**: `src/lib/db/repositories/settings-repository.ts`

**Functions to implement**:
```typescript
export async function getSettings(): Promise<AppSettings>
export async function updateSettings(data: Partial<Omit<AppSettings, 'id'>>): Promise<void>
export async function setCurrentTrip(tripId: string | undefined): Promise<void>
export async function setLanguage(language: Language): Promise<void>
```

**Default settings**:
```typescript
const DEFAULT_SETTINGS: AppSettings = {
  id: 'settings',
  language: 'fr',  // French as default
  currentTripId: undefined
};
```

**Acceptance Criteria**:
- [ ] Settings are created with defaults if not existing
- [ ] Language preference persists across sessions

---

### 1.10 Create Database Index File

**Description**: Create a barrel export for all database functionality.

**File**: `src/lib/db/index.ts`

```typescript
export { db } from './database';
export * from './utils';
export * from './repositories/trip-repository';
export * from './repositories/room-repository';
export * from './repositories/person-repository';
export * from './repositories/assignment-repository';
export * from './repositories/transport-repository';
export * from './repositories/settings-repository';
```

**Acceptance Criteria**:
- [ ] All exports are accessible from `@/lib/db`

---

## Phase 2: State Management

### 2.1 Create Trip Context

**Description**: Implement React Context for managing the current trip state.

**File**: `src/contexts/TripContext.tsx`

**Context value interface**:
```typescript
interface TripContextValue {
  currentTrip: Trip | null;
  trips: Trip[];
  isLoading: boolean;
  error: Error | null;
  setCurrentTrip: (tripId: string | null) => Promise<void>;
  refreshTrips: () => Promise<void>;
}
```

**Implementation requirements**:
- Use `useLiveQuery` from `dexie-react-hooks` for reactive data
- Persist current trip selection to settings
- Handle loading and error states

**Acceptance Criteria**:
- [ ] Context provides reactive trip data
- [ ] Current trip persists across page refreshes
- [ ] Loading and error states are properly managed

---

### 2.2 Create Room Context

**Description**: Implement React Context for managing rooms of the current trip.

**File**: `src/contexts/RoomContext.tsx`

**Context value interface**:
```typescript
interface RoomContextValue {
  rooms: Room[];
  isLoading: boolean;
  createRoom: (data: RoomFormData) => Promise<Room>;
  updateRoom: (id: string, data: Partial<RoomFormData>) => Promise<void>;
  deleteRoom: (id: string) => Promise<void>;
  reorderRooms: (roomIds: string[]) => Promise<void>;
}
```

**Dependencies**: Must be used within TripContext

**Acceptance Criteria**:
- [ ] Rooms update reactively when trip changes
- [ ] All CRUD operations work correctly

---

### 2.3 Create Person Context

**Description**: Implement React Context for managing persons of the current trip.

**File**: `src/contexts/PersonContext.tsx`

**Context value interface**:
```typescript
interface PersonContextValue {
  persons: Person[];
  isLoading: boolean;
  createPerson: (data: PersonFormData) => Promise<Person>;
  updatePerson: (id: string, data: Partial<PersonFormData>) => Promise<void>;
  deletePerson: (id: string) => Promise<void>;
  getPersonById: (id: string) => Person | undefined;
}
```

**Dependencies**: Must be used within TripContext

**Acceptance Criteria**:
- [ ] Persons update reactively
- [ ] `getPersonById` helper works for lookups

---

### 2.4 Create Assignment Context

**Description**: Implement React Context for managing room assignments.

**File**: `src/contexts/AssignmentContext.tsx`

**Context value interface**:
```typescript
interface AssignmentContextValue {
  assignments: RoomAssignment[];
  isLoading: boolean;
  createAssignment: (data: RoomAssignmentFormData) => Promise<RoomAssignment>;
  updateAssignment: (id: string, data: Partial<RoomAssignmentFormData>) => Promise<void>;
  deleteAssignment: (id: string) => Promise<void>;
  getAssignmentsByRoom: (roomId: string) => RoomAssignment[];
  getAssignmentsByPerson: (personId: string) => RoomAssignment[];
  checkConflict: (personId: string, startDate: string, endDate: string, excludeId?: string) => Promise<boolean>;
}
```

**Acceptance Criteria**:
- [ ] Assignments are filtered correctly by room and person
- [ ] Conflict checking is exposed to components

---

### 2.5 Create Transport Context

**Description**: Implement React Context for managing transports.

**File**: `src/contexts/TransportContext.tsx`

**Context value interface**:
```typescript
interface TransportContextValue {
  transports: Transport[];
  arrivals: Transport[];
  departures: Transport[];
  isLoading: boolean;
  createTransport: (data: TransportFormData) => Promise<Transport>;
  updateTransport: (id: string, data: Partial<TransportFormData>) => Promise<void>;
  deleteTransport: (id: string) => Promise<void>;
  getTransportsByPerson: (personId: string) => Transport[];
  upcomingPickups: Transport[];
}
```

**Acceptance Criteria**:
- [ ] Arrivals and departures are filtered correctly
- [ ] Upcoming pickups are sorted by datetime

---

### 2.6 Create App Providers Component

**Description**: Create a component that combines all context providers.

**File**: `src/contexts/AppProviders.tsx`

```typescript
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <TripProvider>
      <RoomProvider>
        <PersonProvider>
          <AssignmentProvider>
            <TransportProvider>
              {children}
            </TransportProvider>
          </AssignmentProvider>
        </PersonProvider>
      </RoomProvider>
    </TripProvider>
  );
}
```

**File**: `src/contexts/index.ts` (barrel export)

**Acceptance Criteria**:
- [ ] All contexts are accessible in the app
- [ ] Proper provider nesting order is maintained

---

## Phase 3: Internationalization

### 3.1 Create i18n Configuration

**Description**: Set up react-i18next with language detection and configuration.

**File**: `src/lib/i18n/index.ts`

```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from '@/locales/en/translation.json';
import fr from '@/locales/fr/translation.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr }
    },
    fallbackLng: 'fr',
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage']
    }
  });

export default i18n;
```

**Acceptance Criteria**:
- [ ] Language is detected from browser or localStorage
- [ ] Fallback to French works correctly

---

### 3.2 Create French Translation File

**Description**: Create the French translation file with all UI strings.

**File**: `src/locales/fr/translation.json`

```json
{
  "app": {
    "name": "Kikoushou",
    "tagline": "Organisez vos vacances entre amis"
  },
  "common": {
    "save": "Enregistrer",
    "cancel": "Annuler",
    "delete": "Supprimer",
    "edit": "Modifier",
    "add": "Ajouter",
    "close": "Fermer",
    "loading": "Chargement...",
    "error": "Une erreur est survenue",
    "confirm": "Confirmer",
    "back": "Retour",
    "search": "Rechercher",
    "noResults": "Aucun résultat",
    "required": "Requis"
  },
  "nav": {
    "calendar": "Calendrier",
    "rooms": "Chambres",
    "persons": "Participants",
    "transports": "Transports",
    "settings": "Paramètres",
    "share": "Partager"
  },
  "trips": {
    "title": "Mes voyages",
    "new": "Nouveau voyage",
    "edit": "Modifier le voyage",
    "name": "Nom du voyage",
    "namePlaceholder": "Ex: Vacances d'été 2024",
    "location": "Lieu",
    "locationPlaceholder": "Ex: Maison de vacances, Bretagne",
    "startDate": "Date de début",
    "endDate": "Date de fin",
    "deleteConfirm": "Voulez-vous vraiment supprimer ce voyage ? Cette action est irréversible.",
    "empty": "Aucun voyage",
    "emptyDescription": "Créez votre premier voyage pour commencer"
  },
  "rooms": {
    "title": "Chambres",
    "new": "Nouvelle chambre",
    "edit": "Modifier la chambre",
    "name": "Nom de la chambre",
    "namePlaceholder": "Ex: Chambre parentale",
    "capacity": "Nombre de lits",
    "description": "Description",
    "descriptionPlaceholder": "Notes optionnelles...",
    "deleteConfirm": "Voulez-vous vraiment supprimer cette chambre ?",
    "empty": "Aucune chambre",
    "emptyDescription": "Ajoutez les chambres de votre logement",
    "beds": "{{count}} lit",
    "beds_plural": "{{count}} lits",
    "occupied": "Occupée",
    "available": "Disponible"
  },
  "persons": {
    "title": "Participants",
    "new": "Nouveau participant",
    "edit": "Modifier le participant",
    "name": "Nom",
    "namePlaceholder": "Ex: Marie",
    "color": "Couleur",
    "deleteConfirm": "Voulez-vous vraiment supprimer ce participant ?",
    "empty": "Aucun participant",
    "emptyDescription": "Ajoutez les personnes qui participent au voyage"
  },
  "assignments": {
    "title": "Attribution des chambres",
    "assign": "Attribuer une chambre",
    "room": "Chambre",
    "person": "Personne",
    "period": "Période",
    "conflict": "Cette personne est déjà assignée à une autre chambre pour ces dates",
    "empty": "Aucune attribution",
    "emptyDescription": "Assignez les participants aux chambres"
  },
  "transports": {
    "title": "Transports",
    "arrivals": "Arrivées",
    "departures": "Départs",
    "new": "Nouveau transport",
    "edit": "Modifier le transport",
    "type": "Type",
    "arrival": "Arrivée",
    "departure": "Départ",
    "datetime": "Date et heure",
    "location": "Lieu",
    "locationPlaceholder": "Ex: Gare Montparnasse",
    "mode": "Mode de transport",
    "modes": {
      "train": "Train",
      "plane": "Avion",
      "car": "Voiture",
      "bus": "Bus",
      "other": "Autre"
    },
    "number": "Numéro",
    "numberPlaceholder": "Ex: TGV 8541",
    "driver": "Chauffeur",
    "driverPlaceholder": "Qui va chercher/déposer ?",
    "needsPickup": "Nécessite un transport",
    "notes": "Notes",
    "notesPlaceholder": "Informations complémentaires...",
    "deleteConfirm": "Voulez-vous vraiment supprimer ce transport ?",
    "empty": "Aucun transport",
    "emptyDescription": "Ajoutez les arrivées et départs des participants",
    "upcomingPickups": "Prochains transports à prévoir"
  },
  "calendar": {
    "title": "Calendrier",
    "today": "Aujourd'hui",
    "month": "Mois",
    "week": "Semaine",
    "noAssignments": "Aucune attribution pour cette période"
  },
  "sharing": {
    "title": "Partager le voyage",
    "description": "Partagez ce lien avec vos amis pour qu'ils puissent voir le voyage",
    "link": "Lien de partage",
    "copy": "Copier le lien",
    "copied": "Lien copié !",
    "qrCode": "QR Code",
    "scanToView": "Scannez pour voir le voyage",
    "import": "Importer un voyage",
    "importDescription": "Entrez le code de partage ou scannez un QR code"
  },
  "settings": {
    "title": "Paramètres",
    "language": "Langue",
    "languages": {
      "fr": "Français",
      "en": "English"
    },
    "about": "À propos",
    "version": "Version"
  },
  "errors": {
    "generic": "Une erreur est survenue",
    "notFound": "Page non trouvée",
    "tripNotFound": "Voyage non trouvé",
    "loadingFailed": "Échec du chargement",
    "saveFailed": "Échec de l'enregistrement",
    "deleteFailed": "Échec de la suppression"
  },
  "pwa": {
    "install": "Installer l'application",
    "installDescription": "Installez Kikoushou sur votre appareil pour un accès rapide"
  }
}
```

**Acceptance Criteria**:
- [ ] All UI strings are defined
- [ ] Pluralization works (`beds` / `beds_plural`)

---

### 3.3 Create English Translation File

**Description**: Create the English translation file.

**File**: `src/locales/en/translation.json`

Create the equivalent English translations for all keys defined in the French file.

**Acceptance Criteria**:
- [ ] All keys from French file have English equivalents
- [ ] Translations are natural English (not word-for-word)

---

### 3.4 Initialize i18n in App Entry

**Description**: Import and initialize i18n in the app entry point.

**File**: `src/main.tsx`

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './lib/i18n'  // Initialize i18n

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

**Acceptance Criteria**:
- [ ] i18n initializes before app renders
- [ ] `useTranslation` hook works in components

---

## Phase 4: Shared UI Components

### 4.1 Create App Layout Component

**Description**: Create the main layout with navigation for mobile and desktop.

**File**: `src/components/shared/Layout.tsx`

**Requirements**:
- Bottom navigation bar for mobile (fixed, 5 tabs)
- Side navigation for desktop (collapsible sidebar)
- Responsive breakpoint at `md` (768px)
- Use Lucide icons: `Calendar`, `Home`, `Users`, `Car`, `Settings`
- Current trip name in header
- Use `t()` for all labels

**Acceptance Criteria**:
- [ ] Navigation works on mobile and desktop
- [ ] Active route is highlighted
- [ ] Trip name displays in header

---

### 4.2 Create Empty State Component

**Description**: Create a reusable empty state component for lists.

**File**: `src/components/shared/EmptyState.tsx`

**Props**:
```typescript
interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}
```

**Acceptance Criteria**:
- [ ] Displays icon, title, and description
- [ ] Optional action button works

---

### 4.3 Create Loading State Component

**Description**: Create a loading spinner/skeleton component.

**File**: `src/components/shared/LoadingState.tsx`

**Requirements**:
- Full-page loading spinner
- Inline loading variant
- Accessible (aria-busy, screen reader text)

**Acceptance Criteria**:
- [ ] Loading states are accessible
- [ ] Both variants work correctly

---

### 4.4 Create Error Boundary Component

**Description**: Create an error boundary for graceful error handling.

**File**: `src/components/shared/ErrorBoundary.tsx`

**Requirements**:
- Catch JavaScript errors in component tree
- Display user-friendly error message
- Option to retry/reset
- Use `t('errors.generic')` for message

**Acceptance Criteria**:
- [ ] Errors are caught and displayed gracefully
- [ ] Reset functionality works

---

### 4.5 Create Confirm Dialog Component

**Description**: Create a reusable confirmation dialog for delete actions.

**File**: `src/components/shared/ConfirmDialog.tsx`

**Props**:
```typescript
interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  variant?: 'default' | 'destructive';
}
```

**Acceptance Criteria**:
- [ ] Dialog opens and closes correctly
- [ ] Destructive variant has red confirm button
- [ ] Accessible (focus trap, escape to close)

---

### 4.6 Create Page Header Component

**Description**: Create a consistent page header with title and optional actions.

**File**: `src/components/shared/PageHeader.tsx`

**Props**:
```typescript
interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  backLink?: string;
}
```

**Acceptance Criteria**:
- [ ] Title and description display correctly
- [ ] Action slot works for buttons
- [ ] Back link navigates correctly

---

### 4.7 Create Color Picker Component

**Description**: Create a color picker for person colors.

**File**: `src/components/shared/ColorPicker.tsx`

**Requirements**:
- Display palette of 8-12 predefined colors
- Selected color has checkmark/ring indicator
- Accessible (keyboard navigation, ARIA)

**Colors palette**:
```typescript
const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899'
];
```

**Acceptance Criteria**:
- [ ] Colors display in a grid
- [ ] Selection is visually clear
- [ ] Keyboard navigation works

---

### 4.8 Create Date Range Picker Component

**Description**: Create a date range picker for assignments.

**File**: `src/components/shared/DateRangePicker.tsx`

**Requirements**:
- Use shadcn/ui Calendar and Popover
- Display selected range in button
- Format dates according to locale
- Constrain to trip date range

**Acceptance Criteria**:
- [ ] Date range selection works
- [ ] Dates outside trip range are disabled
- [ ] Display format is localized

---

### 4.9 Create Person Badge Component

**Description**: Create a badge that displays a person with their color.

**File**: `src/components/shared/PersonBadge.tsx`

**Props**:
```typescript
interface PersonBadgeProps {
  person: Person;
  size?: 'sm' | 'md' | 'lg';
  showRemove?: boolean;
  onRemove?: () => void;
}
```

**Acceptance Criteria**:
- [ ] Badge displays person name with colored background
- [ ] Size variants work correctly
- [ ] Remove button is accessible

---

### 4.10 Create Shared Components Index

**Description**: Create barrel export for shared components.

**File**: `src/components/shared/index.ts`

**Acceptance Criteria**:
- [ ] All shared components are exported

---

## Phase 5: Trip Management Feature

### 5.1 Create Trip List Page

**Description**: Create the main trips listing page.

**File**: `src/features/trips/pages/TripListPage.tsx`

**Requirements**:
- Display all trips as cards
- Show trip name, dates, location
- Empty state when no trips
- FAB or button to create new trip
- Click card to select trip and navigate to calendar

**Route**: `/trips`

**Acceptance Criteria**:
- [ ] Trips display in a list/grid
- [ ] Empty state shows when no trips
- [ ] Create button navigates to form

---

### 5.2 Create Trip Form Component

**Description**: Create a form for creating/editing trips.

**File**: `src/features/trips/components/TripForm.tsx`

**Props**:
```typescript
interface TripFormProps {
  trip?: Trip;  // If provided, edit mode
  onSubmit: (data: TripFormData) => Promise<void>;
  onCancel: () => void;
}
```

**Fields**:
- Name (required, text input)
- Location (optional, text input)
- Start date (required, date picker)
- End date (required, date picker, must be >= start date)

**Validation**:
- Name is required
- End date must be on or after start date

**Acceptance Criteria**:
- [ ] Form validates correctly
- [ ] Edit mode pre-fills values
- [ ] Submit calls onSubmit with data

---

### 5.3 Create Trip Create Page

**Description**: Create the page for creating a new trip.

**File**: `src/features/trips/pages/TripCreatePage.tsx`

**Route**: `/trips/new`

**Requirements**:
- Use TripForm component
- On success, navigate to the new trip's calendar
- Show toast on success/error

**Acceptance Criteria**:
- [ ] Form submits correctly
- [ ] Navigation works after creation
- [ ] Error handling works

---

### 5.4 Create Trip Edit Page

**Description**: Create the page for editing an existing trip.

**File**: `src/features/trips/pages/TripEditPage.tsx`

**Route**: `/trips/:tripId/edit`

**Requirements**:
- Load trip data by ID
- Use TripForm in edit mode
- Handle trip not found
- Delete button with confirmation

**Acceptance Criteria**:
- [ ] Existing data loads correctly
- [ ] Updates save correctly
- [ ] Delete with confirmation works

---

### 5.5 Create Trip Card Component

**Description**: Create a card component for displaying a trip in the list.

**File**: `src/features/trips/components/TripCard.tsx`

**Props**:
```typescript
interface TripCardProps {
  trip: Trip;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}
```

**Display**:
- Trip name (large)
- Location (if set)
- Date range (formatted)
- Dropdown menu with Edit/Delete

**Acceptance Criteria**:
- [ ] Card displays all information
- [ ] Click navigates to trip
- [ ] Menu actions work

---

### 5.6 Create Trip Feature Index

**Description**: Create barrel exports and route configuration for trips feature.

**Files**:
- `src/features/trips/index.ts`
- `src/features/trips/routes.tsx`

**Acceptance Criteria**:
- [ ] All trip components/pages are exported
- [ ] Routes are configured correctly

---

## Phase 6: Room Management Feature

### 6.1 Create Room List Page

**Description**: Create the page for viewing and managing rooms.

**File**: `src/features/rooms/pages/RoomListPage.tsx`

**Route**: `/trips/:tripId/rooms`

**Requirements**:
- List rooms as cards
- Show room name, capacity, description
- Show current occupancy status
- Drag-and-drop reordering (optional, can be future)
- Add room button
- Empty state when no rooms

**Acceptance Criteria**:
- [ ] Rooms display in order
- [ ] Occupancy shows correctly
- [ ] Add button opens form

---

### 6.2 Create Room Form Component

**Description**: Create form for creating/editing rooms.

**File**: `src/features/rooms/components/RoomForm.tsx`

**Fields**:
- Name (required)
- Capacity (required, number input, min 1)
- Description (optional, textarea)

**Acceptance Criteria**:
- [ ] Validation works
- [ ] Edit mode pre-fills data

---

### 6.3 Create Room Card Component

**Description**: Create a card for displaying a room.

**File**: `src/features/rooms/components/RoomCard.tsx`

**Display**:
- Room name
- Capacity (e.g., "3 beds" using `t('rooms.beds', { count: 3 })`)
- Description (truncated)
- List of current occupants (PersonBadge)
- Edit/Delete menu

**Acceptance Criteria**:
- [ ] All room info displays
- [ ] Occupants show with colors
- [ ] Actions work correctly

---

### 6.4 Create Room Dialog Component

**Description**: Create a dialog for creating/editing rooms.

**File**: `src/features/rooms/components/RoomDialog.tsx`

**Requirements**:
- Use shadcn/ui Dialog
- Embed RoomForm
- Handle create and edit modes

**Acceptance Criteria**:
- [ ] Dialog opens/closes correctly
- [ ] Form submission closes dialog
- [ ] Success/error toasts display

---

### 6.5 Create Room Feature Index

**Description**: Create barrel exports for rooms feature.

**Files**:
- `src/features/rooms/index.ts`
- `src/features/rooms/routes.tsx`

**Acceptance Criteria**:
- [ ] All room components are exported

---

## Phase 7: Person Management Feature

### 7.1 Create Person List Page

**Description**: Create the page for managing trip participants.

**File**: `src/features/persons/pages/PersonListPage.tsx`

**Route**: `/trips/:tripId/persons`

**Requirements**:
- Display persons as cards or list items
- Show name with color indicator
- Show their arrival/departure info summary
- Add person button
- Empty state

**Acceptance Criteria**:
- [ ] Persons display with colors
- [ ] Transport summary shows
- [ ] Add button works

---

### 7.2 Create Person Form Component

**Description**: Create form for creating/editing persons.

**File**: `src/features/persons/components/PersonForm.tsx`

**Fields**:
- Name (required)
- Color (ColorPicker component)

**Acceptance Criteria**:
- [ ] Validation works
- [ ] Color picker integrates correctly

---

### 7.3 Create Person Card Component

**Description**: Create a card for displaying a person.

**File**: `src/features/persons/components/PersonCard.tsx`

**Display**:
- Name with color indicator (avatar-style)
- Arrival date/time (if set)
- Departure date/time (if set)
- Edit/Delete menu

**Acceptance Criteria**:
- [ ] Color displays correctly
- [ ] Transport info shows
- [ ] Actions work

---

### 7.4 Create Person Dialog Component

**Description**: Create dialog for creating/editing persons.

**File**: `src/features/persons/components/PersonDialog.tsx`

**Acceptance Criteria**:
- [ ] Dialog works for create/edit
- [ ] Form submits correctly

---

### 7.5 Create Person Feature Index

**Description**: Create barrel exports for persons feature.

**Files**:
- `src/features/persons/index.ts`
- `src/features/persons/routes.tsx`

**Acceptance Criteria**:
- [ ] All person components are exported

---

## Phase 8: Room Assignment Feature

### 8.1 Create Assignment Management UI

**Description**: Add room assignment functionality to the rooms page.

**File**: `src/features/rooms/components/RoomAssignmentSection.tsx`

**Requirements**:
- Display within RoomCard or as expandable section
- List assigned persons with date ranges
- Add assignment button
- Edit/delete existing assignments
- Show conflict warnings

**Acceptance Criteria**:
- [ ] Assignments display correctly
- [ ] Date ranges are formatted
- [ ] Conflicts are highlighted

---

### 8.2 Create Assignment Form Component

**Description**: Create form for assigning a person to a room.

**File**: `src/features/rooms/components/AssignmentForm.tsx`

**Fields**:
- Person (select from trip persons)
- Start date (date picker)
- End date (date picker)

**Validation**:
- Person is required
- Dates are required
- Check for conflicts before submit

**Acceptance Criteria**:
- [ ] Person select works
- [ ] Date pickers constrained to trip dates
- [ ] Conflict checking works

---

### 8.3 Create Assignment Dialog Component

**Description**: Create dialog for adding/editing assignments.

**File**: `src/features/rooms/components/AssignmentDialog.tsx`

**Props**:
```typescript
interface AssignmentDialogProps {
  roomId: string;
  assignment?: RoomAssignment;  // For edit mode
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

**Acceptance Criteria**:
- [ ] Dialog works for create/edit
- [ ] Conflict errors display

---

## Phase 9: Calendar View Feature

### 9.1 Create Calendar Page

**Description**: Create the main calendar view page.

**File**: `src/features/calendar/pages/CalendarPage.tsx`

**Route**: `/trips/:tripId/calendar` (default view when selecting a trip)

**Requirements**:
- Month view calendar grid
- Navigation (prev/next month, today button)
- Display room assignments as events
- Events show person name + room name
- Events colored by person color
- Click event to edit assignment
- Responsive (horizontal scroll on mobile if needed)

**Acceptance Criteria**:
- [ ] Month view displays correctly
- [ ] Navigation works
- [ ] Events are positioned correctly
- [ ] Colors match person colors

---

### 9.2 Create Calendar Grid Component

**Description**: Create the calendar grid that displays days and events.

**File**: `src/features/calendar/components/CalendarGrid.tsx`

**Requirements**:
- Display days of month in grid
- Show day numbers
- Highlight today
- Dim days outside current month
- Render events within day cells
- Handle multi-day events (spanning rows)

**Acceptance Criteria**:
- [ ] Grid renders correctly
- [ ] Multi-day events span correctly
- [ ] Today is highlighted

---

### 9.3 Create Calendar Event Component

**Description**: Create the component for a single event on the calendar.

**File**: `src/features/calendar/components/CalendarEvent.tsx`

**Props**:
```typescript
interface CalendarEventProps {
  assignment: RoomAssignment;
  person: Person;
  room: Room;
  onClick: () => void;
}
```

**Display**:
- Person name (truncated if needed)
- Room name (smaller text)
- Background color from person
- Accessible (button role, keyboard)

**Acceptance Criteria**:
- [ ] Event displays correctly
- [ ] Colors are accessible (contrast)
- [ ] Click opens edit dialog

---

### 9.4 Create Calendar Navigation Component

**Description**: Create navigation controls for the calendar.

**File**: `src/features/calendar/components/CalendarNav.tsx`

**Requirements**:
- Previous/next month buttons
- Today button
- Current month/year display
- Localized month names

**Acceptance Criteria**:
- [ ] Navigation works
- [ ] Month names are localized

---

### 9.5 Create Calendar Feature Index

**Description**: Create barrel exports for calendar feature.

**Files**:
- `src/features/calendar/index.ts`
- `src/features/calendar/routes.tsx`

**Acceptance Criteria**:
- [ ] All calendar components are exported

---

## Phase 10: Transport Management Feature

### 10.1 Create Transport List Page

**Description**: Create the page for managing arrivals and departures.

**File**: `src/features/transports/pages/TransportListPage.tsx`

**Route**: `/trips/:tripId/transports`

**Requirements**:
- Two tabs: Arrivals and Departures
- List transports chronologically
- Show person, datetime, location, transport details
- Show pickup indicator
- Add transport button
- Empty state per tab

**Acceptance Criteria**:
- [ ] Tabs switch correctly
- [ ] Transports sorted by datetime
- [ ] All details display

---

### 10.2 Create Transport Form Component

**Description**: Create form for creating/editing transports.

**File**: `src/features/transports/components/TransportForm.tsx`

**Fields**:
- Type (arrival/departure, radio buttons)
- Person (select)
- Date and time (datetime picker)
- Location (text input)
- Transport mode (select: train, plane, car, bus, other)
- Transport number (text input, optional)
- Driver (select from persons, optional)
- Needs pickup (checkbox/switch)
- Notes (textarea, optional)

**Acceptance Criteria**:
- [ ] All fields work correctly
- [ ] Validation works
- [ ] Edit mode pre-fills

---

### 10.3 Create Transport Card Component

**Description**: Create a card for displaying a transport.

**File**: `src/features/transports/components/TransportCard.tsx`

**Display**:
- Person name with color
- Type icon (arrival/departure)
- Date and time (formatted)
- Location
- Transport mode icon and number
- Driver (if assigned)
- Pickup badge (if needs pickup)
- Notes (collapsed/expandable)
- Edit/Delete menu

**Acceptance Criteria**:
- [ ] All information displays
- [ ] Icons are clear
- [ ] Pickup status is visible

---

### 10.4 Create Transport Dialog Component

**Description**: Create dialog for creating/editing transports.

**File**: `src/features/transports/components/TransportDialog.tsx`

**Acceptance Criteria**:
- [ ] Dialog works for create/edit
- [ ] Form submits correctly

---

### 10.5 Create Upcoming Pickups Component

**Description**: Create a component showing upcoming transports needing pickup.

**File**: `src/features/transports/components/UpcomingPickups.tsx`

**Requirements**:
- Display on transport page (and optionally calendar)
- Show only transports with `needsPickup: true`
- Sort by datetime
- Show countdown or relative time

**Acceptance Criteria**:
- [ ] Only pickup-needed transports show
- [ ] Sorted chronologically
- [ ] Time display is clear

---

### 10.6 Create Transport Feature Index

**Description**: Create barrel exports for transports feature.

**Files**:
- `src/features/transports/index.ts`
- `src/features/transports/routes.tsx`

**Acceptance Criteria**:
- [ ] All transport components are exported

---

## Phase 11: Sharing Feature

### 11.1 Create Share Dialog Component

**Description**: Create the sharing dialog with link and QR code.

**File**: `src/features/sharing/components/ShareDialog.tsx`

**Requirements**:
- Display shareable URL
- Copy to clipboard button
- Generate and display QR code
- QR code downloadable/printable
- Accessible

**URL format**: `https://[app-domain]/share/[shareId]`
(For local/PWA: use relative URL `/share/[shareId]`)

**Acceptance Criteria**:
- [ ] URL displays correctly
- [ ] Copy button works
- [ ] QR code generates correctly

---

### 11.2 Create QR Code Component

**Description**: Create a component that renders a QR code.

**File**: `src/features/sharing/components/QRCodeDisplay.tsx`

**Requirements**:
- Use `qrcode.react` library
- Configurable size
- Include app logo in center (optional)
- Download button (save as PNG)

**Acceptance Criteria**:
- [ ] QR code renders
- [ ] Download works
- [ ] Scannable by phone camera

---

### 11.3 Create Share Import Page

**Description**: Create a page for importing a shared trip.

**File**: `src/features/sharing/pages/ShareImportPage.tsx`

**Route**: `/share/:shareId`

**Requirements**:
- Look up trip by shareId
- Display trip info (name, dates, location)
- "View this trip" button
- Handle not found

**Acceptance Criteria**:
- [ ] Shared trip loads
- [ ] Info displays correctly
- [ ] Not found handled gracefully

---

### 11.4 Create Sharing Feature Index

**Description**: Create barrel exports for sharing feature.

**Files**:
- `src/features/sharing/index.ts`
- `src/features/sharing/routes.tsx`

**Acceptance Criteria**:
- [ ] All sharing components are exported

---

## Phase 12: PWA Configuration

### 12.1 Create PWA Icons

**Description**: Create the required PWA icons.

**Files**:
- `public/icons/icon-192.png` (192x192)
- `public/icons/icon-512.png` (512x512)
- `public/favicon.ico`

**Requirements**:
- Simple, recognizable icon (house + calendar motif)
- Works on light and dark backgrounds
- Maskable version for Android

**Acceptance Criteria**:
- [ ] Icons display correctly in browser tab
- [ ] Icons work on home screen

---

### 12.2 Verify PWA Manifest

**Description**: Ensure the PWA manifest is correctly configured.

**The manifest is generated by vite-plugin-pwa** (configured in Phase 0.8)

**Verification checklist**:
- [ ] `name` and `short_name` are set
- [ ] `start_url` is `/`
- [ ] `display` is `standalone`
- [ ] Icons are referenced correctly
- [ ] Theme color matches app theme

**Acceptance Criteria**:
- [ ] Lighthouse PWA audit passes
- [ ] Install prompt appears on supported browsers

---

### 12.3 Create Install Prompt Component

**Description**: Create a component to prompt users to install the PWA.

**File**: `src/components/shared/InstallPrompt.tsx`

**Requirements**:
- Detect if PWA is installable (beforeinstallprompt event)
- Show banner/button to install
- Dismiss option (remember in localStorage)
- Hide if already installed
- Use `t('pwa.install')` for text

**Acceptance Criteria**:
- [ ] Prompt appears on installable browsers
- [ ] Install button triggers native prompt
- [ ] Dismissal is remembered

---

### 12.4 Configure Service Worker for Offline

**Description**: Verify service worker caches app shell and data.

**The service worker is generated by vite-plugin-pwa** (Workbox)

**Verification**:
- [ ] App shell (HTML, CSS, JS) is cached
- [ ] App works offline after first load
- [ ] IndexedDB data persists offline

**Acceptance Criteria**:
- [ ] App loads when offline
- [ ] Data operations work offline
- [ ] Updates apply correctly when online

---

### 12.5 Create Offline Indicator Component

**Description**: Create a component that shows online/offline status.

**File**: `src/components/shared/OfflineIndicator.tsx`

**Requirements**:
- Detect online/offline status
- Show subtle indicator when offline
- Non-intrusive but visible

**Acceptance Criteria**:
- [ ] Indicator appears when offline
- [ ] Disappears when back online
- [ ] Doesn't block interaction

---

## Phase 13: Polish & Accessibility

### 13.1 Implement Keyboard Navigation

**Description**: Ensure all interactive elements are keyboard accessible.

**Requirements**:
- All buttons, links, inputs are focusable
- Focus order is logical
- Focus visible (outline styling)
- Modal focus trapping works
- Escape closes modals/dialogs

**Files to audit**: All components with interactive elements

**Acceptance Criteria**:
- [ ] Tab navigation works throughout app
- [ ] Enter/Space activate buttons
- [ ] Escape closes dialogs

---

### 13.2 Add ARIA Labels

**Description**: Add appropriate ARIA attributes for screen readers.

**Requirements**:
- Icon buttons have aria-label
- Form inputs have associated labels
- Error messages linked to inputs (aria-describedby)
- Loading states announced (aria-live)
- Modal dialogs have aria-modal

**Acceptance Criteria**:
- [ ] Screen reader can navigate app
- [ ] All elements have accessible names
- [ ] Dynamic content is announced

---

### 13.3 Implement Toast Notifications

**Description**: Add toast notifications for success/error feedback.

**File**: `src/components/shared/Toaster.tsx` (wrap shadcn/ui toast)

**Usage points**:
- Trip created/updated/deleted
- Room created/updated/deleted
- Person created/updated/deleted
- Transport created/updated/deleted
- Assignment created/updated/deleted
- Share link copied
- Error states

**Acceptance Criteria**:
- [ ] Toasts appear for all actions
- [ ] Success/error variants styled differently
- [ ] Auto-dismiss after appropriate time

---

### 13.4 Add Loading States to All Pages

**Description**: Ensure all pages handle loading states gracefully.

**Requirements**:
- Show LoadingState component while data loads
- Skeleton loaders for lists (optional, nice-to-have)
- No flash of empty state before data loads

**Acceptance Criteria**:
- [ ] Loading spinners appear during data fetch
- [ ] No layout shift when data loads

---

### 13.5 Add Error Handling to All Pages

**Description**: Wrap pages in error boundaries and handle errors gracefully.

**Requirements**:
- ErrorBoundary wraps each page
- API errors show user-friendly messages
- Retry option where appropriate

**Acceptance Criteria**:
- [ ] Errors don't crash the app
- [ ] Users see helpful error messages
- [ ] Retry functionality works

---

### 13.6 Responsive Design Review

**Description**: Test and fix responsive issues across breakpoints.

**Breakpoints to test**:
- Mobile: 320px - 480px
- Tablet: 481px - 768px
- Desktop: 769px+

**Requirements**:
- All content readable at all sizes
- Touch targets minimum 44x44px on mobile
- No horizontal scroll (except intentional)
- Forms usable on mobile

**Acceptance Criteria**:
- [ ] App usable on all screen sizes
- [ ] No content cut off
- [ ] Touch targets appropriately sized

---

### 13.7 Final i18n Review

**Description**: Verify all strings are translated and no hardcoded text remains.

**Requirements**:
- Search codebase for hardcoded strings
- Verify all translation keys exist
- Test language switching works
- Check date/number formatting uses locale

**Acceptance Criteria**:
- [ ] No hardcoded UI strings
- [ ] Language switch works without reload
- [ ] All dates formatted for locale

---

## Phase 14: App Router Setup

### 14.1 Create Router Configuration

**Description**: Set up React Router with all routes.

**File**: `src/router.tsx`

```typescript
const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Navigate to="/trips" replace /> },
      { path: 'trips', element: <TripListPage /> },
      { path: 'trips/new', element: <TripCreatePage /> },
      { path: 'trips/:tripId/edit', element: <TripEditPage /> },
      { path: 'trips/:tripId/calendar', element: <CalendarPage /> },
      { path: 'trips/:tripId/rooms', element: <RoomListPage /> },
      { path: 'trips/:tripId/persons', element: <PersonListPage /> },
      { path: 'trips/:tripId/transports', element: <TransportListPage /> },
      { path: 'share/:shareId', element: <ShareImportPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
```

**Acceptance Criteria**:
- [ ] All routes work
- [ ] 404 handled gracefully
- [ ] Navigation updates URL

---

### 14.2 Create App Entry Component

**Description**: Set up the main App component with providers.

**File**: `src/App.tsx`

```typescript
import { RouterProvider } from 'react-router-dom';
import { AppProviders } from '@/contexts';
import { Toaster } from '@/components/ui/toaster';
import { router } from './router';

export default function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
      <Toaster />
    </AppProviders>
  );
}
```

**Acceptance Criteria**:
- [ ] App renders without errors
- [ ] All providers are accessible
- [ ] Toaster displays notifications

---

### 14.3 Create Settings Page

**Description**: Create the settings page for app configuration.

**File**: `src/features/settings/pages/SettingsPage.tsx`

**Route**: `/settings`

**Requirements**:
- Language selector (French/English)
- App version display
- Clear data option (with confirmation)
- About section

**Acceptance Criteria**:
- [ ] Language changes immediately
- [ ] Setting persists after reload

---

## Definition of Done Checklist

Before considering the MVP complete, verify:

### Functionality
- [ ] Can create, edit, delete trips
- [ ] Can create, edit, delete rooms within a trip
- [ ] Can create, edit, delete persons within a trip
- [ ] Can assign persons to rooms with date ranges
- [ ] Can create, edit, delete transports (arrivals/departures)
- [ ] Calendar displays room assignments correctly
- [ ] Trip sharing via link works
- [ ] Trip sharing via QR code works
- [ ] Language can be switched between French and English
- [ ] All data persists in IndexedDB

### PWA Requirements
- [ ] App is installable on mobile devices
- [ ] App works offline after first load
- [ ] Service worker caches app shell
- [ ] Manifest is valid (Lighthouse audit)

### Accessibility
- [ ] All interactive elements are keyboard accessible
- [ ] Screen reader can navigate the app
- [ ] Color contrast meets WCAG AA
- [ ] Focus indicators are visible
- [ ] Touch targets are minimum 44x44px

### Responsiveness
- [ ] App is usable on mobile (320px+)
- [ ] App is usable on tablet (768px+)
- [ ] App is usable on desktop (1024px+)
- [ ] No horizontal scrolling issues

### Code Quality
- [ ] TypeScript compiles without errors
- [ ] No console errors in production
- [ ] All translations are complete
- [ ] Error boundaries catch runtime errors

### Performance
- [ ] Initial load < 3 seconds on 3G
- [ ] Lighthouse performance score > 80
- [ ] No unnecessary re-renders

---

## Future Enhancements (Post-MVP)

These features are **NOT** part of the MVP but are documented for future reference:

1. **P2P Sync** - Real-time sync between devices using WebRTC or similar
2. **Push Notifications** - Reminders for upcoming pickups
3. **Food/Menu Management** - Plan meals and shopping lists
4. **Money Splitting** - Tricount-like expense tracking
5. **Task Management** - Chores and shopping assignments
6. **E-ink Display Mode** - High contrast mode for Kindle browsers
7. **AI Room Optimization** - Suggest optimal room assignments
8. **Export to PDF** - Print-friendly trip summary
9. **Import from Calendar** - Import dates from iCal/Google Calendar
10. **Weather Integration** - Show weather forecast for trip location
