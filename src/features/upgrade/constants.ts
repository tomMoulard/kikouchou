/**
 * @fileoverview What the paid tier is, as the fake-door test describes it.
 *
 * One module rather than literals in the component, because these two values
 * are what the whole test means. A funnel built on `upgrade_intent_declared` is
 * only readable next to the price and the feature list that were on screen when
 * somebody declared, so both travel on the events as properties, and both live
 * here where changing one is a deliberate act.
 *
 * Nothing here charges anybody. There is no paid tier: the app is free, no
 * limit is enforced anywhere, and this module exists to find out whether a paid
 * tier would be wanted before any of it is built.
 *
 * @module features/upgrade/constants
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * The monthly price the dialog names, in euros.
 *
 * A fake door with no price measures curiosity. Somebody who clicks through a
 * screen that says three euros a month has answered a different, and much more
 * useful, question. The number rides on every event so that a later change to
 * it splits the funnel instead of quietly poisoning it.
 */
export const UPGRADE_PRICE_EUR_MONTHLY = 3;

/**
 * Which screen the prompt was rendered on.
 *
 * A closed union for the reason the event names are one: this is the property
 * every insight breaks down by, and a free `string` would let a typo read as a
 * fourth placement that nobody can explain a month later.
 */
export type UpgradePlacement = 'analytics' | 'settings' | 'trips';

/**
 * The paid features the dialog lists, as translation key suffixes.
 *
 * The order is the order they appear. `unlimitedTrips` is first because the
 * three-trip cap is the only proposed limit that would be felt by somebody who
 * is already happy, and it is the one the test most needs an answer about.
 */
export const UPGRADE_FEATURE_KEYS = [
  'unlimitedTrips',
  'analytics',
  'export',
  'support',
] as const;

/** One entry of {@link UPGRADE_FEATURE_KEYS}. */
export type UpgradeFeatureKey = (typeof UPGRADE_FEATURE_KEYS)[number];

/**
 * How many active trips the free tier would keep, as the dialog says it.
 *
 * Nothing enforces this. It is the number in the sentence somebody reads before
 * they decide, and it belongs beside the price for the same reason.
 */
export const FREE_ACTIVE_TRIP_LIMIT = 3;

/**
 * The PostHog flag that decides whether the offer can be opened.
 *
 * The same key `TripTemplateCard` gates publishing with, and the same cohort:
 * "enterprise customers", added by hand. Repeated here as a literal rather than
 * imported from that component, because importing it would pull a trip-settings
 * card and its publish hook into every screen this prompt sits on. If a third
 * reader appears, the key belongs in `lib/flags` beside `guest-phone-sharing`.
 *
 * Note what the gate does and does not do. The card is shown to everybody, and
 * the two price buttons answer for everybody: those are the question this test
 * asks, and asking only the cohort would answer it for nobody. The flag gates
 * the button that opens the offer in full, so the described tier is put in
 * front of the accounts it is being designed for first.
 */
export const UPGRADE_OFFER_FLAG = 'ent-trip-templates';

/**
 * The two prices the card puts in front of a reader, as buttons.
 *
 * A closed list for the reason every other list in this module is one: the
 * price and the shape of the offer are what an answer *means*, and a free
 * string would let a fourth price appear in an insight with nobody able to say
 * what was on screen when somebody clicked it.
 *
 * `per_trip` and `unlimited_monthly` are the two shapes worth telling apart: a
 * one-off for the person who organises one holiday a year, and a subscription
 * for the person the trip cap would actually bite. Which one wins is the most
 * useful thing this whole test can learn, and it is why they are two buttons
 * rather than one price in a sentence.
 */
export const UPGRADE_PLANS = [
  { key: 'per_trip', priceEur: 9 },
  { key: 'unlimited_monthly', priceEur: 19 },
] as const;

/** One entry of {@link UPGRADE_PLANS}. */
export type UpgradePlan = (typeof UPGRADE_PLANS)[number];

/** The key of one entry of {@link UPGRADE_PLANS}. */
export type UpgradePlanKey = UpgradePlan['key'];

/**
 * The person property the waiting-list address is written to.
 *
 * A person property rather than an event property, and `lib/posthog`'s
 * {@link setPersonProperties} explains why at length: an address on a person
 * can be read back as a list, is overwritten instead of duplicated, and leaves
 * with the person. On an event it would be copied forever.
 *
 * Prefixed so it cannot be mistaken for the `email` that `AuthContext` writes
 * from a Supabase account. These are different facts: one is how somebody signs
 * in, the other is where they asked to be told about a product that does not
 * exist. Merging them would quietly turn a waiting list into a mailing list.
 */
export const UPGRADE_WAITLIST_EMAIL_PROPERTY = 'upgrade_waitlist_email';

/**
 * Whether a string is close enough to an address to send.
 *
 * Deliberately loose: one `@`, something on each side, a dot in the domain, no
 * spaces. A stricter test rejects addresses that are perfectly valid, and the
 * only cost of a loose one here is a row in a list that bounces later. Nothing
 * is sent from this app, so this is a typo guard rather than a gate.
 *
 * @param value - What the reader typed
 * @returns True when the value is worth recording
 */
export function isPlausibleEmail(value: string): boolean {
  const address = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}

/**
 * The properties every event in this test carries.
 *
 * Built in one place so the four events are directly comparable: a funnel that
 * loses a property halfway through cannot be broken down end to end.
 *
 * @param placement - Which screen the prompt was on
 * @returns The property bag to pass to `captureEvent`
 */
export function upgradeEventProperties(
  placement: UpgradePlacement,
): Record<string, unknown> {
  return {
    placement,
    price_eur_monthly: UPGRADE_PRICE_EUR_MONTHLY,
    free_active_trip_limit: FREE_ACTIVE_TRIP_LIMIT,
  };
}
