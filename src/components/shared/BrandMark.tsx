/**
 * @fileoverview The Kikouchou logo mark: a house of four rooms under a roof.
 *
 * The geometry is the brand kit's 64-unit grid, so the mark stays pixel-aligned
 * at 16, 32, 48 and 64px. Each room reads its own `--brand-*` token, and those
 * switch to the brighter values under `.dark`, so the mark follows the app's
 * theme and not only the system one. Do not recolour a single room outside the
 * palette.
 *
 * @module components/shared/BrandMark
 */

import type { ReactElement, SVGProps } from 'react';

import { cn } from '@/lib/utils';

export function BrandMark({ className, ...props }: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={cn('size-6 shrink-0', className)}
      {...props}
    >
      <path
        className="fill-brand-soleil"
        d="M10.76 28Q4 28 9.13 23.6L30.37 5.39Q32 4 33.63 5.39L54.87 23.6Q60 28 53.24 28L10.76 28Z"
      />
      <rect className="fill-brand-corail" x="8" y="32" width="20" height="28" rx="2.5" />
      <rect className="fill-brand-framboise" x="32" y="32" width="24" height="12" rx="2.5" />
      <rect className="fill-brand-prune" x="32" y="48" width="24" height="12" rx="2.5" />
    </svg>
  );
}
