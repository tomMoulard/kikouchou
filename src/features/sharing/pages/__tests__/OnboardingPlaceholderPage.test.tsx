import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/utils';
import { OnboardingPlaceholderPage } from '../OnboardingPlaceholderPage';

describe('OnboardingPlaceholderPage', () => {
  it('renders the coming soon message', () => {
    render(<OnboardingPlaceholderPage />, { withProviders: false });
    expect(screen.getByText('common.comingSoon')).toBeInTheDocument();
  });

  it('renders the onboarding description', () => {
    render(<OnboardingPlaceholderPage />, { withProviders: false });
    expect(screen.getByText('sharing.onboardingComingSoon')).toBeInTheDocument();
  });

  it('renders the construction emoji', () => {
    render(<OnboardingPlaceholderPage />, { withProviders: false });
    expect(screen.getByText('🚧')).toBeInTheDocument();
  });
});
