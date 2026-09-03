/**
 * @fileoverview Transport icon component for displaying transport mode icons.
 * Maps transport modes to appropriate Lucide icons.
 *
 * @module components/shared/TransportIcon
 */

import { memo } from 'react';

import { cn } from '@/lib/utils';
import { TRANSPORT_MODE_ICONS } from '@/lib/utils/transport-icons';
import type { TransportMode } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the TransportIcon component.
 */
interface TransportIconProps {
  /** The transport mode to display an icon for */
  readonly mode: TransportMode;
  /** Additional CSS classes */
  readonly className?: string;
  /** Accessible label for screen readers */
  readonly 'aria-label'?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * TransportIcon displays an icon representing a transport mode.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <TransportIcon mode="train" />
 *
 * // With custom styling
 * <TransportIcon mode="plane" className="size-5 text-blue-500" />
 * ```
 */
const TransportIcon = memo(function TransportIcon({
  mode,
  className,
  'aria-label': ariaLabel,
}: TransportIconProps): React.ReactElement {
  // Indexed rather than through `getTransportModeIcon`: the React Compiler
  // reads a call returning a component as a component created during render.
  const Icon = TRANSPORT_MODE_ICONS[mode] ?? TRANSPORT_MODE_ICONS.other;

  return (
    <Icon
      className={cn('size-4 shrink-0', className)}
      aria-label={ariaLabel}
      aria-hidden={!ariaLabel}
    />
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TransportIcon };
export type { TransportIconProps };
