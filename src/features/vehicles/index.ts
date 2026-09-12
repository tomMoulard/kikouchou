/**
 * @fileoverview Barrel export for the vehicles feature module.
 *
 * @module features/vehicles
 *
 * @example
 * ```tsx
 * import { VehicleDialog, vehicleRoutes } from '@/features/vehicles';
 * ```
 */

// ============================================================================
// Pages
// ============================================================================

export { VehicleListPage } from './pages/VehicleListPage';

// ============================================================================
// Components
// ============================================================================

export { VehicleForm } from './components/VehicleForm';
export type { VehicleFormProps } from './components/VehicleForm';

export { VehicleDialog } from './components/VehicleDialog';
export type { VehicleDialogProps } from './components/VehicleDialog';

// ============================================================================
// Route Configuration
// ============================================================================

export { vehicleRoutes } from './routes';
export type { VehicleListParams } from './routes';
