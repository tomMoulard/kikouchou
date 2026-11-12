/**
 * @fileoverview The palette a guest's colour is picked from.
 *
 * It lives apart from `ColorPicker.tsx` because that file is a component
 * module: React Fast Refresh can only refresh a file that exports components
 * alone, and the forms read this list without drawing the picker.
 *
 * @module components/shared/color-palette
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Default color palette for person colors.
 * These colors provide good visual distinction and contrast. There is no red:
 * red means an error or a destructive action in this app, and a guest drawn in
 * it on the calendar or a room card reads as a warning.
 */
const DEFAULT_COLORS = [
  '#f97316', // Orange
  '#f59e0b', // Amber
  '#eab308', // Yellow
  '#84cc16', // Lime
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#a855f7', // Purple
  '#ec4899', // Pink
] as const;

// ============================================================================
// Exports
// ============================================================================

export { DEFAULT_COLORS };
