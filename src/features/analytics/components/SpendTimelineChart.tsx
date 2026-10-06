/**
 * @fileoverview The trip's spending, drawn as one line along the calendar.
 *
 * One line and not a row of bars: the line is the money the trip has cost so
 * far, so a single stroke carries every fact the page has about spending — when
 * it started, how fast it climbed, the day the house was paid for, a refund
 * pulling it back down, and where it ends up, which is the "Spent" card above.
 * Its steepness *is* the daily amount, so nothing is lost by drawing it once.
 *
 * The path is an `<svg>` because a line needs one. Everything a reader has to
 * read — the axis dates, the end total — stays HTML beside it, so text keeps
 * the page's own size on a phone instead of scaling with a viewBox.
 *
 * @module features/analytics/components/SpendTimelineChart
 */

import { type ReactElement, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type Locale, format, parseISO } from 'date-fns';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SpendBucket, SpendTimeline } from '@/features/analytics/lib/spend-timeline';
import { getDateLocale } from '@/lib/i18n/date-locale';

// ============================================================================
// Constants
// ============================================================================

/** How many dates the axis carries at most. */
const MAX_AXIS_LABELS = 6;

/**
 * The drawing's own coordinate space.
 *
 * The `<svg>` is stretched to whatever width the card gives it
 * (`preserveAspectRatio="none"`), so these numbers decide the *shape* of the
 * line and nothing about its size on screen. The stroke is drawn
 * non-scaling, or stretching the box would smear it.
 */
const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 240;

/** Room above the highest point, so the line never touches the card's edge. */
const VIEW_PADDING = 8;

/** Date patterns per bar width. A month step names its month, not its first day. */
const BUCKET_LABEL_FORMAT: Record<SpendTimeline['unit'], string> = {
  day: 'd MMM',
  week: 'd MMM',
  month: 'MMM yyyy',
};

// ============================================================================
// Types
// ============================================================================

export interface SpendTimelineChartProps {
  /** The series to draw, already bucketed by `buildSpendTimeline`. */
  readonly timeline: SpendTimeline;
  /** The trip's own money formatter, so the line carries its currency. */
  readonly formatMoney: (amount: number) => string;
}

/** One point of the line: a bucket, what it cost, and the total by then. */
interface SpendPoint {
  /** The stretch of calendar this point sits at the end of. */
  readonly bucket: SpendBucket;
  /** The bucket named in full, for the tooltip and the table. */
  readonly label: string;
  /** The same date, short, for the axis. */
  readonly axisLabel: string;
  /** What the trip had spent in all by the end of this bucket. */
  readonly cumulative: number;
  /** Where the point sits across the drawing. */
  readonly x: number;
  /** Where it sits up the drawing. */
  readonly y: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Names one bucket for a human: the day, the week, or the month.
 *
 * @param bucket - The bucket.
 * @param unit - How wide the bucket is.
 * @param locale - date-fns locale for the reader's language.
 * @returns The label, or the raw key when the date cannot be parsed.
 */
function formatBucketLabel(
  bucket: SpendBucket,
  unit: SpendTimeline['unit'],
  locale: Locale,
): string {
  const start = parseISO(bucket.start);
  if (Number.isNaN(start.getTime())) {
    return bucket.start;
  }
  const label = format(start, BUCKET_LABEL_FORMAT[unit], { locale });
  if (unit !== 'week') {
    return label;
  }
  const end = parseISO(bucket.end);
  if (Number.isNaN(end.getTime())) {
    return label;
  }
  return `${label} - ${format(end, BUCKET_LABEL_FORMAT.week, { locale })}`;
}

/**
 * The date the axis carries, which is where the bucket starts and nothing else.
 *
 * @param bucket - The bucket.
 * @param unit - How wide the bucket is.
 * @param locale - date-fns locale for the reader's language.
 * @returns The short label, or the raw key when the date cannot be parsed.
 */
function formatAxisLabel(
  bucket: SpendBucket,
  unit: SpendTimeline['unit'],
  locale: Locale,
): string {
  const start = parseISO(bucket.start);
  if (Number.isNaN(start.getTime())) {
    return bucket.start;
  }
  return format(start, BUCKET_LABEL_FORMAT[unit], { locale });
}

// ============================================================================
// Component
// ============================================================================

const SpendTimelineChart = memo(function SpendTimelineChart({
  timeline,
  formatMoney,
}: SpendTimelineChartProps): ReactElement {
  const { t, i18n } = useTranslation();
  const locale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  const { unit, buckets, total } = timeline;

  const { points, ceiling, floor } = useMemo<{
    readonly points: readonly SpendPoint[];
    readonly ceiling: number;
    readonly floor: number;
  }>(() => {
    // Cents while the running total is built, then back: the line's last point
    // has to land on the very figure the "Spent" card prints, and a hundred
    // float additions do not.
    const running: { bucket: SpendBucket; cumulative: number }[] = [];
    let runningCents = 0;
    for (const bucket of buckets) {
      runningCents += Math.round(bucket.amount * 100);
      running.push({ bucket, cumulative: runningCents / 100 });
    }

    // The floor is zero even when the trip never dips below it, so a flat start
    // reads as "nothing spent yet" rather than as the bottom of the card.
    const ceiling = Math.max(0, ...running.map((entry) => entry.cumulative));
    const floor = Math.min(0, ...running.map((entry) => entry.cumulative));
    const span = ceiling - floor;
    const usableHeight = VIEW_HEIGHT - VIEW_PADDING * 2;
    const lastIndex = Math.max(1, running.length - 1);

    const points = running.map((entry, index) => ({
      bucket: entry.bucket,
      label: formatBucketLabel(entry.bucket, unit, locale),
      axisLabel: formatAxisLabel(entry.bucket, unit, locale),
      cumulative: entry.cumulative,
      // One point sits in the middle rather than at the left edge: a single
      // day of spending is a dot, and a dot in a corner reads as a glitch.
      x:
        running.length === 1
          ? VIEW_WIDTH / 2
          : (index / lastIndex) * VIEW_WIDTH,
      // A lone point is a dot with no slope to read, so it sits in the middle:
      // at the top of a scale it invented for itself it would read as a trip
      // that spent everything at the last moment.
      y:
        running.length === 1 || span === 0
          ? VIEW_HEIGHT / 2
          : VIEW_PADDING +
            usableHeight -
            ((entry.cumulative - floor) / span) * usableHeight,
    }));

    return { points, ceiling, floor };
  }, [buckets, unit, locale]);

  const linePath = useMemo(
    () =>
      points
        .map(
          (point, index) =>
            `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
        )
        .join(' '),
    [points],
  );

  // The same line closed onto the floor of the card. The fill is what makes a
  // climbing line read as an accumulating amount rather than as a rate.
  const areaPath = useMemo(() => {
    const first = points[0];
    const last = points[points.length - 1];
    if (first === undefined || last === undefined) {
      return '';
    }
    return `${linePath} L ${last.x.toFixed(2)} ${VIEW_HEIGHT} L ${first.x.toFixed(2)} ${VIEW_HEIGHT} Z`;
  }, [linePath, points]);

  // One date every few points, the first and the last always among them, so the
  // axis states the span it covers rather than a sample of its middle.
  const axisLabels = useMemo(() => {
    const step = Math.max(1, Math.ceil(points.length / MAX_AXIS_LABELS));
    const picked = points.filter((_, index) => index % step === 0);
    const last = points[points.length - 1];
    if (last !== undefined && picked[picked.length - 1] !== last) {
      picked.push(last);
    }
    return picked.map((point) => ({
      start: point.bucket.start,
      text: point.axisLabel,
    }));
  }, [points]);

  return (
    <Card className="mt-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {t('analytics.spendTimeline')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className="mb-4 text-xs text-muted-foreground"
          data-testid="spend-timeline-unit"
        >
          {t('analytics.spendTimelineCaption', {
            step: t(`analytics.spendTimelineUnit.${unit}`),
            total: formatMoney(total),
          })}
        </p>

        {/* The drawing is one image to a screen reader — a path and thirty
            hover targets read out one by one is noise. The table below carries
            the same numbers in a form a reader can actually walk. */}
        <div
          className="relative h-32 w-full sm:h-44"
          role="img"
          aria-label={t('analytics.spendTimelineAriaLabel', {
            count: buckets.length,
            total: formatMoney(total),
          })}
          data-testid="spend-timeline-chart"
        >
          <svg
            className="h-full w-full overflow-visible"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <path d={areaPath} className="fill-primary/10" />
            <path
              d={linePath}
              className="stroke-primary"
              fill="none"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              // Without this the stretched viewBox smears the stroke: thick
              // where the card is wide, hairline where it is tall.
              vectorEffect="non-scaling-stroke"
              data-testid="spend-timeline-line"
            />
          </svg>

          {/* The two figures that give the line a scale: what it ends on, and
              the zero it started from. Without them a climbing line says the
              shape of the spending without saying its size. */}
          {/* Left rather than right, and on a backdrop: the line ends at the
              right edge, where a figure printed over it is unreadable, and a
              trip that spends everything on day one runs into the top-left
              instead. */}
          <span className="pointer-events-none absolute left-0 top-0 rounded bg-card/80 px-1 text-[10px] leading-none text-muted-foreground">
            {formatMoney(ceiling)}
          </span>
          <span className="pointer-events-none absolute bottom-0 left-0 rounded bg-card/80 px-1 text-[10px] leading-none text-muted-foreground">
            {formatMoney(floor)}
          </span>

          {/* Hover targets, one per point, laid over the drawing. They are
              HTML rather than SVG circles so the stretch cannot turn them into
              ellipses, and so each carries its own native tooltip. */}
          <div className="absolute inset-0 flex">
            {points.map((point) => (
              <div
                key={point.bucket.start}
                className="min-w-0 flex-1"
                title={t('analytics.spendTimelinePointTitle', {
                  when: point.label,
                  amount: formatMoney(point.bucket.amount),
                  total: formatMoney(point.cumulative),
                })}
                data-testid="spend-timeline-point"
                data-bucket-start={point.bucket.start}
                data-bucket-amount={point.bucket.amount}
                data-bucket-total={point.cumulative}
              />
            ))}
          </div>
        </div>

        {/* Spread between the two ends rather than one label per point: a label
            in its own point-width box is four pixels wide on a phone, and a
            fortnight of dates printed over each other is a grey smear. */}
        <div className="mt-2 flex justify-between gap-2 text-[10px] leading-tight text-muted-foreground">
          {axisLabels.map((label) => (
            <span key={label.start} className="whitespace-nowrap">
              {label.text}
            </span>
          ))}
        </div>

        <table className="sr-only">
          <caption>{t('analytics.spendTimeline')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('analytics.spendTimelineWhen')}</th>
              <th scope="col">{t('analytics.spendTotal')}</th>
              <th scope="col">{t('analytics.spendTimelineRunningTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.bucket.start}>
                <th scope="row">{point.label}</th>
                <td>{formatMoney(point.bucket.amount)}</td>
                <td>{formatMoney(point.cumulative)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
});

export { SpendTimelineChart };
