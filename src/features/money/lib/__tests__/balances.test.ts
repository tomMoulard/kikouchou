/**
 * @fileoverview The money page's arithmetic, checked to the cent.
 *
 * The page is only worth having if its figures are right, so three invariants
 * are pinned here and then hammered with generated accounts:
 *
 * 1. every line's shares add up to that line's amount;
 * 2. every trip's balances add up to zero;
 * 3. the settling payments clear every balance exactly, in fewer payments than
 *    there are guests.
 *
 * The generated cases use a seeded pseudo-random source rather than
 * `Math.random`, so a failure is reproducible from the test name alone.
 *
 * @module features/money/lib/__tests__/balances.test
 */

import { describe, expect, it } from 'vitest';

import {
  computeBalances,
  isSettled,
  settleBalances,
} from '@/features/money/lib/balances';
import type { PersonBalance } from '@/features/money/lib/balances';
import { computeExpenseShares } from '@/features/money/lib/expense-split';
import type {
  Expense,
  ExpenseId,
  ExpenseKind,
  ExpenseSplitMode,
  PersonId,
  TripId,
} from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP = 'trip' as TripId;
const ALICE = 'alice' as PersonId;
const BOB = 'bob' as PersonId;
const CLAIRE = 'claire' as PersonId;
const DAVID = 'david' as PersonId;

const NIGHTS = new Map<PersonId, number>([
  [ALICE, 6],
  [BOB, 2],
  [CLAIRE, 4],
  [DAVID, 0],
]);

let nextId = 0;

/**
 * One money line, with the fields a balance actually reads.
 */
function line(overrides: Partial<Expense> = {}): Expense {
  nextId += 1;
  return {
    id: `e${nextId}` as ExpenseId,
    tripId: TRIP,
    kind: 'expense',
    category: 'other',
    title: 'A line',
    date: '2026-07-02',
    amount: 100,
    payerId: ALICE,
    splitMode: 'equal',
    splits: [
      { personId: ALICE, value: 1 },
      { personId: BOB, value: 1 },
    ],
    ...overrides,
  } as Expense;
}

/** A balance in cents, so an assertion never depends on float noise. */
function cents(value: number): number {
  return Math.round(value * 100);
}

function balanceOf(balances: readonly PersonBalance[], personId: PersonId): number {
  return balances.find((row) => row.personId === personId)?.balance ?? 0;
}

/**
 * A seeded pseudo-random source (mulberry32), so a generated case that fails is
 * the same case on the next run.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EVERY_KIND: readonly ExpenseKind[] = ['expense', 'income', 'transfer'];
const EVERY_MODE: readonly ExpenseSplitMode[] = ['equal', 'shares', 'nights', 'amounts'];

/**
 * Builds one trip's worth of lines: random kinds, rules, payers, amounts and
 * beneficiaries drawn from the four guests.
 */
function generateExpenses(random: () => number, count: number): Expense[] {
  const people = [ALICE, BOB, CLAIRE, DAVID];
  const pick = <T,>(values: readonly T[]): T =>
    values[Math.floor(random() * values.length)] ?? (values[0] as T);

  const expenses: Expense[] = [];

  for (let index = 0; index < count; index += 1) {
    const kind = pick(EVERY_KIND);
    const payerId = pick(people);
    // Two decimals, like a receipt.
    const amount = Math.round(random() * 50000) / 100 + 0.01;

    if (kind === 'transfer') {
      const others = people.filter((person) => person !== payerId);
      expenses.push(
        line({
          kind,
          payerId,
          amount,
          splitMode: 'equal',
          splits: [{ personId: pick(others), value: amount }],
        }),
      );
      continue;
    }

    const beneficiaries = people.filter(() => random() < 0.7);
    const splitMode = pick(EVERY_MODE);
    expenses.push(
      line({
        kind,
        payerId,
        amount,
        splitMode,
        splits: beneficiaries.map((personId) => ({
          personId,
          value:
            splitMode === 'amounts'
              ? Math.round(random() * amount * 100) / 100
              : Math.floor(random() * 5) + 1,
        })),
      }),
    );
  }

  return expenses;
}

// ============================================================================
// Tests: one line at a time
// ============================================================================

describe('computeBalances', () => {
  it('credits the payer and debits the guests the line was for', () => {
    const balances = computeBalances([
      line({
        amount: 100,
        payerId: ALICE,
        splits: [
          { personId: ALICE, value: 1 },
          { personId: BOB, value: 1 },
        ],
      }),
    ]);

    expect(cents(balanceOf(balances, ALICE))).toBe(cents(50));
    expect(cents(balanceOf(balances, BOB))).toBe(cents(-50));
  });

  it('leaves a payer who was the only beneficiary exactly level', () => {
    const balances = computeBalances([
      line({ amount: 80, payerId: ALICE, splits: [{ personId: ALICE, value: 1 }] }),
    ]);

    expect(cents(balanceOf(balances, ALICE))).toBe(0);
    expect(isSettled(balances)).toBe(true);
  });

  it('runs an income the other way round', () => {
    // Alice received 60 that belongs to Alice and Bob equally: she is holding
    // 30 of Bob's money.
    const balances = computeBalances([
      line({
        kind: 'income',
        amount: 60,
        payerId: ALICE,
        splits: [
          { personId: ALICE, value: 1 },
          { personId: BOB, value: 1 },
        ],
      }),
    ]);

    expect(cents(balanceOf(balances, ALICE))).toBe(cents(-30));
    expect(cents(balanceOf(balances, BOB))).toBe(cents(30));
  });

  it('cancels a debt with the transfer that pays it', () => {
    const expense = line({
      amount: 100,
      payerId: ALICE,
      splits: [
        { personId: ALICE, value: 1 },
        { personId: BOB, value: 1 },
      ],
    });
    const payment = line({
      kind: 'transfer',
      amount: 50,
      payerId: BOB,
      splits: [{ personId: ALICE, value: 50 }],
    });

    expect(isSettled(computeBalances([expense, payment]))).toBe(true);
  });

  it('divides by the nights when the line says to', () => {
    const balances = computeBalances(
      [
        line({
          amount: 800,
          payerId: ALICE,
          splitMode: 'nights',
          splits: [
            { personId: ALICE, value: 1 },
            { personId: BOB, value: 1 },
          ],
        }),
      ],
      NIGHTS,
    );

    // Six nights against two: Alice owes 600 of her own 800, Bob owes 200.
    expect(cents(balanceOf(balances, ALICE))).toBe(cents(200));
    expect(cents(balanceOf(balances, BOB))).toBe(cents(-200));
  });

  it('divides by the parts when the line says to', () => {
    const balances = computeBalances([
      line({
        amount: 100,
        payerId: ALICE,
        splitMode: 'shares',
        splits: [
          { personId: ALICE, value: 1 },
          { personId: BOB, value: 5 },
          { personId: CLAIRE, value: 3 },
        ],
      }),
    ]);

    expect(cents(balanceOf(balances, ALICE))).toBe(cents(88.89));
    expect(cents(balanceOf(balances, BOB))).toBe(cents(-55.56));
    expect(cents(balanceOf(balances, CLAIRE))).toBe(cents(-33.33));
  });

  it('reports what each guest put in and what their shares came to', () => {
    const balances = computeBalances([
      line({
        amount: 90,
        payerId: ALICE,
        splits: [
          { personId: ALICE, value: 1 },
          { personId: BOB, value: 1 },
          { personId: CLAIRE, value: 1 },
        ],
      }),
    ]);

    const alice = balances.find((row) => row.personId === ALICE);
    expect(cents(alice?.paid ?? 0)).toBe(cents(90));
    expect(cents(alice?.owed ?? 0)).toBe(cents(30));
  });

  it('ignores a line that moves no money', () => {
    const balances = computeBalances([
      line({ amount: 0 }),
      line({ amount: 100, splits: [] }),
    ]);

    expect(balances).toEqual([]);
  });

  it('ignores a night split nobody has a night for', () => {
    const balances = computeBalances(
      [
        line({
          amount: 100,
          payerId: ALICE,
          splitMode: 'nights',
          splits: [{ personId: DAVID, value: 1 }],
        }),
      ],
      NIGHTS,
    );

    expect(balances).toEqual([]);
  });

  it('adds every line of a guest up across the whole trip', () => {
    const balances = computeBalances([
      line({
        amount: 30,
        payerId: ALICE,
        splits: [
          { personId: ALICE, value: 1 },
          { personId: BOB, value: 1 },
        ],
      }),
      line({
        amount: 50,
        payerId: BOB,
        splits: [
          { personId: ALICE, value: 1 },
          { personId: BOB, value: 1 },
        ],
      }),
    ]);

    // Alice put in 30 and owes 15 + 25; Bob put in 50 and owes the same 40.
    expect(cents(balanceOf(balances, ALICE))).toBe(cents(-10));
    expect(cents(balanceOf(balances, BOB))).toBe(cents(10));
  });

  it('lists the biggest creditor first', () => {
    const balances = computeBalances([
      line({
        amount: 100,
        payerId: BOB,
        splits: [
          { personId: ALICE, value: 1 },
          { personId: BOB, value: 1 },
        ],
      }),
    ]);

    expect(balances[0]?.personId).toBe(BOB);
  });
});

// ============================================================================
// Tests: settlement
// ============================================================================

describe('settleBalances', () => {
  it('names one payment for a two-guest debt', () => {
    const balances = computeBalances([
      line({
        amount: 100,
        payerId: ALICE,
        splits: [
          { personId: ALICE, value: 1 },
          { personId: BOB, value: 1 },
        ],
      }),
    ]);

    expect(settleBalances(balances)).toEqual([
      { fromPersonId: BOB, toPersonId: ALICE, amount: 50 },
    ]);
  });

  it('asks for nothing when everybody is level', () => {
    expect(settleBalances(computeBalances([]))).toEqual([]);
    expect(isSettled(computeBalances([]))).toBe(true);
  });

  it('sends the biggest debtor to the biggest creditor', () => {
    const balances: PersonBalance[] = [
      { personId: ALICE, paid: 100, owed: 0, balance: 100 },
      { personId: BOB, paid: 0, owed: 70, balance: -70 },
      { personId: CLAIRE, paid: 0, owed: 30, balance: -30 },
    ];

    expect(settleBalances(balances)).toEqual([
      { fromPersonId: BOB, toPersonId: ALICE, amount: 70 },
      { fromPersonId: CLAIRE, toPersonId: ALICE, amount: 30 },
    ]);
  });

  it('splits one debtor between two creditors', () => {
    const balances: PersonBalance[] = [
      { personId: ALICE, paid: 60, owed: 0, balance: 60 },
      { personId: BOB, paid: 40, owed: 0, balance: 40 },
      { personId: CLAIRE, paid: 0, owed: 100, balance: -100 },
    ];

    expect(settleBalances(balances)).toEqual([
      { fromPersonId: CLAIRE, toPersonId: ALICE, amount: 60 },
      { fromPersonId: CLAIRE, toPersonId: BOB, amount: 40 },
    ]);
  });

  it('never asks a guest who is level to pay anything', () => {
    const balances: PersonBalance[] = [
      { personId: ALICE, paid: 50, owed: 0, balance: 50 },
      { personId: BOB, paid: 0, owed: 50, balance: -50 },
      { personId: CLAIRE, paid: 20, owed: 20, balance: 0 },
    ];

    const payments = settleBalances(balances);

    expect(payments.every((payment) => payment.fromPersonId !== CLAIRE)).toBe(true);
    expect(payments.every((payment) => payment.toPersonId !== CLAIRE)).toBe(true);
  });

  it('rounds a sub-cent balance to level rather than naming a payment of nothing', () => {
    const balances: PersonBalance[] = [
      { personId: ALICE, paid: 0.004, owed: 0, balance: 0.004 },
      { personId: BOB, paid: 0, owed: 0.004, balance: -0.004 },
    ];

    expect(settleBalances(balances)).toEqual([]);
  });

  it('recorded as transfers, the payments settle the group', () => {
    const expenses = [
      line({
        amount: 120,
        payerId: ALICE,
        splits: [
          { personId: ALICE, value: 1 },
          { personId: BOB, value: 1 },
          { personId: CLAIRE, value: 1 },
        ],
      }),
      line({
        amount: 30,
        payerId: BOB,
        splits: [
          { personId: BOB, value: 1 },
          { personId: CLAIRE, value: 1 },
        ],
      }),
    ];

    const payments = settleBalances(computeBalances(expenses));
    const asTransfers = payments.map((payment) =>
      line({
        kind: 'transfer',
        amount: payment.amount,
        payerId: payment.fromPersonId,
        splits: [{ personId: payment.toPersonId, value: payment.amount }],
      }),
    );

    expect(isSettled(computeBalances([...expenses, ...asTransfers]))).toBe(true);
  });
});

// ============================================================================
// Tests: the invariants, over generated accounts
// ============================================================================

describe('the arithmetic holds over generated accounts', () => {
  const SEEDS = [1, 2, 3, 7, 11, 42, 99, 1234, 20260710, 987654321];

  for (const seed of SEEDS) {
    describe(`seed ${seed}`, () => {
      const random = seeded(seed);
      const expenses = generateExpenses(random, 40);
      const balances = computeBalances(expenses, NIGHTS);
      const payments = settleBalances(balances);

      it("every line's shares add up to its own amount", () => {
        for (const expense of expenses) {
          const shares = computeExpenseShares(expense, NIGHTS);
          const total = shares.reduce((sum, share) => sum + cents(share.amount), 0);

          // A line nobody benefited from, or one whose rule gives every
          // beneficiary a weight of zero, divides nothing at all. Any other
          // line divides its amount exactly.
          expect([0, cents(expense.amount)]).toContain(total);
        }
      });

      it('the balances add up to zero', () => {
        const total = balances.reduce((sum, row) => sum + cents(row.balance), 0);

        expect(total).toBe(0);
      });

      it('what each guest owes is what their shares came to', () => {
        for (const row of balances) {
          expect(cents(row.balance)).toBe(cents(row.paid) - cents(row.owed));
        }
      });

      it('no share and no payment is a fraction of a cent', () => {
        for (const expense of expenses) {
          for (const share of computeExpenseShares(expense, NIGHTS)) {
            expect(Number.isInteger(cents(share.amount))).toBe(true);
            expect(share.amount).toBeGreaterThanOrEqual(0);
          }
        }
        for (const payment of payments) {
          expect(payment.amount).toBeGreaterThan(0);
        }
      });

      it('the payments clear every balance exactly', () => {
        const cleared = new Map<PersonId, number>(
          balances.map((row) => [row.personId, cents(row.balance)]),
        );

        for (const payment of payments) {
          cleared.set(
            payment.fromPersonId,
            (cleared.get(payment.fromPersonId) ?? 0) + cents(payment.amount),
          );
          cleared.set(
            payment.toPersonId,
            (cleared.get(payment.toPersonId) ?? 0) - cents(payment.amount),
          );
        }

        for (const remaining of cleared.values()) {
          expect(remaining).toBe(0);
        }
      });

      it('nobody is asked to pay somebody who owes money, or to pay themselves', () => {
        const byPerson = new Map<PersonId, number>(
          balances.map((row) => [row.personId, cents(row.balance)]),
        );

        for (const payment of payments) {
          expect(payment.fromPersonId).not.toBe(payment.toPersonId);
          expect(byPerson.get(payment.fromPersonId) ?? 0).toBeLessThan(0);
          expect(byPerson.get(payment.toPersonId) ?? 0).toBeGreaterThan(0);
        }
      });

      it('there are fewer payments than there are guests', () => {
        const involved = new Set<PersonId>();
        for (const payment of payments) {
          involved.add(payment.fromPersonId);
          involved.add(payment.toPersonId);
        }

        if (involved.size > 0) {
          expect(payments.length).toBeLessThanOrEqual(involved.size - 1);
        }
      });

      it('recording every payment leaves the group settled', () => {
        const asTransfers = payments.map((payment) =>
          line({
            kind: 'transfer',
            amount: payment.amount,
            payerId: payment.fromPersonId,
            splits: [{ personId: payment.toPersonId, value: payment.amount }],
          }),
        );

        expect(isSettled(computeBalances([...expenses, ...asTransfers], NIGHTS))).toBe(
          true,
        );
      });
    });
  }
});
