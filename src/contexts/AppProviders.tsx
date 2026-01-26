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
 * 1. TripProvider - Manages current trip selection and trip list
 * 2. RoomProvider - Manages rooms for the current trip (depends on TripProvider)
 * 3. PersonProvider - Manages persons for the current trip (depends on TripProvider)
 * 4. AssignmentProvider - Manages room assignments (depends on TripProvider)
 * 5. TransportProvider - Manages transports (depends on TripProvider)
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
    <TripProvider>
      <RoomProvider>
        <PersonProvider>
          <AssignmentProvider>
            <TransportProvider>{children}</TransportProvider>
          </AssignmentProvider>
        </PersonProvider>
      </RoomProvider>
    </TripProvider>
  );
}
