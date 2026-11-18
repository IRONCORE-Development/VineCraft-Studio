import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from 'lucide-react';
import { QualityAssessment, QualityBand } from '../types';

interface QualityInspectorPanelProps {
  band: QualityBand;
  assessment: QualityAssessment | null;
  inspecting: boolean;
  refining: boolean;
  stale: boolean;
  hasDraft: boolean;
  onInspect: () => void;
  onRefine: () => void;
}

const BAND_LABEL: Record<QualityBand, string> = {
  none: 'Not inspected',
  needs_detail: 'Needs detail',
  good: 'Good',
  strong: 'Strong',
};

export function QualityInspectorPanel({
  band,
  assessment,
  inspecting,
  refining,
  stale,
  hasDraft,
  onInspect,
  onRefine,
}: QualityInspectorPanelProps) {
  const bandColor =
    band === 'strong'
      ? 'text-emerald-700 dark:text-emerald-400'
      : band === 'good'
        ? 'text-amber-700 dark:text-amber-400'
        : band === 'needs_detail'
          ? 'text-rose-700 dark:text-rose-400'
          : 'text-slate-500 dark:text-slate-400';

  return (
    <section className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            AI Quality Inspection
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Verifies ASIN/product match, human originality, rating alignment, and Vine guideline safety.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasDraft && band !== 'none' && band !== 'strong' && (
            <button
              type="button"
              onClick={onRefine}
              disabled={refining || inspecting}
              className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              {refining ? 'Refining to Strong…' : 'Refine to Strong with AI'}
            </button>
          )}
          <button
            type="button"
            onClick={onInspect}
            disabled={!hasDraft || inspecting || refining}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`size-3.5 ${inspecting ? 'animate-spin' : ''}`} />
            {inspecting ? 'Inspecting…' : 'Check Review Quality'}
          </button>
        </div>
      </div>

      {stale && assessment && (
        <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>Draft edited since last check. Run Check Review Quality to refresh assessment.</span>
        </div>
      )}

      {!assessment ? (
        <div className="py-4 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          Generate or paste a review draft above to run the automatic quality inspection.
        </div>
      ) : (
        <div className="space-y-4 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-center gap-2">
              {band === 'strong' ? (
                <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className={`size-4 shrink-0 ${bandColor}`} />
              )}
              <span className={`text-sm font-semibold ${bandColor}`}>
                Quality Rating: {BAND_LABEL[band]}
              </span>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {band === 'strong'
                ? 'Eligible for Strong DB cache & Amazon form prefill'
                : 'Refine draft before caching as Strong'}
            </span>
          </div>

          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
            {assessment.summary}
          </p>

          {(assessment.asinProductMatch || assessment.originality) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {assessment.asinProductMatch && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    {assessment.asinProductMatch.status === 'matched' ? (
                      <>
                        <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span className="text-emerald-700 dark:text-emerald-400">
                          ASIN / Product Verified
                        </span>
                      </>
                    ) : assessment.asinProductMatch.status === 'mismatch' ? (
                      <>
                        <ShieldAlert className="size-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                        <span className="text-rose-700 dark:text-rose-400">
                          ASIN / Product Mismatch
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span className="text-amber-700 dark:text-amber-400">
                          Product Metadata Incomplete
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {assessment.asinProductMatch.reason}
                  </p>
                </div>
              )}

              {assessment.originality && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    {assessment.originality.verified ? (
                      <>
                        <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span className="text-emerald-700 dark:text-emerald-400">
                          Original Human Experience Verified
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span className="text-amber-700 dark:text-amber-400">
                          Needs Authentic Human Specifics
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {assessment.originality.reason}
                  </p>
                </div>
              )}
            </div>
          )}

          {assessment.strengths.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Observed Strengths
              </div>
              <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
                {assessment.strengths.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {assessment.suggestions.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Actionable Improvements
              </div>
              <div className="space-y-2">
                {assessment.suggestions.map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80 p-3 space-y-1 text-xs"
                  >
                    {item.quote && (
                      <blockquote className="text-amber-900 dark:text-amber-200 bg-amber-100/70 dark:bg-amber-900/40 px-2 py-1 rounded">
                        “{item.quote}”
                      </blockquote>
                    )}
                    <p className="text-slate-700 dark:text-slate-300">{item.issue}</p>
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {item.question}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {assessment.concerns.length > 0 && (
            <div className="rounded-lg border border-rose-200 dark:border-rose-900/70 bg-rose-50 dark:bg-rose-950/30 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300">
                <ShieldAlert className="size-3.5 shrink-0" />
                <span>Possible Amazon Guideline Concerns</span>
              </div>
              <ul className="space-y-1 text-xs text-rose-700 dark:text-rose-300 list-disc pl-4">
                {assessment.concerns.map((c, idx) => (
                  <li key={idx}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
