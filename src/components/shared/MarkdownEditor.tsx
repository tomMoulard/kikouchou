/**
 * @fileoverview A Markdown text area with a formatting toolbar and a preview.
 *
 * The source stays plain text, and that is the point. A trip's description is a
 * string in Dexie, in the Yjs document, in the assistant's prompt and in a
 * template row; a rich-text model would have to be serialised back to a string
 * at every one of those hops. So the editor is a `<textarea>` with buttons that
 * type the Markdown for you, and a Preview tab that shows exactly what
 * {@link MarkdownText} will render.
 *
 * Toolbar edits go through `document.execCommand('insertText')` where the
 * browser still supports it, so Cmd+Z undoes a click like a keystroke. Where it
 * does not (jsdom, some future browser), the edit falls back to a plain value
 * change.
 *
 * @module components/shared/MarkdownEditor
 */

import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bold,
  Heading,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownText } from '@/components/shared/MarkdownText';

import { cn } from '@/lib/utils';
import {
  type MarkdownEdit,
  applyMarkdownEdit,
  continueList,
  insertLink,
  toggleLinePrefix,
  wrapSelection,
} from '@/lib/utils/markdown';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the MarkdownEditor component.
 */
interface MarkdownEditorProps {
  /** Id of the text area, for a `<Label htmlFor>`. */
  readonly id: string;
  /** The Markdown source. */
  readonly value: string;
  /** Called with the new source on every change. */
  readonly onChange: (value: string) => void;
  /** Hard cap on the source length; also drives the character count. */
  readonly maxLength: number;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Visible rows of the text area. */
  readonly rows?: number;
  /** Moves focus into the text area when the editor mounts. */
  readonly focusOnMount?: boolean;
  /** Called on Escape inside the text area, for an editor that can be cancelled. */
  readonly onEscape?: () => void;
  /** Called on Cmd/Ctrl+Enter inside the text area, for an editor with a save. */
  readonly onSubmitShortcut?: () => void;
}

type ToolId = 'heading' | 'bold' | 'italic' | 'link' | 'bullet' | 'ordered' | 'task';

interface ToolDef {
  readonly id: ToolId;
  readonly icon: LucideIcon;
  readonly labelKey: string;
  readonly fallback: string;
  /** Hidden below `md`, where the row has room for six 44px targets and not seven. */
  readonly desktopOnly?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const TOOLS: readonly ToolDef[] = [
  { id: 'heading', icon: Heading, labelKey: 'markdown.heading', fallback: 'Heading', desktopOnly: true },
  { id: 'bold', icon: Bold, labelKey: 'markdown.bold', fallback: 'Bold' },
  { id: 'italic', icon: Italic, labelKey: 'markdown.italic', fallback: 'Italic' },
  { id: 'link', icon: Link, labelKey: 'markdown.link', fallback: 'Link' },
  { id: 'bullet', icon: List, labelKey: 'markdown.bulletList', fallback: 'Bulleted list' },
  { id: 'ordered', icon: ListOrdered, labelKey: 'markdown.numberedList', fallback: 'Numbered list' },
  { id: 'task', icon: ListChecks, labelKey: 'markdown.checklist', fallback: 'Checklist' },
];

const WRITE_TAB = 'write';
const PREVIEW_TAB = 'preview';

/**
 * The stock inactive tab label is `foreground` at 60% on `muted`, which
 * measured 3.97:1 on the trip form, under the 4.5:1 AA floor. 80% clears it.
 */
const TAB_TRIGGER_CLASS = 'text-foreground/80 dark:text-foreground/80';

// ============================================================================
// Component
// ============================================================================

/**
 * Markdown editor: toolbar, text area, character count, and a preview tab.
 *
 * @example
 * ```tsx
 * <Label htmlFor="trip-description">{t('trips.description')}</Label>
 * <MarkdownEditor id="trip-description" value={text} onChange={setText} maxLength={1000} />
 * ```
 */
const MarkdownEditor = memo(function MarkdownEditor({
  id,
  value,
  onChange,
  maxLength,
  placeholder,
  disabled = false,
  rows = 6,
  focusOnMount = false,
  onEscape,
  onSubmitShortcut,
}: MarkdownEditorProps): ReactElement {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState(WRITE_TAB);

  // A selection to restore once the controlled value has landed. Set only on
  // the fallback path: `execCommand` leaves the caret where the edit put it.
  const pendingSelectionRef = useRef<readonly [number, number] | null>(null);

  // Opening the editor is the user asking to type, so the caret goes to the
  // end of the text, where a note is usually continued.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (focusOnMount && textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: re-running on a prop change would steal focus mid-edit.
  }, []);

  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current;
    const textarea = textareaRef.current;
    if (pending && textarea) {
      pendingSelectionRef.current = null;
      textarea.focus();
      textarea.setSelectionRange(pending[0], pending[1]);
    }
  }, [value]);

  /**
   * Applies one edit, through the browser's undo stack when it can.
   */
  const applyEdit = useCallback(
    (edit: MarkdownEdit) => {
      const textarea = textareaRef.current;
      if (!textarea) {return;}

      const next = applyMarkdownEdit(value, edit);
      if (next.length > maxLength) {return;}

      textarea.focus();
      textarea.setSelectionRange(edit.from, edit.to);
      // `execCommand` is deprecated and still the only way to type into a
      // text area and keep its undo history. It fires `input`, which reaches
      // `onChange` below the ordinary way.
      const typed =
        typeof document.execCommand === 'function' &&
        document.execCommand('insertText', false, edit.insert) &&
        textarea.value === next;

      if (typed) {
        textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
        return;
      }

      pendingSelectionRef.current = [edit.selectionStart, edit.selectionEnd];
      onChange(next);
    },
    [value, maxLength, onChange],
  );

  const handleTool = useCallback(
    (tool: ToolId) => {
      const textarea = textareaRef.current;
      if (!textarea) {return;}
      const { selectionStart: start, selectionEnd: end } = textarea;

      switch (tool) {
        case 'bold':
          applyEdit(wrapSelection(value, start, end, '**', t('markdown.boldPlaceholder', 'bold text')));
          return;
        case 'italic':
          applyEdit(wrapSelection(value, start, end, '_', t('markdown.italicPlaceholder', 'italic text')));
          return;
        case 'link':
          applyEdit(insertLink(value, start, end, t('markdown.linkPlaceholder', 'link text')));
          return;
        case 'heading':
        case 'bullet':
        case 'ordered':
        case 'task':
          applyEdit(toggleLinePrefix(value, start, end, tool));
          return;
      }
    },
    [applyEdit, value, t],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(event.target.value);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      const mod = event.metaKey || event.ctrlKey;

      if (event.key === 'Escape' && onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }

      if (mod && event.key === 'Enter' && onSubmitShortcut) {
        event.preventDefault();
        onSubmitShortcut();
        return;
      }

      if (mod && !event.shiftKey && !event.altKey) {
        const shortcut: ToolId | undefined =
          event.key === 'b' ? 'bold' : event.key === 'i' ? 'italic' : event.key === 'k' ? 'link' : undefined;
        if (shortcut) {
          event.preventDefault();
          handleTool(shortcut);
        }
        return;
      }

      // Enter inside a list starts the next item, the way every notes app does.
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.altKey &&
        !event.nativeEvent.isComposing
      ) {
        const { selectionStart, selectionEnd } = event.currentTarget;
        if (selectionStart !== selectionEnd) {return;}
        const edit = continueList(value, selectionStart);
        if (edit) {
          event.preventDefault();
          applyEdit(edit);
        }
      }
    },
    [applyEdit, handleTool, onEscape, onSubmitShortcut, value],
  );

  const countId = `${id}-count`;
  const hintId = `${id}-hint`;

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value={WRITE_TAB} className={TAB_TRIGGER_CLASS}>
            {t('markdown.write', 'Write')}
          </TabsTrigger>
          <TabsTrigger value={PREVIEW_TAB} className={TAB_TRIGGER_CLASS}>
            {t('markdown.preview', 'Preview')}
          </TabsTrigger>
        </TabsList>

        {tab === WRITE_TAB && (
          <div
            role="toolbar"
            aria-label={t('markdown.toolbar', 'Formatting')}
            aria-controls={id}
            // A row of its own on a phone, spread to the edges: the buttons keep
            // their 44px floor, and a second, wrapped row of one button read as
            // a different control.
            className="flex items-center gap-0.5 max-md:w-full max-md:justify-between"
          >
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              const label = t(tool.labelKey, tool.fallback);
              return (
                <Button
                  key={tool.id}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={label}
                  title={label}
                  disabled={disabled}
                  className={cn(tool.desktopOnly === true && 'max-md:hidden')}
                  // Keep the selection: a click would otherwise move focus to
                  // the button and the text area would forget what was selected.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleTool(tool.id)}
                >
                  <Icon aria-hidden="true" />
                </Button>
              );
            })}
          </div>
        )}
      </div>

      <TabsContent value={WRITE_TAB} className="space-y-1">
        <Textarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={rows}
          maxLength={maxLength}
          aria-describedby={`${hintId} ${countId}`}
          className="min-h-32 resize-y font-mono text-sm md:text-sm"
        />
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <p id={hintId}>{t('markdown.hint', 'Markdown works here: **bold**, _italic_, - lists, [links](https://…)')}</p>
          <p id={countId} className="shrink-0 tabular-nums">
            {value.length}/{maxLength}
          </p>
        </div>
      </TabsContent>

      <TabsContent value={PREVIEW_TAB}>
        <div
          className={cn(
            'min-h-32 rounded-md border border-input px-3 py-2',
            value.trim() === '' && 'text-muted-foreground',
          )}
        >
          {value.trim() === '' ? (
            <p className="text-sm">{t('markdown.nothingToPreview', 'Nothing to preview yet.')}</p>
          ) : (
            <MarkdownText>{value}</MarkdownText>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { MarkdownEditor };
export type { MarkdownEditorProps };
