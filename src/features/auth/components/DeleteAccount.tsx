/**
 * @fileoverview Deleting the signed-in account, from inside the app.
 *
 * Both stores require it (App Store guideline 5.1.1(v), Google Play's user
 * data policy), and the website has it for the same reason. The rule, decided
 * on 2026-09-26: a trip shared with other members stays with them, a trip
 * nobody else is on goes with the account, and the trips on this device stay
 * here as local trips. The dialog says exactly that, because "delete my
 * account" reads to most people as "delete my trips" and it is not.
 *
 * @module features/auth/components/DeleteAccount
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useAuth } from '@/features/auth/AuthContext';
import { notify } from '@/lib/notifications';

// ============================================================================
// Component
// ============================================================================

export const DeleteAccount = memo(function DeleteAccount(): ReactElement {
  const { t } = useTranslation();
  const { deleteAccount } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!isDeleting) {
        setIsOpen(open);
      }
    },
    [isDeleting],
  );

  const handleConfirm = useCallback(async (): Promise<void> => {
    setIsDeleting(true);
    try {
      const deleted = await deleteAccount();
      if (deleted) {
        notify.success(t('auth.account.deleted', 'Your account is deleted.'));
        setIsOpen(false);
      } else {
        notify.error(
          t(
            'auth.account.deleteFailed',
            'The account could not be deleted. Check the connection and try again.',
          ),
        );
      }
    } finally {
      setIsDeleting(false);
    }
  }, [deleteAccount, t]);

  return (
    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        {t(
          'auth.account.deleteHint',
          'Deleting the account removes it from the server. The trips on this device stay here.',
        )}
      </p>
      <Button variant="outline" className="self-start text-destructive" onClick={handleOpen}>
        <UserX className="size-4" aria-hidden="true" />
        {t('auth.account.deleteAction', 'Delete my account')}
      </Button>
      <ConfirmDialog
        open={isOpen}
        onOpenChange={handleOpenChange}
        title={t('auth.account.deleteTitle', 'Delete your account?')}
        description={t(
          'auth.account.deleteDescription',
          'A trip you share with other people stays with them. A trip nobody else is on is deleted from the server. The trips on this device stay here, and no longer sync. This cannot be undone.',
        )}
        confirmLabel={t('auth.account.deleteConfirm', 'Delete the account')}
        variant="destructive"
        onConfirm={handleConfirm}
      />
    </div>
  );
});
