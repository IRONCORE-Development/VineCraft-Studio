import { useState } from 'react';
import { Check, Copy, Lock, Unlock, X } from 'lucide-react';

export interface PromptsPayload {
  originalExtensionPrompt: string;
  originalExtensionNote: string;
  defaultGenerationPrompt: string;
  lockedQualityPrompt: string;
  defaultRefinePrompt: string;
  personaDistillPrompt?: string;
}

interface SystemPromptsModalProps {
  open: boolean;
  onClose: () => void;
  prompts: PromptsPayload | null;
  customInstructions: string;
  overrideEnabled: boolean;
  qualityPromptOverride: string;
  learnedToneEnabled: boolean;
  learnedToneSummary: string;
  learnedFacts: string[];
  learnedToneOverrideEnabled: boolean;
  onOpenAdvanced: () => void;
}

export function SystemPromptsModal({
  open,
  onClose,
  prompts,
  customInstructions,
  overrideEnabled,
  qualityPromptOverride,
  learnedToneEnabled,
  learnedToneSummary,
  learnedFacts,
  learnedToneOverrideEnabled,
  onOpenAdvanced,
}: SystemPromptsModalProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!open) return null;

  const activeQualityPrompt =
    overrideEnabled && qualityPromptOverride.trim()
      ? qualityPromptOverride.trim()
      : prompts?.lockedQualityPrompt || '';

  const activeGenerationPrompt = `${prompts?.defaultGenerationPrompt || ''}${
    customInstructions.trim()
      ? `\n\nCustom User Rules:\n${customInstructions.trim()}`
      : ''
  }`;

  async function copyText(key: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((p) => (p === key ? null : p)), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-3xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              System Prompts & Original Extension Inspection
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              View extracted prompts from your original extension alongside the active generation and locked quality inspection prompts.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close prompts dialog"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {!prompts ? (
            <div className="text-slate-500 dark:text-slate-400">Loading prompts…</div>
          ) : (
            <>
              {/* 1. Original Extension Architecture & Extracted Prompt */}
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                    1. Original Firefox Extension Prompt & Model Architecture
                  </h3>
                  <button
                    type="button"
                    onClick={() => copyText('orig', prompts.originalExtensionPrompt)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    {copiedKey === 'orig' ? (
                      <Check className="size-3 text-emerald-600" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                    {copiedKey === 'orig' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  {prompts.originalExtensionNote}
                </p>
                <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 text-slate-200 p-3.5 font-mono text-[11px] leading-relaxed">
                  {prompts.originalExtensionPrompt}
                </pre>
              </section>

              {/* 2. Locked AI Quality Inspection System Prompt */}
              <section className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {overrideEnabled && qualityPromptOverride.trim() ? (
                      <Unlock className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    ) : (
                      <Lock className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    )}
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                      2. AI Quality Inspection System Prompt{' '}
                      <span className="font-normal text-slate-500 dark:text-slate-400">
                        ({overrideEnabled && qualityPromptOverride.trim() ? 'Advanced Override Active' : 'Locked Default'})
                      </span>
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenAdvanced();
                      }}
                      className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                    >
                      Configure in Advanced
                    </button>
                    <button
                      type="button"
                      onClick={() => copyText('qual', activeQualityPrompt)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                    >
                      {copiedKey === 'qual' ? (
                        <Check className="size-3 text-emerald-600" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                      {copiedKey === 'qual' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 text-slate-200 p-3.5 font-mono text-[11px] leading-relaxed">
                  {activeQualityPrompt}
                </pre>
              </section>

              {/* 3. Active Review Generation Prompt */}
              <section className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                    3. Active Review Generation System Prompt
                  </h3>
                  <button
                    type="button"
                    onClick={() => copyText('gen', activeGenerationPrompt)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    {copiedKey === 'gen' ? (
                      <Check className="size-3 text-emerald-600" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                    {copiedKey === 'gen' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 text-slate-200 p-3.5 font-mono text-[11px] leading-relaxed">
                  {activeGenerationPrompt}
                </pre>
              </section>

              {/* 4. Learned Reviewer Tone & Persona */}
              <section className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {learnedToneOverrideEnabled ? (
                      <Unlock className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    ) : (
                      <Lock className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    )}
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                      4. Learned Reviewer Tone & Persona{' '}
                      <span className="font-normal text-slate-500 dark:text-slate-400">
                        ({learnedToneEnabled ? (learnedToneSummary || learnedFacts.length ? 'Active' : 'Not distilled yet') : 'Off'})
                      </span>
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAdvanced();
                    }}
                    className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    Distill / Unlock in Advanced
                  </button>
                </div>
                <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 text-slate-200 p-3.5 font-mono text-[11px] leading-relaxed">
                  {learnedToneSummary || learnedFacts.length
                    ? `${learnedToneSummary ? `Voice & Cadence:\n${learnedToneSummary}\n\n` : ''}${
                        learnedFacts.length ? `Learned Facts:\n- ${learnedFacts.join('\n- ')}` : ''
                      }`
                    : 'No learned tone distilled yet. Open Advanced to distill your tone from past ordered items & reviews (or import your Reviewed page via Firefox Companion).'}
                </pre>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
