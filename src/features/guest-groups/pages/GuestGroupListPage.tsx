/**
 * @fileoverview Guest Group List Page — manage reusable rosters.
 *
 * Route: /groups
 *
 * One of the three pages that exist outside a trip, and the only one that owns
 * an entity: groups belong to the account, so this page is reachable with no
 * trip selected and shows the same thing whichever trip is.
 *
 * @module features/guest-groups/pages/GuestGroupListPage
 * @see PersonListPage.tsx for the trip-scoped equivalent
 */

import { type MouseEvent, type ReactElement, memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Trash2, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { LoadingState } from '@/components/shared/LoadingState';
import { PageHeader } from '@/components/shared/PageHeader';
import { useOfflineAwareToast } from '@/hooks';
import { GuestGroupDialog } from '@/features/guest-groups/components/GuestGroupDialog';
import { useGuestGroups } from '@/features/guest-groups/hooks/useGuestGroups';
import { cn } from '@/lib/utils';
import { getPersonHeadcount } from '@/types';
import type { GuestGroup, GuestGroupId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

interface GuestGroupCardProps {
  readonly group: GuestGroup;
  readonly onEdit: (groupId: GuestGroupId) => void;
  readonly onDelete: (groupId: GuestGroupId) => void;
}

// ============================================================================
// GuestGroupCard Component
// ============================================================================

/**
 * One group, with its people previewed as coloured name chips.
 */
const GuestGroupCard = memo(function GuestGroupCard({
  group,
  onEdit,
  onDelete,
}: GuestGroupCardProps): ReactElement {
  const { t } = useTranslation();

  // People, not rows — a member standing for a couple counts twice.
  const headcount = useMemo(
    () =>
      group.members.reduce((total, member) => total + getPersonHeadcount(member), 0),
    [group.members],
  );

  const handleEdit = useCallback(() => {
    onEdit(group.id);
  }, [group.id, onEdit]);

  const handleDelete = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onDelete(group.id);
    },
    [group.id, onDelete],
  );

  return (
    <Card
      className={cn(
        'cursor-pointer transition-colors hover:bg-accent/40',
        'focus-within:ring-2 focus-within:ring-ring',
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <button
          type="button"
          onClick={handleEdit}
          className="flex-1 text-left focus-visible:outline-none"
          aria-label={t('guestGroups.editNamed', 'Edit {{name}}', { name: group.name })}
        >
          <CardTitle className="text-base">{group.name}</CardTitle>
          <p className="text-xs text-muted-foreground tabular-nums mt-1">
            {t('guestGroups.memberCount', '{{count}} people', {
              count: group.members.length,
            })}
            {headcount !== group.members.length && (
              <>
                {' · '}
                {t('guestGroups.headcountSummary', '{{count}} in total', {
                  count: headcount,
                })}
              </>
            )}
          </p>
        </button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleDelete}
          aria-label={t('guestGroups.deleteNamed', 'Delete {{name}}', { name: group.name })}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </CardHeader>

      {group.members.length > 0 && (
        <CardContent>
          <ul className="flex flex-wrap gap-2">
            {group.members.map((member) => (
              <li
                key={member.id}
                className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: member.color }}
                  aria-hidden="true"
                />
                {member.name}
                {getPersonHeadcount(member) > 1 && (
                  <span className="text-muted-foreground tabular-nums">
                    ×{getPersonHeadcount(member)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
});

// ============================================================================
// Page Component
// ============================================================================

/**
 * Lists the account's guest groups.
 *
 * @returns The page element
 */
const GuestGroupListPage = memo(function GuestGroupListPage(): ReactElement {
  const { t } = useTranslation();
  const { groups, isLoading, deleteGroup } = useGuestGroups();
  const { successToast } = useOfflineAwareToast();

  const [editingId, setEditingId] = useState<GuestGroupId | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<GuestGroupId | null>(null);

  const editingGroup = useMemo(
    () => groups.find((group) => group.id === editingId),
    [editingId, groups],
  );

  const pendingDeleteGroup = useMemo(
    () => groups.find((group) => group.id === pendingDeleteId),
    [groups, pendingDeleteId],
  );

  const handleCreate = useCallback(() => {
    setEditingId(null);
    setIsDialogOpen(true);
  }, []);

  const handleEdit = useCallback((groupId: GuestGroupId) => {
    setEditingId(groupId);
    setIsDialogOpen(true);
  }, []);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingId(null);
    }
  }, []);

  const handleRequestDelete = useCallback((groupId: GuestGroupId) => {
    setPendingDeleteId(groupId);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteId) {
      return;
    }

    try {
      await deleteGroup(pendingDeleteId);
      successToast(t('guestGroups.deleteSuccess', 'Group deleted'));
    } catch (error) {
      console.error('Failed to delete guest group:', error);
      toast.error(t('errors.deleteFailed', 'Failed to delete'));
    } finally {
      setPendingDeleteId(null);
    }
  }, [deleteGroup, pendingDeleteId, successToast, t]);

  const handleDeleteOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setPendingDeleteId(null);
    }
  }, []);

  if (isLoading) {
    return <LoadingState variant="fullPage" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('guestGroups.title', 'Guest groups')}
        description={t(
          'guestGroups.description',
          'People you invite together. Add a whole group to a trip in one go.',
        )}
        action={
          groups.length > 0 ? (
            <Button onClick={handleCreate}>
              <Plus className="size-4 mr-2" aria-hidden="true" />
              {t('guestGroups.new', 'New group')}
            </Button>
          ) : undefined
        }
      />

      {groups.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('guestGroups.emptyTitle', 'No groups yet')}
          description={t(
            'guestGroups.emptyDescription',
            'Create a group for the people you invite together — a family, a band of friends — and add them to a trip without retyping anybody.',
          )}
          action={{
            label: t('guestGroups.new', 'New group'),
            onClick: handleCreate,
          }}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <li key={group.id}>
              <GuestGroupCard
                group={group}
                onEdit={handleEdit}
                onDelete={handleRequestDelete}
              />
            </li>
          ))}
        </ul>
      )}

      <GuestGroupDialog
        group={editingGroup}
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={handleDeleteOpenChange}
        title={t('guestGroups.deleteTitle', 'Delete this group?')}
        description={t('guestGroups.deleteDescription', {
          defaultValue:
            'The group "{{name}}" is removed from every device on this account. Guests already added to a trip stay where they are.',
          name: pendingDeleteGroup?.name ?? '',
        })}
        confirmLabel={t('common.delete')}
        onConfirm={handleConfirmDelete}
        variant="destructive"
      />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { GuestGroupListPage };
export default GuestGroupListPage;
