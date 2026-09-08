/**
 * @fileoverview The "only mine / everyone" control above the transport views.
 *
 * A filter that quietly empties a page reads as data loss, so this control has
 * two jobs and the second matters more than the first: switch the scope, and
 * say out loud how many rows the current scope is hiding, with `all` one tap
 * away. The count lives in a live region that is mounted whether or not it has
 * anything to say — a region inserted at the same moment as its text is
 * routinely not announced at all.
 *
 * A segmented control rather than a `Switch`: the two states are both named
 * ("Only mine" / "Everyone"), and a switch has room for one label, which leaves
 * "off" meaning whatever the reader assumes. It is also what
 * `ActivityListPage` already uses for a URL-persisted view choice.
 *
 * @module features/transports/components/TransportScopeFilter
 */

import { type ReactElement, memo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { User, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ViewSwitcher } from '@/components/ui/view-switcher';
import type { TransportScope } from '@/features/transports/utils/transport-scope';
import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

/** Props for {@link TransportScopeFilter}. */
export interface TransportScopeFilterProps {
  /** The scope in force. */
  readonly scope: TransportScope;
  /** False when nobody is identified, which is when the hint replaces the control. */
  readonly canFilter: boolean;
  /** How many rows the current scope is hiding. */
  readonly hiddenCount: number;
  /** Called with the newly chosen scope. */
  readonly onScopeChange: (scope: TransportScope) => void;
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Switches a transport view between "everything that concerns me" and the whole
 * trip's logistics.
 *
 * @param props - The scope, whether it can be applied, and what it is hiding
 * @returns The scope control, or the hint that points at Settings
 */
export const TransportScopeFilter = memo(function TransportScopeFilter({
  scope,
  canFilter,
  hiddenCount,
  onScopeChange,
  className,
}: TransportScopeFilterProps): ReactElement {
  const { t } = useTranslation(),
    handleShowAll = useCallback((): void => {
      onScopeChange('all');
    }, [onScopeChange]);

  if (!canFilter) {
    return (
      <p className={cn('mb-4 text-sm text-muted-foreground', className)}>
        {t(
          'transports.scope.unknownIdentity',
          'Tell the app which guest you are to see only your own travel.',
        )}{' '}
        <Link
          to="/settings"
          className="rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('transports.scope.chooseIdentity', 'Choose in Settings')}
        </Link>
      </p>
    );
  }

  return (
    <div className={cn('mb-4 flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <ViewSwitcher
        value={scope}
        onValueChange={onScopeChange}
        ariaLabel={t('transports.scope.label', 'Whose transport to show')}
        options={[
          {
            value: 'mine',
            label: (
              <>
                <User className="size-4" aria-hidden="true" />
                {t('identity.scopeMine', 'Only mine')}
              </>
            ),
          },
          {
            value: 'all',
            label: (
              <>
                <Users className="size-4" aria-hidden="true" />
                {t('identity.scopeAll', 'Everyone')}
              </>
            ),
          },
        ]}
        className="w-full sm:w-[260px]"
      />

      {/*
        Mounted whether or not it has anything to say. A live region created in
        the same tick as its first message is announced by roughly nothing.
      */}
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        {scope === 'mine' && hiddenCount > 0 ? (
          <>
            <span>
              {t('transports.scope.hidden', {
                count: hiddenCount,
                defaultValue_one: '{{count}} other transport hidden',
                defaultValue_other: '{{count}} other transports hidden',
              })}
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={handleShowAll}
            >
              {t('transports.scope.showAll', 'Show everyone')}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
});
