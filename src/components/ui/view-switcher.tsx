/**
 * @fileoverview A segmented control for switching the view of the page it sits on.
 *
 * @module components/ui/view-switcher
 */

import * as React from 'react';

import { cn } from '@/lib/utils';
import { tabsListVariants } from './tabs.variants';

/**
 * One selectable view.
 */
export interface ViewSwitcherOption<TValue extends string> {
  readonly value: TValue;
  readonly label: React.ReactNode;
}

export interface ViewSwitcherProps<TValue extends string> {
  /** The currently selected view. */
  readonly value: TValue;
  /** Called with the newly selected view. */
  readonly onValueChange: (value: TValue) => void;
  /** The views on offer, in display order. */
  readonly options: readonly ViewSwitcherOption<TValue>[];
  /** Accessible name for the group as a whole, e.g. "Calendar view". */
  readonly ariaLabel: string;
  readonly className?: string;
}

/**
 * Switches between mutually exclusive views of the current page.
 *
 * This exists because Radix `Tabs` was the wrong primitive for the job. Five
 * pages used `Tabs` + `TabsList` + `TabsTrigger` with no `TabsContent` at all,
 * rendering the view's content as a sibling of the `Tabs` root instead. Radix
 * still puts `aria-controls` on every trigger, pointing at the panel it would
 * have owned — so every one of those references dangled, and axe failed the
 * pages with `aria-valid-attr-value`: "Invalid ARIA attribute value:
 * aria-controls="radix-_r_3_-content-list"". Assistive tech was being told
 * about a panel that never existed.
 *
 * A radiogroup says what is actually happening: pick one of several options,
 * and the page changes around you. Roving tabindex and arrow-key movement match
 * what the tab list did, so keyboard behaviour is unchanged; the styling is the
 * same `tabsListVariants` so it looks identical.
 */
export function ViewSwitcher<TValue extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
}: ViewSwitcherProps<TValue>): React.ReactElement {
  const refs = React.useRef(new Map<TValue, HTMLButtonElement>());

  const move = (delta: number): void => {
    const index = options.findIndex((option) => option.value === value);
    if (index === -1) {
      return;
    }
    // Wrap, the way a tab list does.
    const next = options[(index + delta + options.length) % options.length];
    if (!next) {
      return;
    }
    onValueChange(next.value);
    refs.current.get(next.value)?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- APG's radio-group pattern puts a roving `tabIndex` on the radios (see the `tabIndex` on each option below) and leaves the group itself out of the tab order; making the group focusable too would give the control two tab stops.
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-slot="view-switcher"
      data-variant="default"
      className={cn(
        tabsListVariants({ variant: 'default' }),
        // `tabsListVariants` only sets the height through
        // `group-data-[orientation=horizontal]/tabs:h-9`, which needs the
        // `Tabs` root as an ancestor. There isn't one here, so set it directly
        // or the control renders shorter than the tab list it replaces.
        'h-9',
        'group/tabs-list',
        className,
      )}
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => {
        const isSelected = option.value === value;

        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) {
                refs.current.set(option.value, node);
              } else {
                refs.current.delete(option.value);
              }
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            // Roving tabindex: one stop for the whole group, as in a tab list.
            tabIndex={isSelected ? 0 : -1}
            data-state={isSelected ? 'active' : 'inactive'}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
              'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
