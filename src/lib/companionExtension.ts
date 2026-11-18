import JSZip from 'jszip';

export function buildSafePopupHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>VineCraft Safe-Zone Clipboard Companion</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: 370px;
      padding: 14px;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #f8fafc;
    }
    .hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .brand { font-weight: 700; font-size: 14px; letter-spacing: -0.01em; }
    .safe-box {
      background: #052e16;
      border: 1px solid #166534;
      color: #bbf7d0;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 11px;
      margin-bottom: 10px;
      line-height: 1.4;
    }
    .meta {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 11px;
      color: #cbd5e1;
      margin-bottom: 10px;
      word-break: break-all;
    }
    .row { display: flex; gap: 6px; margin-bottom: 10px; }
    button, a.btn {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 7px 10px;
      border-radius: 7px;
      border: 1px solid transparent;
      font: 600 11.5px/1.2 inherit;
      cursor: pointer;
      text-decoration: none;
    }
    .primary { background: #2563eb; color: #fff; }
    .primary:hover { background: #1d4ed8; }
    .secondary { background: #1e293b; color: #f8fafc; border-color: #475569; }
    .secondary:hover { background: #334155; }
    .list { max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 10px;
    }
    .card-asin { font-family: ui-monospace, monospace; font-size: 11px; color: #93c5fd; }
    .card-title { font-weight: 600; font-size: 12px; color: #f8fafc; margin: 2px 0 6px; }
    .card-actions { display: flex; gap: 6px; margin-top: 6px; }
    .empty { font-size: 11.5px; color: #94a3b8; text-align: center; padding: 14px 8px; background: #1e293b; border-radius: 8px; }
    .status {
      margin-top: 8px;
      font-size: 11px;
      padding: 6px 8px;
      border-radius: 6px;
      background: #1e293b;
      color: #86efac;
      display: none;
    }
    .status.err { color: #fca5a5; background: #450a0a; }
  </style>
</head>
<body>
  <div class="hdr">
    <span class="brand">VineCraft Safe-Zone Companion</span>
  </div>
  <div class="safe-box">
    <strong>100% Safe Zone:</strong> Zero scripts, zero DOM reading, and zero auto-clicks run on Amazon. Manual copy &amp; paste only.
  </div>
  <div class="meta">
    <div><strong>Studio:</strong> <span id="studio-origin">—</span></div>
    <div><strong>Bridge Key:</strong> <span id="bridge-key">—</span></div>
  </div>
  <div class="row">
    <button id="refresh-btn" class="primary">Refresh Ready Drafts</button>
    <button id="open-btn" class="secondary">Open Studio</button>
  </div>
  <div id="drafts-list" class="list"></div>
  <div id="status" class="status"></div>
  <script src="popup.js"></script>
</body>
</html>
`;
}

export function buildSafePopupScript(studioOrigin: string, bridgeKey: string): string {
  return `(function () {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const STUDIO_ORIGIN = ${JSON.stringify(studioOrigin.replace(/\/+$/, ''))};
  const BRIDGE_KEY = ${JSON.stringify(bridgeKey)};

  const originEl = document.getElementById('studio-origin');
  const keyEl = document.getElementById('bridge-key');
  const listEl = document.getElementById('drafts-list');
  const statusEl = document.getElementById('status');
  const refreshBtn = document.getElementById('refresh-btn');
  const openBtn = document.getElementById('open-btn');

  if (originEl) originEl.textContent = STUDIO_ORIGIN;
  if (keyEl) keyEl.textContent = BRIDGE_KEY;

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.style.display = 'block';
    statusEl.className = isError ? 'status err' : 'status';
    statusEl.textContent = msg;
  }

  openBtn?.addEventListener('click', () => {
    api.tabs.create({ url: STUDIO_ORIGIN });
  });

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied ' + label + ' to clipboard — paste naturally into Amazon.');
    } catch {
      setStatus('Clipboard write failed — copy from Studio directly.', true);
    }
  }

  function renderDrafts(drafts) {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!drafts.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No Strong/Ready drafts staged yet. Keep Studio open with Strong drafts saved, then click Refresh.';
      listEl.appendChild(empty);
      return;
    }
    drafts.forEach((d) => {
      const card = document.createElement('div');
      card.className = 'card';

      const asin = document.createElement('div');
      asin.className = 'card-asin';
      asin.textContent = d.asin + ' · ' + d.rating + '/5 stars';
      card.appendChild(asin);

      const title = document.createElement('div');
      title.className = 'card-title';
      title.textContent = d.draftTitle || d.productTitle;
      card.appendChild(title);

      const row = document.createElement('div');
      row.className = 'card-actions';

      const copyHead = document.createElement('button');
      copyHead.className = 'secondary';
      copyHead.textContent = 'Copy Headline';
      copyHead.onclick = () => copyText(d.draftTitle || '', d.asin + ' headline');
      row.appendChild(copyHead);

      const copyBody = document.createElement('button');
      copyBody.className = 'primary';
      copyBody.textContent = 'Copy Body';
      copyBody.onclick = () => copyText(d.draftBody || '', d.asin + ' review body');
      row.appendChild(copyBody);

      card.appendChild(row);

      const openLink = document.createElement('a');
      openLink.className = 'btn secondary';
      openLink.style.marginTop = '6px';
      openLink.href = d.reviewUrl;
      openLink.target = '_blank';
      openLink.rel = 'noopener noreferrer';
      openLink.textContent = 'Open Clean Amazon Review Page';
      card.appendChild(openLink);

      listEl.appendChild(card);
    });
  }

  async function loadStagedDrafts() {
    setStatus('Loading staged Strong drafts from Studio...');
    try {
      const res = await fetch(STUDIO_ORIGIN + '/api/bridge/staged?bridgeKey=' + encodeURIComponent(BRIDGE_KEY));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const drafts = Array.isArray(data.drafts) ? data.drafts : [];
      renderDrafts(drafts);
      setStatus('Loaded ' + drafts.length + ' ready draft(s) from Studio.');
    } catch {
      renderDrafts([]);
      setStatus('Could not reach Studio. Open VineCraft Studio in a tab first.', true);
    }
  }

  refreshBtn?.addEventListener('click', loadStagedDrafts);
  loadStagedDrafts();
})();
`;
}

const COMPANION_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="#052e16"/>
  <path d="M18 20l14 26 14-26" stroke="#4ade80" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="32" cy="18" r="4" fill="#93c5fd"/>
</svg>`;

/**
 * Generates a 100% Safe-Zone Firefox Companion Add-on:
 * - ZERO content_scripts on Amazon
 * - ZERO Amazon host permissions
 * - ZERO DOM scraping, click interception, or synthetic form filling
 * - Connects ONLY to VineCraft Studio so you can copy headlines/bodies cleanly while browsing Amazon manually.
 */
export async function generateCompanionFirefoxZip(
  studioOrigin: string,
  bridgeKey: string
): Promise<Blob> {
  const zip = new JSZip();
  const cleanOrigin = studioOrigin.replace(/\/+$/, '');
  const originPermission = /^https?:\/\//i.test(cleanOrigin) ? [`${cleanOrigin}/*`] : [];

  const manifest = {
    manifest_version: 2,
    name: 'VineCraft Safe-Zone Companion',
    version: '2.0.0',
    description:
      'Safe-Zone clipboard helper that displays your VineCraft Studio Strong drafts for manual copy & paste. Never injects scripts or touches Amazon pages.',
    icons: {
      '48': 'icon.svg',
      '96': 'icon.svg',
    },
    browser_action: {
      default_icon: 'icon.svg',
      default_title: 'VineCraft Safe-Zone Companion',
      default_popup: 'popup.html',
    },
    permissions: ['storage', 'clipboardWrite', ...originPermission],
    browser_specific_settings: {
      gecko: {
        id: 'companion@vinecraft.studio',
        strict_min_version: '109.0',
      },
    },
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('icon.svg', COMPANION_ICON_SVG);
  zip.file('popup.html', buildSafePopupHtml());
  zip.file('popup.js', buildSafePopupScript(cleanOrigin, bridgeKey));
  zip.file(
    'README.txt',
    `VineCraft Safe-Zone Companion (Firefox v2.0.0)\n\nIMPORTANT SAFE-ZONE GUARANTEE:\n- Contains ZERO content scripts and ZERO Amazon host permissions.\n- Never touches, scrapes, intercepts, or auto-fills Amazon pages.\n\nHow to install:\n1. Remove any older Amazon-touching add-on/userscript first.\n2. Extract this zip into a folder.\n3. Open Firefox -> about:debugging#/runtime/this-firefox -> Load Temporary Add-on... -> select manifest.json.\n4. Click the green VineCraft icon in Firefox's toolbar anytime to copy your Strong headlines/bodies and paste them manually into Amazon.\n`
  );

  return zip.generateAsync({ type: 'blob' });
}
