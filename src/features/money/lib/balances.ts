/**
 * @fileoverview Who is up, who is down, and the shortest way to level them.
 *
 * Every line of the trip's accounts is turned into two movements — money in for
 * the guest who paid, money out for each guest it was for — and a guest's
 * balance is the sum of both. A positive balance means the group owes them; a
 * negative one means they owe the group.
 *
 * The three kinds share one arithmetic, which is why they can be added up
 * together at all:
 *
 * - an `expense` credits the payer and debits the beneficiaries;
 * - an `income` is the same line with the signs swapped: the guest who received
 *   the money holds it for the people it belongs to;
 * - a `transfer` is an expense with one beneficiary, so a settling payment
 *   cancels exactly the debt it was made against.
 *
 * The arithmetic runs in cents throughout. Balances are sums of sums, and a
 * float sum of a hundred shares drifts far enough to make a settled group owe
 * each other a cent forever.
 *
 * @module features/money/lib/balances
 */

import { computeExpenseShares } from '@/features/money/lib/expense-split';
import type { PersonNightCounts } from '@/features/money/lib/expense-split';
import type { Expense, PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * One guest's standing in the trip's accounts.
 */
export interface PersonBalance {
  /** The guest. */
  readonly personId: PersonId;
  /** What this guest put in, across every line they paid. */
  readonly paid: number;
  /** What this guest's shares come to, across every line they benefited from. */
  readonly owed: number;
  /**
   * `paid` minus `owed`.
   *
   * Positive: the group owes this guest. Negative: this guest owes the group.
   */
  readonly balance: number;
}

/**
 * One payment that moves the group closer to settled.
 */
export interface SettlementPayment {
  /** The guest who pays. */
  readonly fromPersonId: PersonId;
  /** The guest who is paid. */
  readonly toPersonId: PersonId;
  /** How much, rounded to the cent and always above zero. */
  readonly amount: number;
}

// ============================================================================
// Balances
// ============================================================================

/**
 * Adds every money line up into one balance per guest.
 *
 * @param expenses - The trip's money lines
 * @param personNights - Each guest's person nights, for lines split by nights
 * @returns One row per guest who appears anywhere in the accounts, biggest
 *   creditor first, then by id so the order never depends on insertion order
 *
 * @example
 * ```ts
 * const balances = computeBalances(expenses, nights);
 * balances[0]?.balance; // what the group owes the guest it owes most
 * ```
 */
export function computeBalances(
  expenses: readonly Expense[],
  personNights: PersonNightCounts = new Map(),
): PersonBalance[] {
  const paidCents = new Map<PersonId, number>();
  const owedCents = new Map<PersonId, number>();

  const add = (into: Map<PersonId, number>, personId: PersonId, cents: number): void => {
    into.set(personId, (into.get(personId) ?? 0) + cents);
  };

  for (const expense of expenses) {
    const shares = computeExpenseShares(expense, personNights);

    let sharedCents = 0;
    for (const share of shares) {
      sharedCents += Math.round(share.amount * 100);
    }
    if (sharedCents === 0) {
      // A line nobody benefited from, or one with no amount: the payer spent
      // their own money on themselves, and no balance moves.
      continue;
    }

    // An income runs the same line backwards: the guest who received the money
    // is holding it for the people whose money it is.
    const direction = expense.kind === 'income' ? -1 : 1;

    add(paidCents, expense.payerId, direction * sharedCents);
    for (const share of shares) {
      add(owedCents, share.personId, direction * Math.round(share.amount * 100));
    }
  }

  const everyone = new Set<PersonId>([...paidCents.keys(), ...owedCents.keys()]);

  return [...everyone]
    .map((personId) => {
      const paid = paidCents.get(personId) ?? 0;
      const owed = owedCents.get(personId) ?? 0;
      return {
        personId,
        paid: paid / 100,
        owed: owed / 100,
        balance: (paid - owed) / 100,
      };
    })
    .sort(
      (left, right) =>
        right.balance - left.balance || left.personId.localeCompare(right.personId),
    );
}

// ============================================================================
// Settlement
// ============================================================================

/**
 * Turns balances into the payments that clear them.
 *
 * The biggest debtor pays the biggest creditor, as much as the smaller of the
 * two, and the loop repeats. That settles a group of *n* guests in at most
 * *n − 1* payments, which is the number that matters: every payment is a real
 * bank transfer somebody has to make, and a group that owes six people a few
 * euros each would rather make two.
 *
 * It is not the provably shortest list — that problem is NP-hard, and a holiday
 * house does not need it — but it never asks for more payments than there are
 * guests, and every payment it names is one somebody actually owes.
 *
 * @param balances - The balances to clear
 * @returns The payments to make, biggest first. Empty when everybody is level
 *   to within a cent.
 *
 * @example
 * ```ts
 * settleBalances(balances); // [{ fromPersonId: bob, toPersonId: alice, amount: 55.56 }]
 * ```
 */
export function settleBalances(
  balances: readonly PersonBalance[],
): SettlementPayment[] {
  // Cents, so a balance of 0.005 rounds to level rather than producing a
  // payment of nothing that the loop then never manages to clear.
  const creditors = balances
    .map((row) => ({ personId: row.personId, cents: Math.round(row.balance * 100) }))
    .filter((row) => row.cents > 0)
    .sort((left, right) => right.cents - left.cents || left.personId.localeCompare(right.personId));

  const debtors = balances
    .map((row) => ({ personId: row.personId, cents: -Math.round(row.balance * 100) }))
    .filter((row) => row.cents > 0)
    .sort((left, right) => right.cents - left.cents || left.personId.localeCompare(right.personId));

  const payments: SettlementPayment[] = [];

  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    if (creditor === undefined || debtor === undefined) {
      break;
    }

    const cents = Math.min(creditor.cents, debtor.cents);
    if (cents > 0) {
      payments.push({
        fromPersonId: debtor.personId,
        toPersonId: creditor.personId,
        amount: cents / 100,
      });
    }

    creditor.cents -= cents;
    debtor.cents -= cents;

    if (creditor.cents === 0) {
      creditorIndex += 1;
    }
    if (debtor.cents === 0) {
      debtorIndex += 1;
    }
  }

  return payments;
}

/**
 * Whether the accounts are level.
 *
 * @param balances - The balances to check
 * @returns True when nobody is owed and nobody owes, to within a cent
 */
export function isSettled(balances: readonly PersonBalance[]): boolean {
  return balances.every((row) => Math.round(row.balance * 100) === 0);
}
