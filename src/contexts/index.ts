/**
 * @fileoverview Barrel export for all application context providers and hooks.
 * Import from this module to access any context functionality.
 *
 * @module contexts
 *
 * @example
 * ```tsx
 * // Import the composite provider for app root
 * import { AppProviders } from '@/contexts';
 *
 * // Import individual hooks for components
 * import {
 *   useTripContext,
 *   useRoomContext,
 *   usePersonContext,
 *   useAssignmentContext,
 *   useTransportContext,
 * } from '@/contexts';
 * ```
 */

// ============================================================================
// Composite Provider
// ============================================================================

export { AppProviders } from './AppProviders';

// ============================================================================
// Trip Context
// ============================================================================

export {
  TripProvider,
  TripContext,
  useTripContext,
  type TripContextValue,
} from './TripContext';

// ============================================================================
// Room Context
// ============================================================================

export {
  RoomProvider,
  RoomContext,
  useRoomContext,
  type RoomContextValue,
} from './RoomContext';

// ============================================================================
// Person Context
// ============================================================================

export {
  PersonProvider,
  PersonContext,
  usePersonContext,
  type PersonContextValue,
} from './PersonContext';

// ============================================================================
// Assignment Context
// ============================================================================

export {
  AssignmentProvider,
  AssignmentContext,
  useAssignmentContext,
  type AssignmentContextValue,
} from './AssignmentContext';

// ============================================================================
// Transport Context
// ============================================================================

export {
  TransportProvider,
  TransportContext,
  useTransportContext,
  type TransportContextValue,
} from './TransportContext';
