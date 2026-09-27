/**
 * @fileoverview Renders a user's Markdown note as formatted text.
 *
 * The text is remote input. A trip's description arrives over sync from every
 * member, and a template's from whoever published it, so the renderer is the
 * safe subset and nothing more:
 *
 * - raw HTML is never rendered (react-markdown escapes it by default, and
 *   `skipHtml` drops it outright rather than printing the tags);
 * - a link keeps only a safe protocol (react-markdown's `defaultUrlTransform`
 *   blanks `javascript:` and friends) and opens in a new tab without an opener;
 * - an image is shown as its link, never fetched. An `<img>` in somebody else's
 *   note is a request from this device to a server they chose, which is a
 *   tracking pixel, and offline it is a broken box anyway.
 *
 * Headings are demoted to one visual size: a note sits inside a card that
 * already has a title, and an `h1` inside it would outrank the page.
 *
 * @module components/shared/MarkdownText
 */

import { type ReactElement, memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the MarkdownText component.
 */
interface MarkdownTextProps {
  /** The Markdown source to render. */
  readonly children: string;
  /** Extra classes for the wrapper. */
  readonly className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const HEADING_CLASS = 'mt-4 mb-2 font-display text-base font-semibold first:mt-0';

const LINK_CLASS =
  'rounded-sm font-medium text-primary underline underline-offset-2 break-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

/**
 * One element per Markdown construct, styled with utilities: the project has no
 * typography plugin, and a `prose` class would be a whole stylesheet for one card.
 */
const COMPONENTS: Components = {
  h1: ({ children }) => <h3 className={HEADING_CLASS}>{children}</h3>,
  h2: ({ children }) => <h3 className={HEADING_CLASS}>{children}</h3>,
  h3: ({ children }) => <h4 className={HEADING_CLASS}>{children}</h4>,
  h4: ({ children }) => <h4 className={HEADING_CLASS}>{children}</h4>,
  h5: ({ children }) => <h4 className={HEADING_CLASS}>{children}</h4>,
  h6: ({ children }) => <h4 className={HEADING_CLASS}>{children}</h4>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children, className }) => (
    <ul
      className={cn(
        'my-2 list-disc space-y-1 pl-5',
        // A GFM task list draws its own checkboxes, so its bullets go.
        className?.includes('contains-task-list') === true && 'list-none pl-0',
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children, start }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5" start={start}>
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="break-words">{children}</li>,
  // A task box is a picture of the note, not a control: ticking it here would
  // change nothing that is stored.
  input: ({ type, checked }) => (
    <input
      type={type}
      checked={checked}
      className="mr-2 align-middle accent-primary"
      disabled
      readOnly
    />
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  a: ({ href, title, children }) => (
    <a
      href={href}
      title={title}
      className={LINK_CLASS}
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    typeof src === 'string' && src !== '' ? (
      <a href={src} className={LINK_CLASS} target="_blank" rel="noopener noreferrer nofollow">
        {alt !== undefined && alt !== '' ? alt : src}
      </a>
    ) : (
      <span>{alt}</span>
    ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-3 border-border" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border px-2 py-1 font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-border px-2 py-1">{children}</td>,
};

const REMARK_PLUGINS = [remarkGfm];

// ============================================================================
// Component
// ============================================================================

/**
 * Renders Markdown as formatted, safe text.
 *
 * @example
 * ```tsx
 * <MarkdownText>{trip.description}</MarkdownText>
 * ```
 */
const MarkdownText = memo(function MarkdownText({
  children,
  className,
}: MarkdownTextProps): ReactElement {
  return (
    <div className={cn('text-sm break-words', className)}>
      <Markdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS} skipHtml>
        {children}
      </Markdown>
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { MarkdownText };
export type { MarkdownTextProps };
