/**
 * @fileoverview Barrel export for the guest groups feature module.
 *
 * @module features/guest-groups
 *
 * @example
 * ```tsx
 * import {
 *   GuestGroupImportDialog,
 *   SaveGuestsAsGroupDialog,
 *   useGuestGroups,
 * } from '@/features/guest-groups';
 * ```
 */

// ============================================================================
// Pages
// ============================================================================

export { GuestGroupListPage } from './pages/GuestGroupListPage';

// ============================================================================
// Components
// ============================================================================

export { GuestGroupForm } from './components/GuestGroupForm';
export type { GuestGroupFormProps } from './components/GuestGroupForm';

export { GuestGroupDialog } from './components/GuestGroupDialog';
export type { GuestGroupDialogProps } from './components/GuestGroupDialog';

export { GuestGroupImportDialog } from './components/GuestGroupImportDialog';
export type {
  GuestGroupImportDialogProps,
  GuestGroupSelection,
} from './components/GuestGroupImportDialog';

export { SaveGuestsAsGroupDialog } from './components/SaveGuestsAsGroupDialog';
export type { SaveGuestsAsGroupDialogProps } from './components/SaveGuestsAsGroupDialog';

// ============================================================================
// Hooks
// ============================================================================

export { useGuestGroups } from './hooks/useGuestGroups';
export type { UseGuestGroupsResult } from './hooks/useGuestGroups';

// ============================================================================
// Route Configuration
// ============================================================================

export { guestGroupRoutes } from './routes';
