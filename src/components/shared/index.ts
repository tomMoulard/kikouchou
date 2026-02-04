/**
 * @fileoverview Barrel export for all shared UI components.
 * Import shared components from this index for cleaner imports.
 *
 * @module components/shared
 *
 * @example
 * ```tsx
 * import {
 *   Layout,
 *   EmptyState,
 *   LoadingState,
 *   ErrorBoundary,
 *   ConfirmDialog,
 *   PageHeader,
 *   ColorPicker,
 *   DateRangePicker,
 *   PersonBadge,
 * } from '@/components/shared';
 * ```
 */

// ============================================================================
// Layout Components
// ============================================================================

export { Layout } from './Layout';
export type { LayoutProps } from './Layout';

// ============================================================================
// State Components
// ============================================================================

export { EmptyState } from './EmptyState';
export type { EmptyStateProps, EmptyStateAction } from './EmptyState';

export { LoadingState } from './LoadingState';
export type { LoadingStateProps } from './LoadingState';

export { ErrorBoundary } from './ErrorBoundary';
export type { ErrorBoundaryProps } from './ErrorBoundary';

export { ErrorDisplay } from './ErrorDisplay';
export type { ErrorDisplayProps } from './ErrorDisplay';

// ============================================================================
// Dialog Components
// ============================================================================

export { ConfirmDialog } from './ConfirmDialog';
export type { ConfirmDialogProps } from './ConfirmDialog';

// ============================================================================
// Page Components
// ============================================================================

export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';

// ============================================================================
// Form Components
// ============================================================================

export { ColorPicker, DEFAULT_COLORS } from './ColorPicker';
export type { ColorPickerProps } from './ColorPicker';

export { DateRangePicker } from './DateRangePicker';
export type { DateRangePickerProps, DateRange } from './DateRangePicker';

export { LocationPicker } from './LocationPicker';
export type { LocationPickerProps, Coordinates } from './LocationPicker';

// ============================================================================
// Display Components
// ============================================================================

export { PersonBadge } from './PersonBadge';
export type { PersonBadgeProps } from './PersonBadge';

export { TransportIcon } from './TransportIcon';
export type { TransportIconProps } from './TransportIcon';

// ============================================================================
// Map Components
// ============================================================================

export { MapView } from './MapView';
export type { MapViewProps, MapViewRef, MapMarkerData, MapMarkerType } from './MapView';

export { MapMarker } from './MapMarker';
export type { MapMarkerProps } from './MapMarker';
