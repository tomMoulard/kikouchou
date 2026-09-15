/**
 * @fileoverview Tests for TemplateLandingPage.
 *
 * This is the screen a stranger meets. It has to explain itself with no account,
 * no trip and no history, so every phase is asserted here: the template that
 * opens, the link that is dead, the build with no server, and the failure that
 * is worth retrying.
 *
 * The load-bearing assertion is the prefill. The wizard is handed the place, the
 * pin, the currency and the rooms, and is left to ask for the name, the dates
 * and the guests — which is the entire product promise of the link.
 *
 * @module features/sharing/pages/__tests__/TemplateLandingPage.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { TemplateLandingPage } from '../TemplateLandingPage';
import { render } from '@/test/utils';
import { captureEvent } from '@/lib/posthog';
import { useTripTemplate } from '../../hooks/useTripTemplate';

// ============================================================================
// Test doubles
// ============================================================================

const navigate = vi.fn();

vi.mock('react-router-dom', async () => {
  // Partial: `@/test/utils` renders through a real `MemoryRouter`, so the
  // module cannot be replaced wholesale.
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useParams: () => ({ token: 'tokentokentoken1' }),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('../../hooks/useTripTemplate', () => ({ useTripTemplate: vi.fn() }));

const setCurrentTrip = vi.fn(async () => undefined);
vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({ setCurrentTrip }),
}));

vi.mock('@/lib/posthog', () => ({
  captureEvent: vi.fn(),
  reportError: vi.fn(),
}));

/** The wizard, reduced to what it was handed. */
const wizardProps = vi.fn();
vi.mock('@/features/trips/components/TripCreateWizard', () => ({
  TripCreateWizard: (props: Record<string, unknown>) => {
    wizardProps(props);
    return <div data-testid="wizard" />;
  },
}));

const retry = vi.fn();

const TEMPLATE = {
  name: 'Chalet Marmotte',
  description: 'Check-in after 3pm. Bring indoor shoes.',
  location: 'Chamonix',
  coordinates: { lat: 45.9237, lon: 6.8694 },
  currency: 'EUR',
  rooms: [{ name: 'Attic', capacity: 4, icon: 'bunk-bed' as const }],
};

function answering(phase: unknown): void {
  vi.mocked(useTripTemplate).mockReturnValue({ phase: phase as never, retry });
}

beforeEach(() => {
  vi.clearAllMocks();
  answering({ kind: 'ready', template: TEMPLATE });
});

// ============================================================================
// Tests
// ============================================================================

describe('TemplateLandingPage', () => {
  it('shows the template, and the description that guides the customer', () => {
    render(<TemplateLandingPage />, { withProviders: false });

    expect(screen.getByText('Chalet Marmotte')).toBeInTheDocument();
    expect(screen.getByText('Chamonix')).toBeInTheDocument();
    expect(screen.getByText(/Bring indoor shoes/)).toBeInTheDocument();
  });

  it('hands the wizard the place, the pin, the currency and the rooms', () => {
    render(<TemplateLandingPage />, { withProviders: false });

    expect(wizardProps).toHaveBeenCalledWith(
      expect.objectContaining({
        prefill: {
          description: 'Check-in after 3pm. Bring indoor shoes.',
          location: 'Chamonix',
          coordinates: { lat: 45.9237, lon: 6.8694 },
          currency: 'EUR',
          rooms: [{ name: 'Attic', capacity: 4, icon: 'bunk-bed' }],
        },
      }),
    );
  });

  it('reports the landing once, whatever re-renders follow', () => {
    const { rerender } = render(<TemplateLandingPage />, { withProviders: false });
    rerender(<TemplateLandingPage />);

    expect(vi.mocked(captureEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureEvent)).toHaveBeenCalledWith('trip_template_opened', {
      outcome: 'ready',
    });
  });

  it('reports nothing while the template is still loading', () => {
    answering({ kind: 'loading' });

    render(<TemplateLandingPage />, { withProviders: false });

    expect(vi.mocked(captureEvent)).not.toHaveBeenCalled();
    expect(screen.getByText('Opening the trip template…')).toBeInTheDocument();
  });

  it('explains a dead link, and offers a trip of their own instead', async () => {
    answering({ kind: 'not-found' });

    const { user } = render(<TemplateLandingPage />, { withProviders: false });

    expect(screen.getByText("This trip template isn't available.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New trip' }));
    expect(navigate).toHaveBeenCalledWith('/trips/new');
  });

  it('says the same thing when this build has no server', () => {
    answering({ kind: 'unavailable' });

    render(<TemplateLandingPage />, { withProviders: false });

    expect(screen.getByText("This trip template isn't available.")).toBeInTheDocument();
    expect(vi.mocked(captureEvent)).toHaveBeenCalledWith('trip_template_opened', {
      outcome: 'unavailable',
    });
  });

  it('offers a retry after a failure, with the reason', async () => {
    answering({ kind: 'failed', message: 'Failed to fetch' });

    const { user } = render(<TemplateLandingPage />, { withProviders: false });

    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('opens the trip the customer just made', async () => {
    render(<TemplateLandingPage />, { withProviders: false });

    const props = wizardProps.mock.calls[0]?.[0] as {
      onCreated: (trip: { id: string }) => void;
    };
    props.onCreated({ id: 'trip-9' });

    await vi.waitFor(() => {
      expect(setCurrentTrip).toHaveBeenCalledWith('trip-9');
      expect(navigate).toHaveBeenCalledWith('/trips/trip-9/calendar');
    });
  });

  it('sends a cancelled wizard to the trip list', () => {
    render(<TemplateLandingPage />, { withProviders: false });

    const props = wizardProps.mock.calls[0]?.[0] as { onCancel: () => void };
    props.onCancel();

    expect(navigate).toHaveBeenCalledWith('/trips');
  });

  it('shows a template with nothing but a name', () => {
    answering({
      kind: 'ready',
      template: { ...TEMPLATE, description: null, location: null, coordinates: null },
    });

    render(<TemplateLandingPage />, { withProviders: false });

    expect(screen.getByText('Chalet Marmotte')).toBeInTheDocument();
    expect(screen.queryByText('Chamonix')).not.toBeInTheDocument();
  });
});
