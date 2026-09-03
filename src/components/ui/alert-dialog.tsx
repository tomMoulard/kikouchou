/**
 * @fileoverview Alert dialog primitives — the modal for a decision the user must
 * make before anything else happens ("Delete this trip?").
 *
 * `role="alertdialog"` is not decoration: it is what tells a screen reader that
 * the interruption is consequential and moves the user straight into it, and it
 * is what stops a stray click on the backdrop from answering a destructive
 * question. A plain `role="dialog"` announces "Delete this trip?" exactly as it
 * announces "Edit room".
 *
 * Built on the alert-dialog primitive already vendored inside the `radix-ui`
 * umbrella package — no new dependency — and dressed from
 * `dialog.variants.ts` so it cannot drift away from `Dialog`.
 *
 * @module components/ui/alert-dialog
 */

import * as React from 'react';
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';
import {
  dialogBodyClassName,
  dialogContentClassName,
  dialogFooterClassName,
  dialogHeaderClassName,
  dialogOverlayClassName,
} from '@/components/ui/dialog.variants';

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  );
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  );
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(dialogOverlayClassName, className)}
      {...props}
    />
  );
}

/**
 * The alert dialog box.
 *
 * No close button, unlike `DialogContent`: an alert dialog is answered, not
 * dismissed, so the choices are the ones in the footer.
 */
function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(dialogContentClassName, className)}
        {...props}
      >
        {/* Same split as DialogContent: the box holds the height cap, the body
            inside it does the scrolling. A long confirmation on a short screen
            scrolls rather than losing its buttons off the bottom edge. */}
        <div data-slot="alert-dialog-body" className={dialogBodyClassName}>
          {children}
        </div>
      </AlertDialogPrimitive.Content>
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(dialogHeaderClassName, className)}
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(dialogFooterClassName, className)}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

/**
 * The action that answers the question. Closes the dialog when clicked.
 *
 * A confirmation that has work to do — an await, a failure to report, a spinner
 * — must NOT use this: it closes before the work finishes. Render a plain
 * `Button` instead, as `ConfirmDialog` does.
 */
function AlertDialogAction({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action data-slot="alert-dialog-action" {...props} />
  );
}

/**
 * The way out. Radix focuses this element when the dialog opens, so an alert
 * dialog without one opens with focus nowhere — render it (with `asChild`
 * around the cancel button) even when the cancel handler is your own.
 */
function AlertDialogCancel({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel data-slot="alert-dialog-cancel" {...props} />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
