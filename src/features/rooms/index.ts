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
