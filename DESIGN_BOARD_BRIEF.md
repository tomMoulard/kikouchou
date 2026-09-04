# Kikouchou — factual UI and feature brief

**Do not invent features that are not listed here.**
This app has **no login/account system**, **no payment flow**, **no social feed**, and **no admin dashboard** in the current router.

## 1. Product purpose

Kikouchou is a **vacation-house trip organizer**.
It helps a group of friends organize:

- one or more **trips**
- the **rooms** inside each trip
- the **guests** joining each trip
- the **room assignments** for each guest
- the **arrival/departure transports**
- **pickup/dropoff coordination**
- **sharing/syncing trip data** across devices
- a **local on-device AI assistant** for trip management

The app is a **PWA** and is designed to work **offline-first** after the first load.

## 2. Core data model

The app revolves around 5 main entities:

1. **Trip**
   - name
   - location
   - start date
   - end date
   - description/notes
   - optional map coordinates
   - share ID for invite links
   - optional P2P sync credentials

2. **Room**
   - belongs to a trip
   - name
   - capacity = number of beds/spots
   - optional description
   - optional room icon
   - display order

3. **Guest / Person**
   - belongs to a trip
   - name
   - color
   - optional stay start date
   - optional stay end date

4. **Room assignment**
   - links one guest to one room
   - start date
   - end date
   - date-bound, not just permanent

5. **Transport**
   - belongs to a trip
   - linked to one guest
   - type = arrival or departure
   - datetime
   - location
   - optional start location
   - optional transport mode
   - optional transport number
   - optional driver
   - needs-pickup boolean
   - optional notes
   - optional map coordinates

## 3. Global navigation and shell

## Main app shell

All main in-app pages share the same shell:

- **sticky top header**
  - left: app name “Kikouchou”
  - right: current trip name, truncated if too long
  - on mobile, the header can also show collaboration presence if multiple peers are online

- **desktop navigation**
  - left vertical sidebar
  - collapsible: expanded width or icon-only collapsed rail
  - top section always has **My trips**
  - if a trip is selected, the sidebar also shows:
    - trip info block
    - date range
    - location
    - “Guests tonight” list
    - trip-specific navigation
  - bottom always has:
    - **AI Assistant**
    - **Settings**
    - collaboration presence indicator
    - collapse button

- **mobile navigation**
  - fixed bottom bar
  - direct tabs:
    - Calendar
    - Rooms
    - Transport
    - More
  - “More” opens a bottom sheet containing:
    - Guests
    - My trips
    - AI Assistant
    - Settings

## Important route structure

- `/trips` = trip list
- `/trips/new` = create trip
- `/trips/:tripId/edit` = edit trip
- `/trips/:tripId` = trip calendar default
- `/trips/:tripId/calendar`
- `/trips/:tripId/rooms`
- `/trips/:tripId/persons`
- `/trips/:tripId/transports`
- `/trips/:tripId/transports/map`
- `/trips/:tripId/sync`
- `/assistant`
- `/settings`

Public or special routes outside the normal shell:

- `/share/:shareId`
- `/share/:shareId/identity`
- `/share/:shareId/room`
- `/share/:shareId/transport`
- `/share/:shareId/summary`
- `/trip/:roomId#encryptionKey` for P2P collaboration entry

## 4. Main screens

## A. Trip list page (`/trips`)

This is the entry page of the app.

### Layout

- page header title: **My trips**
- desktop header actions:
  - secondary or outline button: **Import from QR code**
  - primary button: **New trip**
- mobile:
  - 2 floating circular buttons stacked at bottom-right:
    - QR import
    - create new trip

### Content

- responsive **card grid**
  - 1 column on mobile
  - 2 columns on tablet
  - 3 columns on desktop

### Trip card contents

Each trip card shows:

- trip name
- location if present
- formatted trip date range
- guest badges, up to 4 visible, then `+N`
- optional map preview thumbnail if the trip has coordinates
- top-right share button
- top-right overflow menu with edit and delete

### Trip card interactions

- clicking the card selects the trip and opens its calendar
- clicking the share button opens a **P2P collaboration share dialog**
- overflow menu contains edit and delete

### Empty state

If there are no trips:

- centered icon + title + description + CTA

## B. Trip create page (`/trips/new`)

This is a full page, not a modal.

### Layout

- page header with back link
- centered card containing the form

### Fields

- trip name
- location
- description
- start date
- end date

### Special behavior

The **location field has autocomplete** based on previous trips.
If the user chooses a matching previous trip, the form can import:

- location
- description
- coordinates
- rooms from the previous trip

### Actions

- Save
- Cancel
- unsaved-changes warning if dirty

## C. Trip edit page (`/trips/:tripId/edit`)

Also a full page.

### Layout

- page header with back link
- delete button in header area
- centered card containing the same trip form

### Features

- loads existing trip
- edit all trip fields
- delete trip with confirmation dialog
- unsaved-changes protection

## D. Calendar page (`/trips/:tripId` or `/trips/:tripId/calendar`)

This is the **default page for a selected trip**.

### Header

- title: Calendar
- back link to trips if needed

### View switch

The page has **2 tabs**:

- **Month**
- **Timeline**

Default is **Timeline** unless the URL query says otherwise.

### Month view

- 7-column month grid
- week starts on **Monday**
- previous month, next month, and today controls
- multi-day room assignment pills
- transport events integrated into day cells
- clicking an event opens detail dialog

### Timeline view

- one row per guest
- horizontal timeline across dates
- room assignment bars
- transport indicators

### Event detail dialog

When an event is clicked, open a dialog.

If it is a **room assignment**, show:

- guest badge
- room name + room icon
- date range
- night count
- related travel blocks if present

If it is a **transport**, show:

- guest
- optional driver
- datetime
- location
- mode and transport number
- notes
- directions button if coordinates exist

Both event types support:

- edit
- delete

## E. Rooms page (`/trips/:tripId/rooms`)

### Header

- title: Rooms
- back link to calendar
- desktop primary action: New room
- mobile floating add button

### View switch

The page has **2 tabs**:

- **Cards**
- **Timeline**

Default is **Timeline** unless a query param says otherwise.

### Cards view

Optional date range filter:

- “Show availability for dates”

Room cards show:

- room icon
- room name
- capacity
- optional description
- occupancy status
- occupancy progress bar
- available spots
- current occupant badges
- overflow menu: edit and delete
- expand or collapse affordance
- **Claim this room** button if capacity remains

Expanded room card content:

- room assignments list
- add, edit, and delete assignment actions

### Timeline view

- one row per room
- sticky left label column
- horizontal date columns across the trip
- colored assignment bars
- free-bed or occupancy information
- top “unassigned guests” row when needed

### Unassigned guests block

If some guests need rooms:

- amber warning card
- list of guests without rooms
- each guest row shows a colored stay span
- drag hint text
- optional **Optimize automatically** button can appear

### Assignment interactions

- drag guest onto room
- opens **Quick assignment dialog**
- choose or confirm guest and date range
- conflict handling
- delete confirmation

### Room CRUD

Room create and edit are handled in a **dialog**, not a standalone page.

Room form fields:

- name
- capacity
- description
- icon picker

Room icon choices include:

- double bed
- single bed
- bathroom
- sofa or lounge
- tent
- caravan
- warehouse or storage
- home
- door-open or entryway
- baby or kids room
- armchair

## F. Guests page (`/trips/:tripId/persons`)

### Header

- title: Guests
- back link to calendar
- desktop add button
- mobile floating add button

### Layout

- responsive card grid

### Guest card contents

Each guest card shows:

- colored dot or color indicator
- guest name
- optional stay date range
- assigned room names
- arrival summary if present
- departure summary if present
- fallback text if no transport exists

### Guest CRUD

Guests are created and edited in a **dialog**, not a separate page.

Guest form fields:

- name
- color picker
- optional stay date range

## G. Transport list page (`/trips/:tripId/transports`)

### Important: this page is **not** tabbed by arrival and departure

It is a **single chronological list**.

### Header

- title: Transport
- back link to calendar
- desktop buttons:
  - Map view
  - New transport
- mobile floating add button

### Top summary

If transports exist, show small summary counts:

- arrivals count in green
- departures count in orange

### Upcoming pickups section

If any transport needs pickup:

- amber highlighted block
- grouped pickup cards
- urgency styling
- volunteer or assign driver flow
- driver select dialog

### Main list

- grouped by date
- upcoming section first
- collapsible past transports section
- transport cards distinguish:
  - arrival = green
  - departure = orange

Each transport card shows:

- guest badge
- date
- time
- location
- mode icon
- optional transport number
- optional driver
- optional notes
- pickup badge when relevant
- overflow menu: edit and delete

### Transport CRUD

Transport create and edit are in a **dialog**.

Transport form fields:

- arrival or departure type
- guest
- datetime
- start location
- destination or location
- mode
- transport number
- driver
- needs pickup switch
- notes

## H. Transport map page (`/trips/:tripId/transports/map`)

### Purpose

Shows transport locations on an interactive map.

### Features

- arrivals = green markers
- departures = orange markers
- transport popups with details
- optional route polylines from start location to destination if both coordinates exist
- directions button inside popup
- back-to-list button
- empty state if no transports have coordinates

## I. Settings page (`/settings`)

### Layout

Narrow centered page with stacked cards.

### Sections

1. **Current Trip** (only if a trip is selected)
   - inline trip edit form
   - delete current trip button

2. **Language**
   - selector with:
     - Français
     - English

3. **About**
   - app name
   - tagline
   - version

4. **Data Management**
   - destructive “Clear All Data”
   - confirmation dialog

### Important

There is **language switching**, but there is **no in-app theme toggle** in current settings.

## J. AI Assistant page (`/assistant`)

### Purpose

A local AI assistant that runs **on-device**.

### Layout

- page header with title + description
- model picker in the header when ready
- clear chat button
- large chat area
- sticky message composer at bottom

### States

1. **Model not loaded**
   - onboarding or loading card
   - model select
   - model explanation
   - load button

2. **Model loading**
   - overall progress bar
   - per-file download progress
   - status lines

3. **Ready with empty conversation**
   - bot icon
   - empty-state text
   - prompt hint

4. **Conversation state**
   - user bubble on right
   - assistant bubble on left
   - assistant messages rendered as markdown
   - expandable “changes applied” details when the assistant mutated trip data

### Supported assistant mutations

The assistant can perform these actions:

- create trip
- select trip
- update trip
- add guest
- remove guest
- add room
- remove room
- assign room
- remove assignment
- add transport
- remove transport

### Model presets

There are 3 presets:

- Light
- Balanced
- Best quality

## K. Trip sync page (`/trips/:tripId/sync`)

### Purpose

Manual device-to-device sync using QR codes or copied payload text.

### Layout

- page header title: Sync
- 2 tabs:
  - Import
  - Export

### Export tab

- explains whether it is exporting:
  - full host snapshot
  - or guest delta
- can show single QR or multi-frame QR
- can fall back to copyable payload text

### Import tab

- QR scanner
- multi-frame progress bar
- merge review screen
- auto-applied changes list
- conflicts list
- warnings list
- user must choose resolution for each conflict
- final Apply Changes button

## L. Public guest onboarding flow (`/share/:shareId/...`)

This flow is visually different from the main app.

### Visual style

- full-screen centered layout
- warm **amber/orange vacation palette**
- gradient background
- narrow centered card
- large round icon at top
- large title + subtitle
- strong amber primary button

### Step 1: Welcome (`/share/:shareId`)

Shows:

- trip name
- date range
- location
- welcome text
- Get Started CTA

Returning guest behavior:
- if guest identity was stored before, the page can auto-continue into the trip

### Step 2: Identity (`/share/:shareId/identity`)

Shows:

- list of existing trip participants as selectable cards
- each row has color swatch + name
- selected row has checkmark and highlight
- inline “Add myself” form for a new name
- primary Next button

### Step 3: Room selection (`/share/:shareId/room`)

Shows:

- room cards
- capacity indicator
- occupancy progress bar
- full rooms dimmed and disabled
- “Claim this room” button
- claimed room state with success styling
- Next button
- Skip for now button

### Step 4: Transport entry (`/share/:shareId/transport`)

Shows:

- already-entered transports at top as summary cards
- form for arrival or departure
- datetime
- station or airport
- mode
- optional number
- needs pickup toggle
- Add transport button
- Done button
- Skip for now button

### Step 5: Summary (`/share/:shareId/summary`)

Shows 3 tappable summary blocks:

- Identity
- Room
- Transport

Each block can navigate back for editing.

Primary CTA:

- **Let’s go!**
- sets current trip and enters the main app calendar

## M. P2P collaboration invite route (`/trip/:roomId#encryptionKey`)

This is not a normal app page. It is a **transitional sync or join page**.

### Behavior

- attempts to connect to a shared Yjs room
- if trip data is resolved, redirects to the normal trip calendar
- if waiting, shows waiting state
- if signaling fails, shows error card with retry and home actions
- if generic connection fails, shows error card

This route exists mainly because the **share dialog** generates P2P collaboration URLs.

## 5. Global recurring UI patterns

Use these patterns consistently:

- **PageHeader**
  - large title
  - optional description
  - optional back link
  - optional right-side actions

- **Empty states**
  - centered icon
  - title
  - short description
  - optional CTA button

- **Destructive confirmation**
  - modal dialog
  - cancel + confirm buttons

- **Unsaved changes warning**
  - modal dialog before leaving dirty forms

- **Toasts**
  - global bottom-center toaster

- **Status coloring**
  - green = arrival / success / online
  - orange = departure
  - amber = warning / offline reassurance / pickups / guest onboarding theme
  - red = destructive / errors

## 6. Global app-wide extras

These are real UI features and should be included:

- **offline banner**
  - fixed below the header
  - warm amber styling when offline
  - brief green “back online” message when connectivity returns

- **PWA install prompt**
  - dismissible bottom banner or card
  - appears only when install is available

- **route error page / 404**
  - centered card
  - warning icon
  - optional status code
  - buttons:
    - go home
    - retry

## 7. Important “do not invent” rules

Do **not** add:

- authentication screens
- user profile settings
- notifications center
- payments or subscriptions
- cloud team admin
- file uploads
- comments or social activity feed
- dashboard analytics
- separate room detail pages
- separate guest detail pages
- separate transport detail pages

Create and edit behavior is mostly:

- **Trips** = full pages
- **Rooms / Guests / Transports / Assignments** = dialogs
