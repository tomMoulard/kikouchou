/**
 * @fileoverview A form field that picks, previews and removes one photo.
 *
 * The picked file is resized and re-encoded here (`preparePhoto`), so what the
 * form holds is already what will be stored. The field never writes anything:
 * it reports a {@link PhotoChange} and the form's own save decides.
 *
 * The file input takes `accept="image/*"`, which on a phone offers the camera
 * as well as the library, in the browser and in the store apps' web view.
 *
 * @module components/shared/PhotoField
 */

import { type ChangeEvent, memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import { PhotoPrepareError, preparePhoto } from '@/lib/photos/prepare';
import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * What a form wants done to a photo: `undefined` keeps the stored one, `null`
 * removes it, a `Blob` replaces it with these prepared bytes.
 */
export type PhotoChange = Blob | null | undefined;

interface PhotoFieldProps {
  /** The field's label. */
  readonly label: string;
  /** The stored photo's address, when there is one. */
  readonly storedUrl?: string | undefined;
  /** The change the form holds so far. */
  readonly value: PhotoChange;
  /** Called with the next change. */
  readonly onChange: (value: PhotoChange) => void;
  /** Text for the preview's `alt`. */
  readonly alt: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Picks one photo for a trip or a room.
 */
export const PhotoField = memo(function PhotoField({
  label,
  storedUrl,
  value,
  onChange,
  alt,
  disabled = false,
  className,
}: PhotoFieldProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedUrl, setPickedUrl] = useState<string>();

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!(value instanceof Blob)) {
      setPickedUrl(undefined);
      return undefined;
    }
    const url = URL.createObjectURL(value);
    setPickedUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [value]);

  const shownUrl = value instanceof Blob ? pickedUrl : value === null ? undefined : storedUrl;
  const hasPhoto = shownUrl !== undefined;

  const handlePick = useCallback((): void => {
    inputRef.current?.click();
  }, []);

  const handleFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0];
      // Cleared so picking the same file again still fires `change`.
      event.target.value = '';
      if (!file) {
        return;
      }
      setError(null);
      setIsPreparing(true);
      try {
        const prepared = await preparePhoto(file);
        if (isMountedRef.current) {
          onChange(prepared);
        }
      } catch (caught) {
        console.error('Failed to prepare the photo:', caught);
        if (!isMountedRef.current) {
          return;
        }
        const reason = caught instanceof PhotoPrepareError ? caught.reason : 'decode_failed';
        setError(
          reason === 'not_an_image'
            ? t('photos.errors.notAnImage', 'This file is not an image.')
            : reason === 'too_large'
              ? t('photos.errors.tooLarge', 'This photo is too large, even after resizing.')
              : t('photos.errors.decodeFailed', 'This photo could not be read. Try another one.'),
        );
      } finally {
        if (isMountedRef.current) {
          setIsPreparing(false);
        }
      }
    },
    [onChange, t],
  );

  const handleRemove = useCallback((): void => {
    setError(null);
    onChange(null);
  }, [onChange]);

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={inputId}>{label}</Label>
      {hasPhoto && (
        <img
          src={shownUrl}
          alt={alt}
          className="h-40 w-full rounded-md border object-cover"
        />
      )}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        disabled={disabled || isPreparing}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        onChange={(event) => void handleFile(event)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handlePick}
          disabled={disabled || isPreparing}
        >
          {isPreparing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ImagePlus className="size-4" aria-hidden="true" />
          )}
          {isPreparing
            ? t('photos.preparing', 'Preparing the photo')
            : hasPhoto
              ? t('photos.change', 'Change photo')
              : t('photos.add', 'Add a photo')}
        </Button>
        {hasPhoto && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={disabled || isPreparing}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {t('photos.remove', 'Remove photo')}
          </Button>
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
});
