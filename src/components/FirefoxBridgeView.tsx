import { useState } from 'react';
import { Check, Copy, Download, ShieldCheck } from 'lucide-react';
import { generateCompanionFirefoxZip } from '../lib/companionExtension';
import { ReviewItem } from '../types';

interface FirefoxBridgeViewProps {
  bridgeKey: string;
  readyDrafts: ReviewItem[];
}

export function FirefoxBridgeView({
  bridgeKey,
  readyDrafts,
}: FirefoxBridgeViewProps) {
  const [copiedKey, setCopiedKey] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const studioOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  async function handleDownloadZip() {
    setDownloading(true);
    try {
      const blob = await generateCompanionFirefoxZip(studioOrigin, bridgeKey);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'vinecraft-safe-zone-companion.zip';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  async function copyBridgeKey() {
    await navigator.clipboard.writeText(bridgeKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1800);
  }

  async function handleSyncPopupNow() {
    try {
      const res = await fetch('/api/bridge/staged', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bridgeKey,
          drafts: readyDrafts.map((r) => ({
            id: r.id,
            asin: r.asin,
            productTitle: r.productTitle,
            rating: r.rating,
            draftTitle: r.draftTitle || '',
            draftBody: r.draftBody || '',
            reviewUrl: r.reviewUrl || '',
            marketplace: r.marketplace,
            status: r.status,
          })),
        }),
      });
      if (!res.ok) throw new Error('Sync failed');
      const data = await res.json();
      setSyncMessage(`Synced ${Number(data.count || 0)} Strong/Ready draft(s) to your Firefox popup.`);
    } catch {
      setSyncMessage('Could not sync staged drafts right now.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Safe-Zone Firefox Companion (Zero-Amazon-Touch)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            100% isolated from Amazon: zero content scripts, zero Amazon host permissions, zero DOM reading, and zero synthetic clicks or auto-fill.
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownloadZip}
          disabled={downloading}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="size-3.5" />
          {downloading ? 'Building Safe-Zone Zip…' : 'Download Safe-Zone Extension (.zip)'}
        </button>
      </div>

      {/* Mandatory Safety Notice */}
      <section className="border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-xl p-5 space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900 dark:text-emerald-300">
          <ShieldCheck className="size-4 shrink-0" />
          <span>Strict Safe-Zone Compliance (No Automated Browsing Signals)</span>
        </div>
        <p className="text-xs text-emerald-900/90 dark:text-emerald-200/90 leading-relaxed">
          If you previously installed an older Amazon-touching add-on or userscript (including v1.0/v1.1 or SmartViner),{' '}
          <strong>remove it in Firefox (<span className="font-mono">about:addons</span>) right away</strong> so nothing injects scripts or alters clicks on Amazon. This v2.0.0 Safe-Zone Companion only communicates with VineCraft Studio to hold your clipboard-ready drafts—Amazon only ever sees your normal human browsing, star clicks, copy-paste, and Submit clicks.
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            How the Safe-Zone Workflow Works
          </h3>
          <ol className="space-y-3 text-xs text-slate-600 dark:text-slate-300 list-decimal pl-4 leading-relaxed">
            <li>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Import Safely Without Scripts:
              </span>{' '}
              Browse your Amazon Vine queue normally in Firefox, press{' '}
              <span className="font-mono">Ctrl+U</span> (View Page Source) →{' '}
              <span className="font-mono">Ctrl+A</span> →{' '}
              <span className="font-mono">Ctrl+C</span>, and paste into{' '}
              <strong>Batch Queue → Amazon Vine Page HTML</strong>. Zero extensions read or scrape Amazon’s DOM.
            </li>
            <li>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Generate & Audit in Studio:
              </span>{' '}
              Draft authentic reviews with your learned voice and verify ASIN match, originality, and Strong quality entirely inside VineCraft Studio.
            </li>
            <li>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Copy & Paste Manually in Firefox:
              </span>{' '}
              Click the green VineCraft icon in Firefox’s toolbar to copy your Headline and Review Body into the clipboard, click stars yourself on Amazon, paste (<span className="font-mono">Ctrl+V</span>), and click Amazon’s Submit button naturally.
            </li>
          </ol>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Studio Companion Key
              </div>
              <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                {bridgeKey}
              </div>
            </div>
            <button
              type="button"
              onClick={copyBridgeKey}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              {copiedKey ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
              {copiedKey ? 'Copied Key' : 'Copy Key'}
            </button>
          </div>
        </section>

        <section className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Toolbar Clipboard Sync Status
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {readyDrafts.length} Strong / Ready draft(s) available to sync to your Firefox toolbar popup.
              </p>
            </div>
            <button
              type="button"
              onClick={handleSyncPopupNow}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white whitespace-nowrap shrink-0"
            >
              Sync to Popup Now
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 space-y-2 text-xs text-slate-600 dark:text-slate-300">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              Extension Manifest Audit (v2.0.0)
            </div>
            <ul className="space-y-1 list-disc pl-4">
              <li>Content Scripts on Amazon: <strong>0 (None)</strong></li>
              <li>Amazon Host Permissions: <strong>0 (None)</strong></li>
              <li>Programmatic Form-Fill / Synthetic Clicks: <strong>Removed</strong></li>
              <li>Allowed Permissions: <span className="font-mono">storage</span>, <span className="font-mono">clipboardWrite</span>, Studio origin only</li>
            </ul>
            {syncMessage && (
              <p className="pt-2 text-emerald-700 dark:text-emerald-400 font-medium">
                {syncMessage}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
