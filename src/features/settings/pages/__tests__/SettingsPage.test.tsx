import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/utils';
import type { Trip } from '@/types';

const mockNavigate = vi.fn();
const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  location: 'Paris',
  startDate: '2026-07-01' as Trip['startDate'],
  endDate: '2026-07-10' as Trip['endDate'],
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(() => ({
    currentTrip: mockTrip,
    setCurrentTrip: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/lib/db', () => ({
  db: { delete: vi.fn().mockResolvedValue(undefined), open: vi.fn().mockResolvedValue(undefined) },
  deleteTrip: vi.fn().mockResolvedValue(undefined),
  updateTrip: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/i18n', () => ({
  SUPPORTED_LANGUAGES: ['en', 'fr'],
  changeLanguage: vi.fn().mockResolvedValue(undefined),
  getCurrentLanguage: () => 'en',
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({
    successToast: vi.fn(),
    errorToast: vi.fn(),
  }),
}));

// Mock TripForm to avoid deep tree
vi.mock('@/features/trips/components/TripForm', () => ({
  TripForm: () => <div data-testid="trip-form">Trip Form</div>,
}));

import { SettingsPage } from '../SettingsPage';
import { useTripContext } from '@/contexts/TripContext';

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders settings page with all sections', () => {
    render(<SettingsPage />, { withProviders: false });
    expect(screen.getByText('settings.title')).toBeInTheDocument();
    expect(screen.getByText('settings.language')).toBeInTheDocument();
    expect(screen.getByText('settings.about')).toBeInTheDocument();
    expect(screen.getByText('settings.dataManagement')).toBeInTheDocument();
  });

  it('renders current trip section when trip is selected', () => {
    render(<SettingsPage />, { withProviders: false });
    expect(screen.getByText('settings.currentTrip')).toBeInTheDocument();
    expect(screen.getByTestId('trip-form')).toBeInTheDocument();
  });

  it('does not render current trip section when no trip is selected', () => {
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: null,
      setCurrentTrip: vi.fn().mockResolvedValue(undefined),
    } as ReturnType<typeof useTripContext>);
    render(<SettingsPage />, { withProviders: false });
    expect(screen.queryByText('settings.currentTrip')).not.toBeInTheDocument();
  });

  it('renders version information', () => {
    render(<SettingsPage />, { withProviders: false });
    expect(screen.getByText('settings.version')).toBeInTheDocument();
  });

  it('renders clear data button', () => {
    render(<SettingsPage />, { withProviders: false });
    expect(screen.getByText('settings.clearData')).toBeInTheDocument();
  });

  it('renders data management section', () => {
    render(<SettingsPage />, { withProviders: false });
    expect(screen.getByText('settings.dataManagement')).toBeInTheDocument();
  });
});
