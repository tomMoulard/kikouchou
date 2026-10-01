/**
 * @fileoverview Composite provider component that combines all application context providers.
 * This component handles the correct nesting order of providers for the application.
 *
 * @module contexts/AppProviders
 */

import type { ReactElement, ReactNode } from 'react';

import { TripProvider } from '@/contexts/TripContext';
import { RoomProvider } from '@/contexts/RoomContext';
import { PersonProvider } from '@/contexts/PersonContext';
import { AssignmentProvider } from '@/contexts/AssignmentContext';
import { TransportProvider } from '@/contexts/TransportContext';
import { RideProvider } from '@/contexts/RideContext';
import { ActivityProvider } from '@/contexts/ActivityContext';
import { AuthProvider } from '@/features/auth/AuthContext';
import { AccountTripSync } from '@/lib/sync/AccountTripSync';
import { GuestGroupSync } from '@/lib/sync/GuestGroupSync';
import { YjsTripSync } from '@/lib/yjs/YjsTripSync';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the AppProviders component.
 */
interface AppProvidersProps {
  /** Child components to render within the provider tree */
  readonly children: ReactNode;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Composite provider that combines all application context providers in the correct nesting order.
 *
 * Provider nesting order (outermost to innermost):
 * 0. AuthProvider - Session state. Outermost because it is not trip-scoped and
 *    must resolve whether or not a trip exists. It never gates rendering: a
 *    trip is created and edited with no account and no network.
 * 0b. AccountTripSync - Not a provider and not in the chain. Renders nothing;
 *    it reconciles this device's trips with the signed-in account's, so the
 *    same trips show up on the phone and the laptop.
 * 0c. GuestGroupSync - Reconciles the account's guest groups. Above the trip
 *    providers because groups are global: they outlive the selected trip and
 *    are read on `/groups` where no trip is selected at all. Renders nothing
 *    and does nothing without a session. Unlike AccountTripSync it wraps rather
 *    than sits beside, because it publishes the context `useGuestGroups` reads.
 * 1. TripProvider - Manages current trip selection and trip list
 * 2. RoomProvider - Manages rooms for the current trip (depends on TripProvider)
 * 3. PersonProvider - Manages persons for the current trip (depends on TripProvider)
 * 4. AssignmentProvider - Manages room assignments (depends on TripProvider)
 * 5. TransportProvider - Manages transports (depends on TripProvider)
 * 6. RideProvider - Manages the car journeys and the cars (depends on
 *    TripProvider). Nested *inside* TransportProvider because the two are read
 *    together — a ride's passenger list is assembled from the legs, and the
 *    pickup panel asks both whether anybody is driving yet — so a component
 *    reaching for rides always has transports in scope too.
 * 7. ActivityProvider - Manages the shared activity agenda (depends on TripProvider)
 *
 * The WebRTC awareness provider that used to sit here is gone with the
 * transport; sync state now comes from SupabaseTripSync inside YjsTripSync.
 *
 * @remarks
 * This nesting order ensures that:
 * - All trip-scoped providers have access to the current trip
 * - Room, Person, Assignment, and Transport contexts can all be used together
 * - The dependency hierarchy is maintained correctly
 *
 * @param props - Provider props including children
 * @returns Provider tree wrapping children with all application contexts
 *
 * @example
 * ```tsx
 * import { AppProviders } from '@/contexts';
 *
 * function App() {
 *   return (
 *     <AppProviders>
 *       <Router>
 *         <Routes />
 *       </Router>
 *     </AppProviders>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Using multiple contexts in a component
 * import { useTripContext, useRoomContext, usePersonContext } from '@/contexts';
 *
 * function Dashboard() {
 *   const { currentTrip } = useTripContext();
 *   const { rooms } = useRoomContext();
 *   const { persons } = usePersonContext();
 *
 *   // All contexts are available due to AppProviders wrapping the app
 *   return (
 *     <div>
 *       <h1>{currentTrip?.name}</h1>
 *       <p>{rooms.length} rooms, {persons.length} persons</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function AppProviders({ children }: AppProvidersProps): ReactElement {
  return (
    <AuthProvider>
      {/*
        A sibling, not a wrapper. It renders nothing and reads no trip context —
        it only needs the session — so putting it beside the tree rather than
        around it keeps it out of the remount story `App.tsx` describes, and
        makes it obvious that nothing below depends on it having finished.
      */}
      <AccountTripSync />

      {/*
        A wrapper rather than a sibling, unlike `AccountTripSync` directly above,
        and for one reason: this one *publishes* a context. `useGuestGroups`
        reads `syncNow` from it to push a group the moment it is created, and a
        sibling could not hand that down — every write would then wait for the
        next sign-in or reconnection to leave the device. It still renders
        nothing and still reads no trip context.
      */}
      <GuestGroupSync>
        <TripProvider>
          <RoomProvider>
            <PersonProvider>
              <AssignmentProvider>
                <TransportProvider>
                  <RideProvider>
                    <ActivityProvider>
                      <YjsTripSync>{children}</YjsTripSync>
                    </ActivityProvider>
                  </RideProvider>
                </TransportProvider>
              </AssignmentProvider>
            </PersonProvider>
          </RoomProvider>
        </TripProvider>
      </GuestGroupSync>
    </AuthProvider>
  );
}
