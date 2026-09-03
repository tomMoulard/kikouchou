/**
 * @fileoverview One headline number, optionally with what it is made of.
 *
 * Shared by both analytics pages so a figure carries the same label and the
 * same shape wherever it appears.
 *
 * @module features/analytics/components/StatCard
 */

import { type ReactElement, memo } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface StatCardProps {
  /** What the number counts. */
  readonly label: string;
  /** The number itself. */
  readonly value: number | string;
  /**
   * Secondary line under the number, naming what it is made of — the guest
   * rows behind a headcount, the arrivals and departures behind a leg total.
   * Without it the reader cannot tell two similarly named figures apart.
   */
  readonly hint?: string;
  /**
   * Test hook placed on the number itself. Both analytics pages label their
   * cards through `t()`, so an end-to-end check of "do these two pages agree?"
   * would otherwise have to match translated text and would break in French.
   */
  readonly testId?: string;
  /** Extra classes for the card. */
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

const StatCard = memo(function StatCard({
  label,
  value,
  hint,
  testId,
  className,
}: StatCardProps): ReactElement {
  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums" data-testid={testId}>
          {value}
        </p>
        {hint !== undefined && hint !== '' && (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
});

export { StatCard };
