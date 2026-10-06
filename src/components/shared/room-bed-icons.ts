/**
 * @fileoverview Bed icons that lucide does not draw.
 *
 * lucide 0.563 has a double bed, a single bed and a plain bed, but no twin
 * room and no bunk bed. These are drawn on the same 24px grid, with the same
 * 2px stroke and rounded corners, so they sit in the picker beside
 * `BedSingle` and `BedDouble` without looking borrowed.
 *
 * @module components/shared/room-bed-icons
 */

import { createLucideIcon } from 'lucide-react';

// ============================================================================
// Icons
// ============================================================================

/**
 * Two single beds side by side, each a narrow `BedSingle`: a twin room.
 */
export const BedTwin = createLucideIcon('bed-twin', [
  ['path', { d: 'M2 20v-7a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v7', key: 'twin-left-frame' }],
  ['path', { d: 'M3 11V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4', key: 'twin-left-head' }],
  ['path', { d: 'M2 18h8', key: 'twin-left-base' }],
  ['path', { d: 'M14 20v-7a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v7', key: 'twin-right-frame' }],
  ['path', { d: 'M15 11V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4', key: 'twin-right-head' }],
  ['path', { d: 'M14 18h8', key: 'twin-right-base' }],
]);

/**
 * Two bunks stacked between shared posts, each with a pillow at the head.
 */
export const BedBunk = createLucideIcon('bed-bunk', [
  ['path', { d: 'M3 2v20', key: 'bunk-post-head' }],
  ['path', { d: 'M21 2v20', key: 'bunk-post-foot' }],
  ['path', { d: 'M3 10h18', key: 'bunk-top' }],
  ['path', { d: 'M3 19h18', key: 'bunk-bottom' }],
  ['path', { d: 'M3 6h5a2 2 0 0 1 2 2v2', key: 'bunk-top-pillow' }],
  ['path', { d: 'M3 15h5a2 2 0 0 1 2 2v2', key: 'bunk-bottom-pillow' }],
]);
