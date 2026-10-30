/**
 * @fileoverview Tests for PhotoField.
 *
 * The field reports a change and writes nothing: a prepared image, `null` to
 * remove, and an explained failure for a file it cannot use.
 *
 * @module components/shared/__tests__/PhotoField.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/utils';

import { PhotoPrepareError, preparePhoto } from '@/lib/photos/prepare';

import { PhotoField } from '../PhotoField';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/lib/photos/prepare', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/photos/prepare')>()),
  preparePhoto: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:picked'),
    revokeObjectURL: vi.fn(),
  }));
});

function pick(file: File): void {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('no file input');
  }
  fireEvent.change(input, { target: { files: [file] } });
}

const FILE = new File(['x'], 'room.jpg', { type: 'image/jpeg' });

// ============================================================================
// Tests
// ============================================================================

describe('PhotoField', () => {
  it('offers to add a photo when there is none, and takes images only', () => {
    render(
      <PhotoField label="Photo" value={undefined} onChange={vi.fn()} alt="Room" />,
      { withProviders: false },
    );

    expect(screen.getByRole('button', { name: /photos.add/ })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toHaveAttribute('accept', 'image/*');
  });

  it('shows the stored photo, with change and remove', () => {
    render(
      <PhotoField label="Photo" storedUrl="blob:stored" value={undefined} onChange={vi.fn()} alt="Room" />,
      { withProviders: false },
    );

    expect(screen.getByRole('img', { name: 'Room' })).toHaveAttribute('src', 'blob:stored');
    expect(screen.getByRole('button', { name: /photos.change/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /photos.remove/ })).toBeInTheDocument();
  });

  it('reports the prepared image for a picked file', async () => {
    const prepared = new Blob(['webp'], { type: 'image/webp' });
    vi.mocked(preparePhoto).mockResolvedValue(prepared);
    const onChange = vi.fn();
    render(<PhotoField label="Photo" value={undefined} onChange={onChange} alt="Room" />, {
      withProviders: false,
    });

    pick(FILE);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(prepared);
    });
    expect(preparePhoto).toHaveBeenCalledWith(FILE);
  });

  it('previews a picked image instead of the stored one', () => {
    render(
      <PhotoField
        label="Photo"
        storedUrl="blob:stored"
        value={new Blob(['webp'], { type: 'image/webp' })}
        onChange={vi.fn()}
        alt="Room"
      />,
      { withProviders: false },
    );

    expect(screen.getByRole('img', { name: 'Room' })).toHaveAttribute('src', 'blob:picked');
  });

  it('reports null on remove, and then shows no photo', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PhotoField label="Photo" storedUrl="blob:stored" value={undefined} onChange={onChange} alt="Room" />,
      { withProviders: false },
    );

    fireEvent.click(screen.getByRole('button', { name: /photos.remove/ }));
    expect(onChange).toHaveBeenCalledWith(null);

    rerender(
      <PhotoField label="Photo" storedUrl="blob:stored" value={null} onChange={onChange} alt="Room" />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it.each([
    ['not_an_image', 'photos.errors.notAnImage'],
    ['too_large', 'photos.errors.tooLarge'],
    ['decode_failed', 'photos.errors.decodeFailed'],
  ] as const)('explains a %s failure and reports nothing', async (reason, key) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(preparePhoto).mockRejectedValue(new PhotoPrepareError(reason));
    const onChange = vi.fn();
    render(<PhotoField label="Photo" value={undefined} onChange={onChange} alt="Room" />, {
      withProviders: false,
    });

    pick(FILE);

    expect(await screen.findByRole('alert')).toHaveTextContent(key);
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector('input[type="file"]')).toHaveAttribute('aria-invalid', 'true');
  });

  it('opens the file picker from the button', () => {
    render(<PhotoField label="Photo" value={undefined} onChange={vi.fn()} alt="Room" />, {
      withProviders: false,
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');

    fireEvent.click(screen.getByRole('button', { name: /photos.add/ }));

    expect(click).toHaveBeenCalled();
  });

  it('ignores a change with no file', () => {
    const onChange = vi.fn();
    render(<PhotoField label="Photo" value={undefined} onChange={onChange} alt="Room" />, {
      withProviders: false,
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [] } });

    expect(preparePhoto).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
