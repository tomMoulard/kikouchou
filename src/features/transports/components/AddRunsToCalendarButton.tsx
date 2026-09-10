/**
 * @fileoverview "Add my runs to my calendar" — the button that answers the
 * settings card's own warning.
 *
 * Ride alerts come from this device and reach the driver only while the app is
 * open or was used recently. Nothing in a browser fixes that. What does fix it
 * is handing the run to software that already wakes on time: the calendar on
 * the driver's phone, which fires its alarm with Kikouchou closed, on a plane,
 * on a phone with no network.
 *
 * The button is the driver's own, and shows only to a browser that has a guest
 * identity with runs to drive. An owner planning for everybody has no "my runs"
 * to export, and a driver with nothing ahead has an empty file.
 *
 * @module features/transports/components/AddRunsToCalendarButton
 */

import { type ReactElement, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CalendarPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';
// From the module rather than the `@/hooks` barrel, for the reason
// `DriverAlert` gives: a test that stubs the barrel to get one hook makes this
// component throw on an export the stub never listed.
import { useTripIdentity } from '@/hooks/useTripIdentity';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { buildIcsCalendar, ICS_MIME_TYPE } from '@/lib/calendar/ics';
import posthog from '@/lib/posthog';
import { downloadTextFile, toFilenameSegment } from '@/lib/utils/download';
import { formatTransportDatetime } from '@/lib/utils/datetime-format';
import {
  RIDE_ALARM_MINUTES_BEFORE,
  selectExportableRides,
  toRideCalendarEvents,
  type RideCalendarLabels,
} from '@/features/transports/utils/ride-ics';
import { resolveRides, selectRidesDrivenBy } from '@/features/transports/utils/ride-model';

// ============================================================================
// Type Definitions
// ============================================================================

/** Props for {@link AddRunsToCalendarButton}. */
export interface AddRunsToCalendarButtonProps {
  /** Optional className for additional styling. */
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Downloads the reader's own upcoming runs as one calendar file.
 *
 * Renders nothing when this browser is nobody in the trip, or when that guest
 * drives nothing that is still ahead: a button whose file would be empty
 * teaches people that the feature does not work.
 *
 * @param props - Component props
 * @returns The button, or null when there is nothing to export
 */
export const AddRunsToCalendarButton = memo(function AddRunsToCalendarButton({
  className,
}: AddRunsToCalendarButtonProps): ReactElement | null {
  const { t, i18n } = useTranslation(),
    { currentTrip } = useTripContext(),
    { persons } = usePersonContext(),
    { transports, nowMs } = useTransportContext(),
    { rides, vehicles } = useRideContext(),
    // The same identity the departure banner answers to: the driver who is
    // told to leave and the driver who exports the runs must be one person.
    { myPersonId } = useTripIdentity();

  const dateLocale = getDateLocale(i18n.language);

  const myRuns = useMemo(
    () =>
      selectExportableRides(
        selectRidesDrivenBy(
          resolveRides({ transports, rides, vehicles, persons }),
          myPersonId,
        ),
        nowMs,
      ),
    [transports, rides, vehicles, persons, myPersonId, nowMs],
  );

  const handleExport = useCallback((): void => {
    const labels: RideCalendarLabels = {
      summary: ({ direction, passengers, location }) => {
        // A car with nobody listed yet still earns a block in the calendar:
        // the driver agreed to be somewhere at a time, and who rides in it is
        // exactly the detail that gets filled in late.
        if (passengers === '') {
          return direction === 'pickup'
            ? t('transports.calendar.pickupEmpty', {
                defaultValue: 'Pick-up at {{location}}',
                location,
              })
            : t('transports.calendar.dropoffEmpty', {
                defaultValue: 'Drop-off at {{location}}',
                location,
              });
        }

        return direction === 'pickup'
          ? t('transports.calendar.pickup', {
              defaultValue: 'Pick up {{passengers}} at {{location}}',
              passengers,
              location,
            })
          : t('transports.calendar.dropoff', {
              defaultValue: 'Drop off {{passengers}} at {{location}}',
              passengers,
              location,
            });
      },
      passengersLine: (passengers) =>
        t('transports.calendar.passengers', {
          defaultValue: 'Passengers: {{passengers}}',
          passengers,
        }),
      meetLine: (meetTime) =>
        t('transports.calendar.meetAt', { defaultValue: 'Be there at {{time}}', time: meetTime }),
      vehicleLine: (vehicle) =>
        t('transports.calendar.vehicle', { defaultValue: 'Car: {{vehicle}}', vehicle }),
      unknownPassenger: t('transports.calendar.unknownPassenger', 'A guest'),
    };

    const events = toRideCalendarEvents({
        journeys: myRuns,
        labels,
        formatDateTime: (ms) =>
          formatTransportDatetime(new Date(ms).toISOString(), dateLocale, 'dayAndTime'),
      }),
      tripName = currentTrip?.name ?? '',
      ics = buildIcsCalendar(events, {
        nowMs,
        name: t('transports.calendar.calendarName', {
          defaultValue: '{{trip}} — your runs',
          trip: tripName,
        }),
      });

    const started = downloadTextFile({
      filename: `${toFilenameSegment(tripName, 'kikouchou')}-runs.ics`,
      text: ics,
      mimeType: ICS_MIME_TYPE,
    });

    if (!started) {
      toast.error(
        t(
          'transports.calendar.failed',
          'This browser cannot save the file. Open Kikouchou in another browser to export your runs.',
        ),
      );
      return;
    }

    posthog?.capture('run_calendar_exported', {
      ride_count: events.length,
      alarm_minutes_before: RIDE_ALARM_MINUTES_BEFORE,
    });

    toast.success(
      t('transports.calendar.downloaded', {
        defaultValue: 'One run saved to a calendar file',
        defaultValue_other: '{{count}} runs saved to a calendar file',
        count: events.length,
      }),
      {
        description: t(
          'transports.calendar.downloadedHint',
          'Open the file to add the runs to your own calendar. Its alarm rings with Kikouchou closed.',
        ),
      },
    );
  }, [myRuns, currentTrip, dateLocale, nowMs, t]);

  if (myPersonId === undefined || myRuns.length === 0) {
    return null;
  }

  return (
    <Button variant="outline" size="sm" className={className} onClick={handleExport}>
      <CalendarPlus className="mr-2 size-4" aria-hidden="true" />
      {t('transports.calendar.addRuns', 'Add my runs to my calendar')}
    </Button>
  );
});
