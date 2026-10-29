/**
 * @fileoverview The questions an empty chat offers to start with.
 *
 * Two start a trip of the visitor's own, which is what the onboarding
 * experiment measures, and two ask about the trip on screen, which on a first
 * open is the sample. `components/StarterPrompts` draws them.
 *
 * @module features/assistant/starters
 */

// ============================================================================
// Type Definitions
// ============================================================================

/** What a starter steers toward: a new trip, or the trip on screen. */
export type StarterKind = 'create' | 'explore';

export interface StarterPrompt {
  readonly id: string;
  readonly kind: StarterKind;
  readonly key: string;
  readonly fallback: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * The questions, in display order. Each one is something the assistant can
 * finish from the prompt alone: `createTrip` takes a name and two dates, and
 * the dates resolve against the day the system prompt states.
 */
export const STARTER_PROMPTS: readonly StarterPrompt[] = [
  {
    id: 'create-weekend',
    kind: 'create',
    key: 'assistant.starters.createWeekend',
    fallback: 'Plan a weekend at the seaside with 6 friends next month',
  },
  {
    id: 'explore-rooms',
    kind: 'explore',
    key: 'assistant.starters.exploreRooms',
    fallback: 'Who sleeps where on the first night?',
  },
  {
    id: 'create-family',
    kind: 'create',
    key: 'assistant.starters.createFamily',
    fallback: 'Create a week in the mountains in August for my family',
  },
  {
    id: 'explore-plan',
    kind: 'explore',
    key: 'assistant.starters.explorePlan',
    fallback: 'What is planned for the first day?',
  },
];
