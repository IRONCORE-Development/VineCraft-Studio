import { useMemo, useState } from 'react';
import { FileCode2, ListPlus, Play, ShieldCheck, Square, Trash2, Upload } from 'lucide-react';
import { ReviewItem } from '../types';
import { CreateReviewInput, parseAmazonVineHtml, parseBatchTextInput } from '../lib/reviewService';

type LifecycleBucket = 'all' | 'pending' | 'interaction' | 'submitted' | 'completed';

interface BatchQueueViewProps {
  items: ReviewItem[];
  marketplace: string;
  batchRunning: boolean;
  batchProgress: {
    current: number;
    total: number;
    activeAsin?: string;
    tokensUsed: number;
    tokenCap: number;
  } | null;
  maxBatchItems: number;
  maxBatchTokens: number;
  batchDelayMs: number;
  onUpdateBatchConfig: (patch: {
    maxBatchItems?: number;
    maxBatchTokens?: number;
    batchDelayMs?: number;
  }) => Promise<void>;
  onImportItems: (items: CreateReviewInput[]) => Promise<void>;
  onStartBatch: () => void;
  onStopBatch: () => void;
  onSelectItem: (item: ReviewItem) => void;
  onDeleteItem: (id: string) => Promise<void>;
}

export function BatchQueueView({
  items,
  marketplace,
  batchRunning,
  batchProgress,
  maxBatchItems,
  maxBatchTokens,
  batchDelayMs,
  onUpdateBatchConfig,
  onImportItems,
  onStartBatch,
  onStopBatch,
  onSelectItem,
  onDeleteItem,
}: BatchQueueViewProps) {
  const [importMode, setImportMode] = useState<'text' | 'html'>('text');
  const [bucket, setBucket] = useState<LifecycleBucket>('all');
  const [rawInput, setRawInput] = useState('');
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const counts = useMemo(() => {
    const pending = items.filter((i) => i.status === 'queued').length;
    const interaction = items.filter(
      (i) => i.status === 'needs_review' || i.status === 'interaction_required'
    ).length;
    const submitted = items.filter(
      (i) =>
        i.status === 'cached_strong' ||
        i.status === 'ready_to_post' ||
        i.status === 'posted' ||
        i.status === 'submitted'
    ).length;
    const completed = items.filter((i) => i.status === 'completed').length;
    return { all: items.length, pending, interaction, submitted, completed };
  }, [items]);

  const filteredItems = useMemo(() => {
    if (bucket === 'all') return items;
    if (bucket === 'pending') return items.filter((i) => i.status === 'queued');
    if (bucket === 'interaction') {
      return items.filter(
        (i) => i.status === 'needs_review' || i.status === 'interaction_required'
      );
    }
    if (bucket === 'submitted') {
      return items.filter(
        (i) =>
          i.status === 'cached_strong' ||
          i.status === 'ready_to_post' ||
          i.status === 'posted' ||
          i.status === 'submitted'
      );
    }
    return items.filter((i) => i.status === 'completed');
  }, [items, bucket]);

  async function handleImport() {
    if (!rawInput.trim() || importing) return;
    setImporting(true);
    setImportFeedback(null);
    try {
      const parsed =
        importMode === 'html'
          ? parseAmazonVineHtml(rawInput, marketplace)
          : parseBatchTextInput(rawInput, marketplace);
      if (!parsed.length) {
        setImportFeedback('No valid 10-character Amazon ASINs found in the input.');
        return;
      }
      await onImportItems(parsed);
      setImportFeedback(`Synced ${parsed.length} item(s) across Amazon Vine status buckets.`);
      setRawInput('');
    } catch (err) {
      setImportFeedback(err instanceof Error ? err.message : 'Failed to import batch.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Batch Queue & Paginated Amazon Lifecycle
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Tracks Pending, Requires User Interaction, Submitted, and Completed reviews synced from Amazon Vine with strict token & rate guardrails.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {counts.pending} pending
          </span>
          {batchRunning ? (
            <button
              type="button"
              onClick={onStopBatch}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Square className="size-3.5" />
              Stop Batch
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartBatch}
              disabled={counts.pending === 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="size-3.5" />
              Run Batch (Up to {maxBatchItems})
            </button>
          )}
        </div>
      </div>

      {/* Batch Guardrails */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
          <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>Large-Batch Token, Rate-Limit & Cost Guardrails</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <label className="space-y-1 block">
            <span className="text-slate-600 dark:text-slate-400">Max items per batch run</span>
            <select
              value={maxBatchItems}
              onChange={(e) => onUpdateBatchConfig({ maxBatchItems: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            >
              <option value={10}>10 items (safe micro-batch)</option>
              <option value={25}>25 items (standard)</option>
              <option value={50}>50 items</option>
              <option value={100}>100 items</option>
            </select>
          </label>
          <label className="space-y-1 block">
            <span className="text-slate-600 dark:text-slate-400">Token cap per batch run</span>
            <select
              value={maxBatchTokens}
              onChange={(e) => onUpdateBatchConfig({ maxBatchTokens: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            >
              <option value={25000}>25,000 tokens</option>
              <option value={75000}>75,000 tokens</option>
              <option value={150000}>150,000 tokens (recommended)</option>
              <option value={300000}>300,000 tokens</option>
            </select>
          </label>
          <label className="space-y-1 block">
            <span className="text-slate-600 dark:text-slate-400">Pacing delay between items</span>
            <select
              value={batchDelayMs}
              onChange={(e) => onUpdateBatchConfig({ batchDelayMs: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            >
              <option value={1000}>1.0s (fast)</option>
              <option value={2000}>2.0s (recommended)</option>
              <option value={3500}>3.5s (rate-limit safe)</option>
              <option value={5000}>5.0s (conservative)</option>
            </select>
          </label>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Automatically skips already-cached Strong items, trims listing context to stay lean, checkpoints each item to Firestore immediately, and auto-pauses if the token cap or API rate limit is reached.
        </p>
      </section>

      {batchProgress && (
        <div className="border border-blue-200 dark:border-blue-900/70 bg-blue-50/70 dark:bg-blue-950/30 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-800 dark:text-slate-200">
            <span className="font-semibold">Batch processing</span>
            <span className="mx-2 text-slate-400">·</span>
            <span className="tabular-nums">
              Item {batchProgress.current} of {batchProgress.total}
            </span>
            {batchProgress.activeAsin && (
              <>
                <span className="mx-2 text-slate-400">·</span>
                <span className="font-mono">{batchProgress.activeAsin}</span>
              </>
            )}
            <span className="mx-2 text-slate-400">·</span>
            <span className="tabular-nums">
              {batchProgress.tokensUsed.toLocaleString()} / {batchProgress.tokenCap.toLocaleString()} tokens
            </span>
          </div>
          <div className="w-48 h-1.5 bg-blue-200 dark:bg-blue-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 dark:bg-blue-400 transition-all duration-200"
              style={{
                width: `${Math.min(100, Math.round((batchProgress.current / Math.max(1, batchProgress.total)) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Batch Loader */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setImportMode('text')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                importMode === 'text'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <ListPlus className="size-3.5" />
              ASIN / JSON / CSV List
            </button>
            <button
              type="button"
              onClick={() => setImportMode('html')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                importMode === 'html'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <FileCode2 className="size-3.5" />
              Amazon Vine Page HTML
            </button>
          </div>

          <span className="text-xs text-slate-500 dark:text-slate-400">
            {importMode === 'text'
              ? 'Format: ASIN | Product Title | Notes (one per line) or JSON array'
              : 'Paste HTML from /vine/vine-reviews (extracts Pending, Submitted, Completed, & Unavailable)'}
          </span>
        </div>

        <textarea
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          rows={4}
          placeholder={
            importMode === 'text'
              ? 'B0D1234567 | Anodized Aluminum Desk Stand | Sturdy hinge, no wobble\nB0D7654321 | Braided USB-C 240W Cable 6ft | Flexible jacket, fast charge tested'
              : '<table class="a-normal">... paste Amazon Vine reviews table HTML ...</table>'
          }
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-600 dark:text-slate-400">
            {importFeedback ||
              'Safe-Zone Import: On Amazon Vine, press Ctrl+U (View Source) or Copy HTML and paste above—zero scripts ever touch Amazon.'}
          </div>
          <button
            type="button"
            onClick={handleImport}
            disabled={!rawInput.trim() || importing}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="size-3.5" />
            {importing ? 'Syncing…' : 'Load Into Queue'}
          </button>
        </div>
      </section>

      {/* 4 Lifecycle Buckets + Table */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto">
            {(
              [
                ['all', `All (${counts.all})`],
                ['pending', `Pending Reviews (${counts.pending})`],
                ['interaction', `Requires Interaction (${counts.interaction})`],
                ['submitted', `Submitted / Cached (${counts.submitted})`],
                ['completed', `Completed (${counts.completed})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setBucket(key)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                  bucket === key
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No items in this bucket yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-medium">ASIN</th>
                  <th className="py-2.5 px-4 font-medium">Product Title</th>
                  <th className="py-2.5 px-4 font-medium">Source</th>
                  <th className="py-2.5 px-4 font-medium">Quality</th>
                  <th className="py-2.5 px-4 font-medium">Bucket / Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredItems.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {item.asin}
                    </td>
                    <td className="py-2.5 px-4 text-slate-900 dark:text-slate-100 max-w-md">
                      <div className="truncate">{item.productTitle}</div>
                      {item.unavailableReason && (
                        <div className="text-[11px] text-rose-600 dark:text-rose-400 truncate">
                          {item.unavailableReason}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {item.source.replace(/_/g, ' ')}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap font-medium">
                      <span
                        className={
                          item.qualityBand === 'strong'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : item.qualityBand === 'good'
                              ? 'text-amber-700 dark:text-amber-400'
                              : item.qualityBand === 'needs_detail'
                                ? 'text-rose-700 dark:text-rose-400'
                                : 'text-slate-400'
                        }
                      >
                        {item.amazonQualityText
                          ? item.amazonQualityText
                          : item.qualityBand === 'none'
                            ? 'Uninspected'
                            : item.qualityBand === 'needs_detail'
                              ? 'Needs detail'
                              : item.qualityBand === 'good'
                                ? 'Good'
                                : 'Strong'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {item.status === 'cached_strong'
                        ? 'Cached (Strong)'
                        : item.status === 'ready_to_post'
                          ? 'Ready to Post'
                          : item.status === 'needs_review'
                            ? 'Needs Review'
                            : item.status === 'interaction_required'
                              ? 'Interaction Required'
                              : item.status === 'submitted'
                                ? 'Submitted (Amazon)'
                                : item.status === 'completed'
                                  ? 'Completed'
                                  : item.status === 'posted'
                                    ? 'Posted'
                                    : 'Pending Review'}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectItem(item)}
                          className="px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteItem(item.id)}
                          aria-label={`Remove ${item.asin}`}
                          className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
