import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/utils';
import { AppProviders } from '../AppProviders';

describe('AppProviders', () => {
  it('renders children within provider tree', () => {
    render(
      <AppProviders>
        <div data-testid="child">Hello from providers</div>
      </AppProviders>,
      { withProviders: false },
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Hello from providers')).toBeInTheDocument();
  });

  it('renders multiple children', () => {
    render(
      <AppProviders>
        <span data-testid="a">A</span>
        <span data-testid="b">B</span>
      </AppProviders>,
      { withProviders: false },
    );
    expect(screen.getByTestId('a')).toBeInTheDocument();
    expect(screen.getByTestId('b')).toBeInTheDocument();
  });
});
