/**
 * Component tests for TripLocationMap
 *
 * Tests map preview rendering, dialog expansion, keyboard navigation,
 * and accessibility features.
 *
 * @module features/trips/components/__tests__/TripLocationMap.test
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TripLocationMap } from '../TripLocationMap';

// ============================================================================
// Test Data & Utilities
// ============================================================================

const defaultProps = {
  location: 'Beach House, Brittany',
  coordinates: { lat: 48.8566, lon: 2.3522 },
};

/**
 * Helper to get the main preview button (the <button> element, not marker buttons).
 */
function getPreviewButton() {
  // The main preview button is a <button> element with aria-haspopup="dialog"
  const buttons = screen.getAllByRole('button');
  const previewButton = buttons.find(
    (btn) => btn.tagName === 'BUTTON' && btn.hasAttribute('aria-haspopup')
  );
  if (!previewButton) {
    throw new Error('Could not find preview button');
  }
  return previewButton;
}

// ============================================================================
// Basic Rendering Tests
// ============================================================================

describe('TripLocationMap Basic Rendering', () => {
  it('renders the map preview button', () => {
    render(<TripLocationMap {...defaultProps} />);

    const button = getPreviewButton();
    expect(button).toBeInTheDocument();
  });

  it('includes aria-label on preview button', () => {
    render(<TripLocationMap {...defaultProps} />);

    const button = getPreviewButton();
    // In test environment without i18n, we get the translation key
    // The actual translation would interpolate the location
    expect(button).toHaveAttribute('aria-label', 'map.expandMap');
  });

  it('has aria-haspopup="dialog" on the preview button', () => {
    render(<TripLocationMap {...defaultProps} />);

    const button = getPreviewButton();
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('has aria-expanded="false" initially', () => {
    render(<TripLocationMap {...defaultProps} />);

    const button = getPreviewButton();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('applies custom className', () => {
    render(<TripLocationMap {...defaultProps} className="custom-class" />);

    const button = getPreviewButton();
    expect(button).toHaveClass('custom-class');
  });

  it('applies custom preview height', () => {
    render(<TripLocationMap {...defaultProps} previewHeight={120} />);

    const button = getPreviewButton();
    expect(button).toHaveStyle({ height: '120px' });
  });

  it('uses default preview height of 80px', () => {
    render(<TripLocationMap {...defaultProps} />);

    const button = getPreviewButton();
    expect(button).toHaveStyle({ height: '80px' });
  });
});

// ============================================================================
// Dialog Expansion Tests
// ============================================================================

describe('TripLocationMap Dialog', () => {
  it('opens dialog when preview is clicked', async () => {
    const user = userEvent.setup();
    render(<TripLocationMap {...defaultProps} />);

    const button = getPreviewButton();
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('shows location in dialog title', async () => {
    const user = userEvent.setup();
    render(<TripLocationMap {...defaultProps} />);

    const button = getPreviewButton();
    await user.click(button);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Beach House, Brittany' })
      ).toBeInTheDocument();
    });
  });

  it('updates aria-expanded when dialog opens', async () => {
    const user = userEvent.setup();
    render(<TripLocationMap {...defaultProps} />);

    const button = getPreviewButton();
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);

    await waitFor(() => {
      expect(button).toHaveAttribute('aria-expanded', 'true');
    });
  });

  it('closes dialog when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<TripLocationMap {...defaultProps} />);

    // Open dialog
    const previewButton = getPreviewButton();
    await user.click(previewButton);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Find and click close button (contains translation key common.close)
    const closeButton = screen.getByRole('button', { name: /common\.close/i });
    await user.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes dialog when X button is clicked', async () => {
    const user = userEvent.setup();
    render(<TripLocationMap {...defaultProps} />);

    // Open dialog
    const previewButton = getPreviewButton();
    await user.click(previewButton);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Find and click the X close button (sr-only "Close" text)
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    // The X button typically comes from DialogContent
    const xButton = closeButtons.find((btn) =>
      btn.querySelector('svg') !== null && !btn.textContent?.includes('common.close')
    );
    if (xButton) {
      await user.click(xButton);

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    }
  });

  it('closes dialog when Escape is pressed', async () => {
    const user = userEvent.setup();
    render(<TripLocationMap {...defaultProps} />);

    // Open dialog
    const previewButton = getPreviewButton();
    await user.click(previewButton);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Press Escape
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

// ============================================================================
// Keyboard Navigation Tests
// ============================================================================

describe('TripLocationMap Keyboard Navigation', () => {
  it('opens dialog on Enter key', async () => {
    const user = userEvent.setup();
    render(<TripLocationMap {...defaultProps} />);

    const button = getPreviewButton();
    button.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('opens dialog on Space key', async () => {
    const user = userEvent.setup();
    render(<TripLocationMap {...defaultProps} />);

    const button = getPreviewButton();
    button.focus();
    await user.keyboard(' ');

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('is focusable via Tab', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button>Before</button>
        <TripLocationMap {...defaultProps} />
        <button>After</button>
      </div>
    );

    // Tab to the map button
    await user.tab();
    expect(screen.getByText('Before')).toHaveFocus();

    await user.tab();
    const mapButton = getPreviewButton();
    expect(mapButton).toHaveFocus();
  });
});

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('TripLocationMap Accessibility', () => {
  it('has proper button role for preview', () => {
    render(<TripLocationMap {...defaultProps} />);

    const button = getPreviewButton();
    expect(button).toBeInTheDocument();
    expect(button.tagName).toBe('BUTTON');
  });

  it('has type="button" to prevent form submission', () => {
    render(<TripLocationMap {...defaultProps} />);

    const button = getPreviewButton();
    expect(button).toHaveAttribute('type', 'button');
  });

  it('has accessible dialog structure', async () => {
    const user = userEvent.setup();
    render(<TripLocationMap {...defaultProps} />);

    await user.click(getPreviewButton());

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();

      // Dialog should have a title
      const title = screen.getByRole('heading', { name: 'Beach House, Brittany' });
      expect(title).toBeInTheDocument();
    });
  });

  it('has visible focus indicator on preview button', () => {
    render(<TripLocationMap {...defaultProps} />);

    const button = getPreviewButton();
    // Check that focus-visible classes are present
    expect(button).toHaveClass('focus-visible:outline-none');
    expect(button).toHaveClass('focus-visible:ring-2');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('TripLocationMap Edge Cases', () => {
  it('handles coordinates at origin (0, 0)', () => {
    render(
      <TripLocationMap
        location="Null Island"
        coordinates={{ lat: 0, lon: 0 }}
      />
    );

    const button = getPreviewButton();
    expect(button).toBeInTheDocument();
  });

  it('handles extreme coordinates', () => {
    render(
      <TripLocationMap
        location="North Pole"
        coordinates={{ lat: 90, lon: 180 }}
      />
    );

    const button = getPreviewButton();
    expect(button).toBeInTheDocument();
  });

  it('handles negative coordinates', () => {
    render(
      <TripLocationMap
        location="South America"
        coordinates={{ lat: -33.8688, lon: -151.2093 }}
      />
    );

    const button = getPreviewButton();
    expect(button).toBeInTheDocument();
  });

  it('handles very long location names', () => {
    const longLocation =
      'A Very Long Location Name That Could Potentially Cause Layout Issues If Not Handled Properly';
    render(
      <TripLocationMap
        location={longLocation}
        coordinates={{ lat: 48.8566, lon: 2.3522 }}
      />
    );

    // Component renders without errors
    const button = getPreviewButton();
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label');
  });

  it('handles special characters in location name', () => {
    const specialLocation = "L'Île-de-France & Côte d'Azur";
    render(
      <TripLocationMap
        location={specialLocation}
        coordinates={{ lat: 48.8566, lon: 2.3522 }}
      />
    );

    // Component renders without errors with special characters
    const button = getPreviewButton();
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label');
  });
});
