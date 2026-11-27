/**
 * @fileoverview Achievements: what they are, how they unlock, and how they
 * reach the account.
 *
 * @module lib/achievements
 */

export * from './definitions';
export * from './reward-hold';
export * from './store';
export { fetchAchievementStats, syncAchievements } from './sync';
export type { AchievementStats, AchievementSyncResult } from './sync';
