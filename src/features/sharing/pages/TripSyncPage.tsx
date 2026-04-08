/**
 * @fileoverview Unified Trip Sync page — export and import changes via QR codes.
 * Combines export (show QR) and import (scan QR + merge review) into a single
 * tabbed interface. Guests export deltas from their import baseline; organizers
 * without guest localStorage export a full snapshot of trip participants and logistics.
 *
 * @module features/sharing/pages/TripSyncPage
 *
 * Route: /trips/:tripId/sync
 */

import {
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  AlertCircle,
  AlertTriangle,
  Bed,
  Check,
  ChevronDown,
  ChevronUp,
  GitMerge,
  QrCode,
  ScanLine,
  Train,
  Upload,
  User,
  Download,
} from 'lucide-react';

import { PageHeader } from '@/components/shared/PageHeader';
import { LoadingState } from '@/components/shared/LoadingState';
import { MultiFrameQR } from '@/components/shared/MultiFrameQR';
import { QRScanner } from '@/components/shared/QRScanner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { getTripById } from '@/lib/db';
import {
  buildChangeset,
  buildHostChangeset,
  encodeChangeset,
  splitIntoFrames,
  decodeChangeset,
  parseFrame,
  reassembleFrames,
  computeMerge,
  applyMerge,
} from '@/lib/sharing';
import type {
  ConflictResolution,
  MergeConflict,
  MergeResult,
} from '@/lib/sharing';
import { cn } from '@/lib/utils';
import type { Trip, PersonId, TripId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

const getGuestStorageKeyForTrip = (tripId: string): string | null => {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('kikoushou_guest_')) {
      try {
        const data = JSON.parse(localStorage.getItem(key) ?? '');
        if (data && data.tripId === tripId) {
          return key;
        }
      } catch {
        // Skip malformed entries
      }
    }
  }
  return null;
};

// ============================================================================
// Export Tab
// ============================================================================

interface ExportTabProps {
  readonly trip: Trip;
  readonly tripId: string;
}

const ExportTab = memo(function ExportTab({ trip, tripId }: ExportTabProps) {
  const { t } = useTranslation();
  const [frames, setFrames] = useState<string[]>([]);
  const [rawPayload, setRawPayload] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [isHostExport, setIsHostExport] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAndExport(): Promise<void> {
      try {
        setIsHostExport(false);
        const guestKey = getGuestStorageKeyForTrip(tripId);

        let changeset: Awaited<ReturnType<typeof buildChangeset>>;

        if (guestKey) {
          const guestData = JSON.parse(localStorage.getItem(guestKey) ?? '{}');
          const personId = guestData.personId as PersonId | undefined;
          const shareId = guestKey.replace('kikoushou_guest_', '');

          if (!personId) {
            setError(t('sharing.sync.noGuestIdentity', 'No guest identity found.'));
            setIsLoading(false);
            return;
          }

          changeset = await buildChangeset(trip.id, shareId, personId);
          if (cancelled || !isMountedRef.current) return;

          if (!changeset) {
            setError(t('sharing.sync.noBaseline', 'No import baseline found. Re-import the trip via the share link.'));
            setIsLoading(false);
            return;
          }
        } else {
          changeset = await buildHostChangeset(trip);
          if (cancelled || !isMountedRef.current) return;

          if (!changeset) {
            setError(
              t(
                'sharing.sync.hostExportEmpty',
                'Add at least one participant (or room assignment or transport) before exporting.',
              ),
            );
            setIsLoading(false);
            return;
          }
          if (isMountedRef.current) {
            setIsHostExport(true);
          }
        }

        const encoded = encodeChangeset(changeset);
        const qrFrames = splitIntoFrames(encoded);

        if (isMountedRef.current) {
          setFrames(qrFrames);
          setRawPayload(encoded);
          setIsLoading(false);
        }
      } catch (err) {
        console.error('Failed to export changes:', err);
        if (isMountedRef.current && !cancelled) {
          setError(t('sharing.sync.exportError', 'Failed to export changes'));
          setIsLoading(false);
        }
      }
    }

    void loadAndExport();
    return () => { cancelled = true; };
  }, [tripId, trip, t]);

  if (isLoading) {
    return <LoadingState variant="inline" />;
  }

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {isHostExport
              ? t(
                  'sharing.sync.exportInstructionsHost',
                  'Scan this QR from another device that has this same trip open to copy participants, room assignments, and transport details.',
                )
              : t(
                  'sharing.sync.exportInstructions',
                  'Show this QR code to another participant so they can scan it and sync your changes.',
                )}
          </p>
        </CardContent>
      </Card>

      <MultiFrameQR
        frames={frames}
        rawPayload={rawPayload}
      />

      {frames.length > 1 && (
        <p className="text-center text-xs text-muted-foreground">
          {t(
            'sharing.sync.multiFrameHint',
            'This QR code has {{count}} frames. Keep it still while scanning all frames.',
            { count: frames.length },
          )}
        </p>
      )}
    </div>
  );
});

// ============================================================================
// Import Tab
// ============================================================================

interface ImportTabProps {
  readonly tripId: string;
}

const ImportTab = memo(function ImportTab({ tripId }: ImportTabProps) {
  const { t } = useTranslation();
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanError, setScanError] = useState<string | undefined>();
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const isMountedRef = useRef(true);

  // Multi-frame state
  const framesRef = useRef<Map<number, string>>(new Map());
  const [totalFrames, setTotalFrames] = useState(0);
  const [framesReceived, setFramesReceived] = useState(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const processPayload = useCallback(async (encoded: string) => {
    setIsProcessing(true);
    setScanError(undefined);

    try {
      const changeset = decodeChangeset(encoded);

      if (changeset.tripId !== tripId) {
        setScanError(t('sharing.sync.wrongTrip', 'This QR code is for a different trip'));
        setIsProcessing(false);
        return;
      }

      const result = await computeMerge(changeset);

      if (!isMountedRef.current) return;

      setMergeResult(result);
      setIsProcessing(false);
    } catch (error) {
      console.error('Failed to process QR data:', error);
      if (isMountedRef.current) {
        setScanError(
          error instanceof Error
            ? error.message
            : t('sharing.sync.decodeError', 'Failed to decode QR code data'),
        );
        setIsProcessing(false);
      }
    }
  }, [tripId, t]);

  const handleScan = useCallback((data: string) => {
    const frame = parseFrame(data);

    if (frame) {
      framesRef.current.set(frame.index, frame.data);
      setTotalFrames(frame.total);

      if (isMountedRef.current) {
        setFramesReceived(framesRef.current.size);
      }

      const reassembled = reassembleFrames(framesRef.current, frame.total);
      if (reassembled) {
        void processPayload(reassembled);
      }
    } else {
      void processPayload(data);
    }
  }, [processPayload]);

  const handleScanError = useCallback((error: string) => {
    console.warn('QR scan error:', error);
  }, []);

  const handleResetScan = useCallback(() => {
    setMergeResult(null);
    setScanError(undefined);
    framesRef.current.clear();
    setTotalFrames(0);
    setFramesReceived(0);
  }, []);

  // Show merge review inline if we have a result
  if (mergeResult) {
    return (
      <MergeReview
        mergeResult={mergeResult}
        tripId={tripId}
        onReset={handleResetScan}
      />
    );
  }

  if (isProcessing) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <LoadingState variant="inline" />
        <p className="text-sm text-muted-foreground">
          {t('sharing.sync.processing', 'Processing changes...')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <ScanLine className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {t(
              'sharing.sync.importInstructions',
              "Point your camera at the guest's QR code to import their changes.",
            )}
          </p>
        </CardContent>
      </Card>

      {/* Multi-frame progress */}
      {totalFrames > 0 && (
        <div className="text-center">
          <p className="text-sm font-medium text-muted-foreground">
            {t('sharing.sync.framesProgress', 'Frames: {{received}} / {{total}}', {
              received: framesReceived,
              total: totalFrames,
            })}
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${(framesReceived / totalFrames) * 100}%` }}
            />
          </div>
        </div>
      )}

      <QRScanner
        onScan={handleScan}
        onError={handleScanError}
        active={!isProcessing}
      />

      {scanError && (
        <Card className="border-destructive/50">
          <CardContent className="p-4">
            <p className="text-sm text-destructive">{scanError}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
});

// ============================================================================
// Merge Review (inline)
// ============================================================================

interface MergeReviewProps {
  readonly mergeResult: MergeResult;
  readonly tripId: string;
  readonly onReset: () => void;
}

const MergeReview = memo(function MergeReview({ mergeResult, tripId, onReset }: MergeReviewProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [conflictResolutions, setConflictResolutions] = useState<Map<string, ConflictResolution>>(
    () => new Map(),
  );
  const [isApplying, setIsApplying] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const isSubmittingRef = useRef(false);

  const allConflictsResolved = useMemo(() => {
    return mergeResult.conflicts.every(c => conflictResolutions.has(c.entityId));
  }, [mergeResult, conflictResolutions]);

  const resolveConflict = useCallback((entityId: string, resolution: ConflictResolution) => {
    setConflictResolutions(prev => {
      const next = new Map(prev);
      next.set(entityId, resolution);
      return next;
    });
  }, []);

  const handleApply = useCallback(async () => {
    if (isSubmittingRef.current) return;
    if (!allConflictsResolved && mergeResult.conflicts.length > 0) return;

    isSubmittingRef.current = true;
    setIsApplying(true);

    try {
      const resolvedResult: MergeResult = {
        ...mergeResult,
        conflicts: mergeResult.conflicts.map(c => ({
          ...c,
          resolution: conflictResolutions.get(c.entityId) ?? 'keep-host',
        })),
      };

      const result = await applyMerge(resolvedResult);
      const totalApplied = result.personsUpserted + result.assignmentsUpserted +
        result.transportsUpserted + result.conflictsAccepted;

      toast.success(
        t('sharing.sync.mergeSuccess', 'Merged {{count}} changes successfully', {
          count: totalApplied,
        }),
      );

      navigate(`/trips/${tripId}/calendar`);
    } catch (error) {
      console.error('Failed to apply merge:', error);
      toast.error(t('sharing.sync.mergeError', 'Failed to apply changes'));
    } finally {
      isSubmittingRef.current = false;
      setIsApplying(false);
    }
  }, [mergeResult, allConflictsResolved, conflictResolutions, navigate, tripId, t]);

  const { summary, autoApply, conflicts, warnings } = mergeResult;
  const hasChanges = summary.additions > 0 || summary.autoUpdates > 0 || summary.conflicts > 0;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <GitMerge className="h-5 w-5 text-primary" aria-hidden="true" />
            {t('sharing.sync.mergeSummary', 'Merge Summary')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!hasChanges && (
            <p className="text-sm text-muted-foreground">
              {t('sharing.sync.noChanges', 'No changes to apply')}
            </p>
          )}
          {summary.autoUpdates > 0 && (
            <SummaryRow
              icon={<Check className="h-4 w-4 text-green-600" />}
              label={t('sharing.sync.autoApplyCount', '{{count}} auto-applied changes', {
                count: summary.autoUpdates,
              })}
              color="green"
            />
          )}
          {summary.conflicts > 0 && (
            <SummaryRow
              icon={<AlertTriangle className="h-4 w-4 text-orange-500" />}
              label={t('sharing.sync.conflictCount', '{{count}} conflicts to resolve', {
                count: summary.conflicts,
              })}
              color="orange"
            />
          )}
          {summary.warnings > 0 && (
            <SummaryRow
              icon={<AlertTriangle className="h-4 w-4 text-yellow-500" />}
              label={t('sharing.sync.warningCount', '{{count}} warnings', {
                count: summary.warnings,
              })}
              color="yellow"
            />
          )}
        </CardContent>
      </Card>

      {/* Auto-apply details (collapsible) */}
      {(autoApply.persons.length > 0 || autoApply.assignments.length > 0 || autoApply.transports.length > 0) && (
        <Card className="border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20">
          <CardHeader className="pb-2">
            <button
              type="button"
              className="flex w-full items-center justify-between"
              onClick={() => setShowDetails(!showDetails)}
            >
              <CardTitle className="text-sm font-medium text-green-800 dark:text-green-200">
                {t('sharing.sync.autoApplied', 'Auto-applied changes')}
              </CardTitle>
              {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </CardHeader>
          {showDetails && (
            <CardContent className="space-y-1 pt-0">
              {autoApply.persons.map(p => (
                <EntityRow key={p.id} icon={<User className="h-3.5 w-3.5" />} label={p.name} />
              ))}
              {autoApply.assignments.map(a => (
                <EntityRow key={a.id} icon={<Bed className="h-3.5 w-3.5" />} label={`${t('sharing.sync.assignment', 'Room assignment')} ${a.id.slice(0, 6)}...`} />
              ))}
              {autoApply.transports.map(tr => (
                <EntityRow key={tr.id} icon={<Train className="h-3.5 w-3.5" />} label={`${tr.type} - ${tr.location}`} />
              ))}
            </CardContent>
          )}
        </Card>
      )}

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-orange-800 dark:text-orange-200">
            {t('sharing.sync.conflictsTitle', 'Conflicts')}
          </h2>
          {conflicts.map(conflict => (
            <ConflictCard
              key={conflict.entityId}
              conflict={conflict}
              resolution={conflictResolutions.get(conflict.entityId)}
              onResolve={resolveConflict}
            />
          ))}
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50/50 dark:border-yellow-900 dark:bg-yellow-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              {t('sharing.sync.warningsTitle', 'Warnings')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {warnings.map((w, i) => (
              <p key={i} className="text-xs text-yellow-700 dark:text-yellow-300">{w.message}</p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={onReset}
          className="flex-1"
          disabled={isApplying}
        >
          {t('sharing.sync.scanAnother', 'Scan another')}
        </Button>
        <Button
          onClick={() => { void handleApply(); }}
          className="flex-1"
          disabled={isApplying || (!allConflictsResolved && conflicts.length > 0) || !hasChanges}
        >
          {isApplying
            ? t('sharing.sync.applying', 'Applying...')
            : t('sharing.sync.applyMerge', 'Apply Changes')
          }
        </Button>
      </div>
    </div>
  );
});

// ============================================================================
// Sub-Components
// ============================================================================

interface SummaryRowProps {
  readonly icon: ReactElement;
  readonly label: string;
  readonly color: 'green' | 'orange' | 'yellow';
}

const SummaryRow = memo(function SummaryRow({ icon, label, color }: SummaryRowProps) {
  return (
    <div className={cn(
      'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
      color === 'green' && 'bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-200',
      color === 'orange' && 'bg-orange-50 text-orange-800 dark:bg-orange-950/30 dark:text-orange-200',
      color === 'yellow' && 'bg-yellow-50 text-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-200',
    )}>
      {icon}
      <span>{label}</span>
    </div>
  );
});

interface EntityRowProps {
  readonly icon: ReactElement;
  readonly label: string;
}

const EntityRow = memo(function EntityRow({ icon, label }: EntityRowProps) {
  return (
    <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-300">
      {icon}
      <span>{label}</span>
    </div>
  );
});

interface ConflictCardProps {
  readonly conflict: MergeConflict;
  readonly resolution: ConflictResolution | undefined;
  readonly onResolve: (entityId: string, resolution: ConflictResolution) => void;
}

const ConflictCard = memo(function ConflictCard({ conflict, resolution, onResolve }: ConflictCardProps) {
  const { t } = useTranslation();

  const entityIcon = conflict.entityType === 'person'
    ? <User className="h-4 w-4" />
    : conflict.entityType === 'assignment'
      ? <Bed className="h-4 w-4" />
      : <Train className="h-4 w-4" />;

  return (
    <Card className={cn(
      'shadow-sm',
      resolution ? 'border-green-200 bg-green-50/30 dark:border-green-900 dark:bg-green-950/10' : 'border-orange-200 dark:border-orange-900',
    )}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {entityIcon}
          <span className="truncate">{conflict.label}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t('sharing.sync.conflictFields', 'Differing fields: {{fields}}', {
            fields: conflict.conflictingFields.join(', '),
          })}
        </p>
        <div className="flex gap-2">
          <Button
            variant={resolution === 'keep-host' ? 'default' : 'outline'}
            size="sm"
            className={cn('flex-1 text-xs', resolution === 'keep-host' && 'bg-blue-600 hover:bg-blue-700')}
            onClick={() => onResolve(conflict.entityId, 'keep-host')}
          >
            {t('sharing.sync.keepMine', 'Keep mine')}
          </Button>
          <Button
            variant={resolution === 'accept-guest' ? 'default' : 'outline'}
            size="sm"
            className={cn('flex-1 text-xs', resolution === 'accept-guest' && 'bg-primary hover:bg-primary/90')}
            onClick={() => onResolve(conflict.entityId, 'accept-guest')}
          >
            {t('sharing.sync.acceptGuest', 'Accept theirs')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export const TripSyncPage = memo(function TripSyncPage(): ReactElement {
  const { t } = useTranslation();
  const { tripId } = useParams<{ tripId: string }>();

  const [trip, setTrip] = useState<Trip | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;

    async function loadTrip(): Promise<void> {
      try {
        const loaded = await getTripById(tripId as TripId);
        if (cancelled || !isMountedRef.current) return;
        setTrip(loaded ?? undefined);
      } catch (error) {
        console.error('Failed to load trip:', error);
      } finally {
        if (!cancelled && isMountedRef.current) {
          setIsLoading(false);
        }
      }
    }

    void loadTrip();
    return () => { cancelled = true; };
  }, [tripId]);

  if (isLoading) {
    return (
      <div className="container max-w-2xl py-6 md:py-8">
        <PageHeader title={t('sharing.sync.pageTitle', 'Sync')} backLink="/settings" />
        <LoadingState variant="inline" />
      </div>
    );
  }

  if (!trip || !tripId) {
    return (
      <div className="container max-w-2xl py-6 md:py-8">
        <PageHeader title={t('sharing.sync.pageTitle', 'Sync')} backLink="/trips" />
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">{t('sharing.sync.tripNotFound', 'Trip not found')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-6 md:py-8">
      <PageHeader
        title={t('sharing.sync.pageTitle', 'Sync')}
        description={trip.name}
        backLink="/settings"
      />

      <Tabs defaultValue="import" className="mt-4">
        <TabsList className="w-full">
          <TabsTrigger value="import" className="flex-1">
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('sharing.sync.importTab', 'Import')}
          </TabsTrigger>
          <TabsTrigger value="export" className="flex-1">
            <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('sharing.sync.exportTab', 'Export')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="export" className="mt-4">
          <ExportTab trip={trip} tripId={tripId} />
        </TabsContent>

        <TabsContent value="import" className="mt-4">
          <ImportTab tripId={tripId} />
        </TabsContent>
      </Tabs>
    </div>
  );
});

export default TripSyncPage;
