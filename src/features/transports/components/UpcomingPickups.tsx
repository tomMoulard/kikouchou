/**
 * @fileoverview Upcoming Pickups component displays transports that need pickup.
 * Shows a collapsible list sorted by datetime with relative time display.
 *
 * @module features/transports/components/UpcomingPickups
 */

import {
  memo,
  useCallback,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow, format, isToday, isTomorrow, parseISO } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Car,
  ChevronDown,
  ChevronUp,
  Clock,
  MapPin,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { cn } from '@/lib/utils';
import type { Person, PersonId, Transport } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Number of items to show initially before collapsing.
 */
const INITIAL_DISPLAY_COUNT = 3;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the UpcomingPickups component.
 */
export interface UpcomingPickupsProps {
  /** Optional maximum number of items to display initially. Defaults to 3. */
  readonly initialDisplayCount?: number;
  /** Optional className for additional styling. */
  readonly className?: string;
}

/**
 * Props for the PickupItem subcomponent.
 */
interface PickupItemProps {
  /** The transport to display */
  readonly transport: Transport;
  /** The person associated with this transport (if found) */
  readonly person: Person | undefined;
  /** Date locale for formatting */
  readonly dateLocale: typeof fr | typeof enUS;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Gets the date-fns locale based on the current i18n language.
 */
function getDateLocale(language: string): typeof fr | typeof enUS {
  return language === 'fr' ? fr : enUS;
}

/**
 * Formats a datetime string into a relative time display.
 * Shows "in X hours/minutes" for today, "tomorrow at HH:mm" for tomorrow,
 * and "Day at HH:mm" for other days.
 *
 * @param datetime - ISO datetime string
 * @param locale - date-fns locale
 * @param t - translation function from useTranslation
 * @returns Formatted relative time string
 */
function formatRelativeTime(
  datetime: string,
  locale: typeof fr | typeof enUS,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  try {
    const date = parseISO(datetime);
    if (isNaN(date.getTime())) {
      return t('common.unknown');
    }

    const now = new Date();
    
    // Check if the date is in the past
    if (date < now) {
      return t('upcomingPickups.overdue', { defaultValue: 'Overdue' });
    }

    // For today, show relative time
    if (isToday(date)) {
      return formatDistanceToNow(date, { locale, addSuffix: true });
    }

    // For tomorrow, show "tomorrow at HH:mm"
    if (isTomorrow(date)) {
      const time = format(date, 'HH:mm', { locale });
      return t('upcomingPickups.tomorrowAt', { time, defaultValue: 'Tomorrow at {{time}}' });
    }

    // For other days, show "Day, Month Date at HH:mm"
    return format(date, 'EEE d MMM HH:mm', { locale });
  } catch {
    return t('common.unknown');
  }
}

// ============================================================================
// PickupItem Subcomponent
// ============================================================================

/**
 * Individual pickup item displaying transport details.
 */
const PickupItem = memo(function PickupItem({
  transport,
  person,
  dateLocale,
}: PickupItemProps): ReactElement {
  const { t } = useTranslation();

  // Format the relative time
  const relativeTime = useMemo(
    () => formatRelativeTime(transport.datetime, dateLocale, t),
    [transport.datetime, dateLocale, t],
  );

  // Get transport type icon and label
  const TypeIcon = transport.type === 'arrival' ? ArrowDownToLine : ArrowUpFromLine;
  const typeLabel = transport.type === 'arrival' 
    ? t('transports.arrival') 
    : t('transports.departure');

  return (
    <div
      className={cn(
        'flex flex-col gap-2 py-3 px-2',
        'border-b border-border last:border-0',
      )}
      role="listitem"
    >
      {/* Header: Person and Type */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {person ? (
            <PersonBadge person={person} size="sm" />
          ) : (
            <span className="text-sm text-muted-foreground">
              {t('common.unknown')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <TypeIcon
            className={cn(
              'size-4 shrink-0',
              transport.type === 'arrival' ? 'text-green-600' : 'text-orange-600',
            )}
            aria-hidden="true"
          />
          <span className="text-muted-foreground">{typeLabel}</span>
        </div>
      </div>

      {/* Details: Time and Location */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {/* Relative time */}
        <div className="flex items-center gap-1.5">
          <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{relativeTime}</span>
        </div>

        {/* Location */}
        <div className="flex items-center gap-1.5">
          <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground truncate max-w-[150px] sm:max-w-[200px]" title={transport.location}>
            {transport.location}
          </span>
        </div>
      </div>
    </div>
  );
});

PickupItem.displayName = 'PickupItem';

// ============================================================================
// UpcomingPickups Component
// ============================================================================

/**
 * Displays a collapsible list of transports that need pickup.
 *
 * Features:
 * - Shows transports with `needsPickup === true` sorted by datetime
 * - Relative time display (e.g., "in 2 hours", "tomorrow at 14:00")
 * - Person name with PersonBadge
 * - Transport type indicator (arrival/departure)
 * - Location information
 * - Collapsible when list exceeds threshold
 * - Empty state handling
 * - Full i18n support
 *
 * @param props - Component props
 * @returns The upcoming pickups element
 *
 * @example
 * ```tsx
 * // Basic usage
 * <UpcomingPickups />
 *
 * // With custom initial count
 * <UpcomingPickups initialDisplayCount={5} />
 *
 * // With additional styling
 * <UpcomingPickups className="mt-4" />
 * ```
 */
const UpcomingPickups = memo(function UpcomingPickups({
  initialDisplayCount = INITIAL_DISPLAY_COUNT,
  className,
}: UpcomingPickupsProps): ReactElement {
  const { t, i18n } = useTranslation();
  const { upcomingPickups } = useTransportContext();
  const { persons } = usePersonContext();

  // Track expanded state
  const [isExpanded, setIsExpanded] = useState(false);

  // Get date locale
  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  // Build persons map for O(1) lookups
  const personsMap = useMemo(() => {
    const map = new Map<PersonId, Person>();
    for (const person of persons) {
      map.set(person.id, person);
    }
    return map;
  }, [persons]);

  // Determine if we need to show expand/collapse
  const hasMoreItems = upcomingPickups.length > initialDisplayCount;
  const visiblePickups = isExpanded 
    ? upcomingPickups 
    : upcomingPickups.slice(0, initialDisplayCount);

  // Handle toggle expand/collapse
  const handleToggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  // Count of hidden items
  const hiddenCount = upcomingPickups.length - initialDisplayCount;

  // ============================================================================
  // Render: Empty State
  // ============================================================================

  if (upcomingPickups.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Car className="size-5" aria-hidden="true" />
            {t('transports.upcomingPickups')}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground text-center">
            {t('upcomingPickups.empty', 'No upcoming pickups scheduled.')}
          </p>
        </CardContent>
      </Card>
    );
  }

  // ============================================================================
  // Render: Main Content
  // ============================================================================

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Car className="size-5" aria-hidden="true" />
          {t('transports.upcomingPickups')}
          <span className="ml-auto text-sm font-normal text-muted-foreground">
            {upcomingPickups.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 px-2">
        {/* Pickup List */}
        <div role="list" aria-label={t('transports.upcomingPickups')}>
          {visiblePickups.map((pickup) => {
            const person = personsMap.get(pickup.personId);
            return (
              <PickupItem
                key={pickup.id}
                transport={pickup}
                person={person}
                dateLocale={dateLocale}
              />
            );
          })}
        </div>

        {/* Expand/Collapse Button */}
        {hasMoreItems && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleExpanded}
            className="w-full mt-2 text-muted-foreground hover:text-foreground"
            aria-expanded={isExpanded}
            aria-controls="upcoming-pickups-list"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="size-4 mr-1" aria-hidden="true" />
                {t('upcomingPickups.showLess', 'Show less')}
              </>
            ) : (
              <>
                <ChevronDown className="size-4 mr-1" aria-hidden="true" />
                {t('upcomingPickups.showMore', { count: hiddenCount, defaultValue: `Show ${hiddenCount} more` })}
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
});

UpcomingPickups.displayName = 'UpcomingPickups';

// ============================================================================
// Exports
// ============================================================================

export { UpcomingPickups };
