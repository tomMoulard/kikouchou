/**
 * @fileoverview Barrel export for the rooms feature module.
 * Import room pages, components, and utilities from this index for cleaner imports.
 *
 * @module features/rooms
 *
 * @example
 * ```tsx
 * import {
 *   RoomListPage,
 *   RoomForm,
 *   RoomCard,
 *   RoomDialog,
 *   roomRoutes,
 * } from '@/features/rooms';
 * ```
 */

// ============================================================================
// Pages
// ============================================================================

export { RoomListPage } from './pages/RoomListPage';

// ============================================================================
// Components
// ============================================================================

export { AllocationSuggestionDialog } from './components/AllocationSuggestionDialog';
export type {
  AllocationSuggestionDialogProps,
  ConfirmedStay,
} from './components/AllocationSuggestionDialog';

export { RoomForm } from './components/RoomForm';
export type { RoomFormProps } from './components/RoomForm';

export { RoomCard } from './components/RoomCard';
export type { RoomCardProps } from './components/RoomCard';

export { RoomDialog } from './components/RoomDialog';
export type { RoomDialogProps } from './components/RoomDialog';

export { RoomAssignmentSection } from './components/RoomAssignmentSection';
export type { RoomAssignmentSectionProps } from './components/RoomAssignmentSection';

// ============================================================================
// Route Configuration
// ============================================================================

export { roomRoutes } from './routes';
export type { RoomListParams } from './routes';

// ============================================================================
// Utilities
// ============================================================================

export { planRoomAllocation } from './utils/allocation-planner';
export type {
  AllocationPlanInput,
  GuestNeedingRoom,
  SuggestedStay,
} from './utils/allocation-planner';

export { inferGuestParties } from './utils/guest-parties';
export type { GuestPartyInput, PartyKeyByPerson } from './utils/guest-parties';
