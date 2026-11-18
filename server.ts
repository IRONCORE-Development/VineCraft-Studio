import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenerateContentResponse, GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const GEMINI_MODEL_NAME = 'gemini-4-hydrogen';
const ANTHROPIC_DEFAULT_MODEL = 'claude-3-5-haiku-latest';
const CUSTOM_DEFAULT_MODEL = 'llama3.2';
const MAX_CONCURRENT_AI = 3;

export type AiEnginePreset = 'free_local' | 'anthropic' | 'gemini' | 'custom_endpoint';

// Verbatim external AI prompt extracted from the original extension (vue-app/main.js line 72538)
const ORIGINAL_EXTENSION_HANDOFF_TEMPLATE = `Help me write my Amazon Vine review for the product below. Write it in MY voice — you know how I write from the reviews we've done together. Tell the story: why I ordered it, how I actually used it, what happened, what surprised me, and who it's best for. Honest and balanced, useful to shoppers. Push back if my take seems unfair or I missed something in the listing.

My experience:
- Star rating: {rating}/5
- What I liked: {liked}
- What I didn't like: {disliked}
- How I used it: {usage}
- Extra notes: {notes}

Product:
- Title: {title}
- ASIN: {asin}
- Listing details: {description}

Amazon rules to respect: don't mention getting the product free or through Vine (Amazon adds that label automatically), no links, no profanity, review the product itself.
Format your reply as: first line = review headline, blank line, then the review body. I'm attaching my product photos in this chat.`;

const ORIGINAL_EXTENSION_ARCHITECTURE_NOTE =
  'In the original SmartViner extension (v0.9.45), Review Quality Inspection (POST https://smartviner.com/api/v1/ai/review/quality) and Review Generation (POST https://smartviner.com/api/v1/ai/review/generate) ran server-side on smartviner.com. The extension defaulted to Anthropic (Claude) in Personal AI Settings and offered "jev" (fast) or "haiku" (Claude Haiku with reasoning) in AI Shopper. SmartViner’s backend system prompts resided on smartviner.com and were not bundled inside the extension zip; only the external handoff template above was stored client-side.';

const DEFAULT_GENERATION_SYSTEM_PROMPT = `Help write an Amazon Vine review for the product below in an authentic, natural first-person reviewer voice.
Tell the story: why it was picked, how it was actually used in real life, what happened during testing, what stood out or surprised you, and who it fits best. Be honest and balanced so it genuinely helps shoppers. Push back gently if any experience note seems unfair or misses something clearly stated in the listing.

Amazon rules to respect:
- NEVER mention getting the item free, discounted, or through Vine (Amazon adds that label automatically).
- NEVER include links, promo codes, profanity, or seller/shipping complaints; review the product itself.
- Ground every claim in the exact product matching the provided ASIN, its listing details, experience notes, and any attached photos (observable details only).
- Avoid cliché AI filler ("game changer", "look no further", "in conclusion", "elevates my workflow") and replace em/en-dashes with plain hyphens (-).`;

const LOCKED_QUALITY_INSPECTION_PROMPT = `You are a strict Amazon Vine Review Quality Inspector.
Evaluate four pillars:
1. ASIN & Product Match (asinProductMatch): Verify that the ASIN, Product Title, Listing Details, and Review Draft all describe the EXACT same product, category, specs, and materials. Flag "mismatch" if the draft reviews a different product or invents contradictory specs; flag "insufficient_metadata" if the title is a generic placeholder without real product details.
2. Originality & Real Human Experience (originality): Verify the draft reads like an original, lived-in human experience from someone who actually handled and tested the product (concrete sensory/usage moments, real trade-offs, natural cadence) rather than generic AI prose, templated phrasing, or paraphrased listing bullets.
3. Rating Alignment & Utility: Pros/cons and tone must align cleanly with the selected star rating.
4. Amazon Community Guideline Safety: No Vine/free-item mentions, no URLs, no seller/shipping complaints, no medical/unverified claims.

Bands:
- "needs_detail": generic, thin, reads like AI/listing copy, fails originality, rating mismatch, guideline issue, or ASIN/product mismatch.
- "good": helpful and compliant with matched product, could benefit from 1-2 sharper hands-on specifics or fresher phrasing.
- "strong": matched ASIN/product, verified original human experience, lived-in specifics, balanced utility, zero guideline concerns.`;

const DEFAULT_REFINE_SYSTEM_PROMPT = `Rewrite and substantially improve this Amazon Vine review draft so that EVERY quality suggestion, missing hands-on detail, originality weakness, and guideline or ASIN/product concern is completely resolved while keeping the same star rating and authentic human story. Never return the original draft unchanged. Ground claims strictly in the exact product title/details/notes; no Vine/free mentions, no links, no fabricated specs, and replace em/en-dashes with plain hyphens (-).`;

const DEFAULT_PERSONA_DISTILL_PROMPT = `You are a Reviewer Voice & Persona Distiller.
Analyze the reviewer's previously ordered items and previously written/published reviews below.
Extract two things accurately without inventing any facts not supported by the samples:
1. "toneSummary": A concise 3-5 sentence guide describing the reviewer's authentic writing voice — typical opening style, sentence cadence, vocabulary level, balance of praise vs. honest caveats, paragraph structure, and recurring testing priorities (e.g., ergonomics, materials, measurements, cable length).
2. "facts": Up to 16 short, concrete facts or preferences clearly evidenced across their ordered items and reviews (e.g., "Frequently tests USB-C desk accessories on a laptop workstation", "Values matte anti-fingerprint finishes", "Prefers concise paragraphs without bullet lists").

Rules:
- Never fabricate biographical details, gear, or opinions not evidenced in the provided items/reviews.
- Replace em/en-dashes with plain hyphens (-).
- Return strictly JSON: {"toneSummary": string, "facts": string[]}`;

function buildLearnedVoiceBlock(learnedVoice?: {
  enabled?: boolean;
  summary?: string;
  facts?: string[];
}): string {
  if (!learnedVoice || learnedVoice.enabled === false) return '';
  const summary = deDash(String(learnedVoice.summary || '')).trim().slice(0, 3000);
  const facts = Array.isArray(learnedVoice.facts)
    ? learnedVoice.facts
        .map((f) => deDash(String(f || '')).trim().slice(0, 300))
        .filter(Boolean)
        .slice(0, 20)
    : [];
  if (!summary && facts.length === 0) return '';
  return `\n\nLearned Reviewer Voice & Facts (match this authentic personal style and apply relevant real-world context naturally where it fits the product):\n${
    summary ? `Voice & Cadence: ${summary}\n` : ''
  }${facts.length ? `Known Reviewer Context:\n- ${facts.join('\n- ')}` : ''}`;
}

let activeAiCalls = 0;
const aiWaitQueue: Array<() => void> = [];

function acquireAiSlot(): Promise<void> {
  if (activeAiCalls < MAX_CONCURRENT_AI) {
    activeAiCalls++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    aiWaitQueue.push(() => {
      activeAiCalls++;
      resolve();
    });
  });
}

function releaseAiSlot() {
  activeAiCalls = Math.max(0, activeAiCalls - 1);
  const next = aiWaitQueue.shift();
  if (next) next();
}

async function withAiQueueSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireAiSlot();
  try {
    return await fn();
  } finally {
    releaseAiSlot();
  }
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function deDash(value: string): string {
  return String(value || '').replace(/[‒–—―−]/g, '-');
}

function extractGeminiUsage(response: GenerateContentResponse) {
  const meta = response.usageMetadata;
  return {
    promptTokens: Number(meta?.promptTokenCount || 0),
    outputTokens: Number(meta?.candidatesTokenCount || 0),
    totalTokens: Number(meta?.totalTokenCount || 0),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseHttpStatus(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b429\b|RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(msg)) return 429;
  if (/\b503\b|UNAVAILABLE|overloaded/i.test(msg)) return 503;
  if (/\b502\b|\b504\b|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(msg)) return 503;
  if (/\b403\b|PERMISSION_DENIED/i.test(msg)) return 403;
  if (/\b400\b|API_KEY_INVALID/i.test(msg)) return 400;
  return 500;
}

async function callWithBackoff<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  const baseDelays = [1500, 3500, 7500, 14000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withAiQueueSlot(fn);
    } catch (err) {
      lastErr = err;
      const status = parseHttpStatus(err);
      if ((status === 429 || status === 503) && attempt < maxRetries) {
        const jitter = Math.floor(Math.random() * 600);
        await sleep((baseDelays[attempt] || 10000) + jitter);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function safeParseJson<T>(rawText: string | undefined, fallback: T): T {
  const raw = String(rawText || '').trim();
  if (!raw) return fallback;
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

function validateCustomEndpointUrl(rawUrl: string): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    throw new Error(
      'Custom endpoint URL is empty. Enter an endpoint URL in Advanced settings or configure OLLAMA_BASE_URL / CUSTOM_AI_BASE_URL on the server.'
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Custom endpoint URL must be a valid http(s) URL.');
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    throw new Error('Custom endpoint URL must use HTTPS (or http://localhost for local Ollama).');
  }
  if (
    host === '169.254.169.254' ||
    host.endsWith('.internal') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error('Private network / metadata IP addresses are blocked for security.');
  }
  return parsed.toString();
}

async function callAnthropicJson(params: {
  model?: string;
  systemInstruction: string;
  userPrompt: string;
}): Promise<{ text: string; usage: { promptTokens: number; outputTokens: number; totalTokens: number } }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not configured in server environment. Add it to Secrets/.env, or switch engine preset to Free Local Engine ($0) or Claude Web Handoff.'
    );
  }
  const model = params.model?.trim() || ANTHROPIC_DEFAULT_MODEL;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1800,
      system: `${params.systemInstruction}\n\nRespond ONLY with a valid JSON object matching the requested fields.`,
      messages: [{ role: 'user', content: params.userPrompt }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const errMsg =
      (data?.error as { message?: string } | undefined)?.message ||
      `Anthropic API error (${res.status})`;
    throw new Error(`${res.status}: ${errMsg}`);
  }
  const contentArr = Array.isArray(data.content) ? data.content : [];
  const textBlock = contentArr.find(
    (b): b is { type?: string; text?: string } => typeof b === 'object' && b !== null
  );
  const usageRaw = (data.usage || {}) as { input_tokens?: number; output_tokens?: number };
  const promptTokens = Number(usageRaw.input_tokens || 0);
  const outputTokens = Number(usageRaw.output_tokens || 0);
  return {
    text: String(textBlock?.text || ''),
    usage: {
      promptTokens,
      outputTokens,
      totalTokens: promptTokens + outputTokens,
    },
  };
}

async function callCustomEndpointJson(params: {
  endpointUrl?: string;
  model?: string;
  systemInstruction: string;
  userPrompt: string;
}): Promise<{ text: string; usage: { promptTokens: number; outputTokens: number; totalTokens: number } }> {
  const rawUrl =
    params.endpointUrl?.trim() ||
    process.env.CUSTOM_AI_BASE_URL ||
    process.env.OLLAMA_BASE_URL ||
    'http://localhost:11434/v1/chat/completions';
  const url = validateCustomEndpointUrl(rawUrl);
  const model = params.model?.trim() || process.env.CUSTOM_AI_MODEL || CUSTOM_DEFAULT_MODEL;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.CUSTOM_AI_API_KEY) {
    headers.Authorization = `Bearer ${process.env.CUSTOM_AI_API_KEY}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: `${params.systemInstruction}\n\nRespond ONLY with valid JSON.`,
        },
        { role: 'user', content: params.userPrompt },
      ],
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(45000),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const errMsg =
      (data?.error as { message?: string } | undefined)?.message ||
      `Custom endpoint error (${res.status})`;
    throw new Error(`${res.status}: ${errMsg}`);
  }
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0] as { message?: { content?: string } } | undefined;
  const usageRaw = (data.usage || {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  const promptTokens = Number(usageRaw.prompt_tokens || 0);
  const outputTokens = Number(usageRaw.completion_tokens || 0);
  return {
    text: String(first?.message?.content || ''),
    usage: {
      promptTokens,
      outputTokens,
      totalTokens: Number(usageRaw.total_tokens || promptTokens + outputTokens),
    },
  };
}

function inspectAsinAndMetadata(
  rawAsin: unknown,
  rawTitle: unknown,
  rawDescription: unknown
) {
  const asin = String(rawAsin || '')
    .toUpperCase()
    .trim();
  const title = String(rawTitle || '').trim();
  const description = String(rawDescription || '').trim();
  const isStandardAsin = /^[A-Z0-9]{10}$/.test(asin);
  const isPlaceholderTitle =
    !title ||
    title.length < 4 ||
    /^Amazon\s+(Vine\s+)?(Item|Product)\s+[A-Z0-9]+$/i.test(title) ||
    title.toUpperCase() === asin;

  return {
    asin,
    isStandardAsin,
    isPlaceholderTitle,
    hasRichMetadata: !isPlaceholderTitle || description.length >= 25,
  };
}

function detectDeterministicConcerns(title: string, body: string): string[] {
  const combined = `${title}\n${body}`;
  const concerns: string[] = [];
  if (/\bamazon\s+vine\b|\bvine\s+voice\b|\bvine\s+program\b/i.test(combined)) {
    concerns.push('Avoid explicitly referencing the Amazon Vine program or Vine Voice status.');
  }
  if (/\bgot\s+(this|it)\s+for\s+free\b|\bfree\s+in\s+exchange\b|\bcomplimentary\s+sample\b/i.test(combined)) {
    concerns.push('Remove wording about receiving the item free or discounted.');
  }
  if (/https?:\/\/|www\.[^\s]+/i.test(combined)) {
    concerns.push('External URLs/links are not permitted in Amazon product reviews.');
  }
  if (/\b(shipping\s+box|delivery\s+driver|arrived\s+late|ups|fedex|usps|amazon\s+warehouse|packaging\s+damaged)\b/i.test(combined)) {
    concerns.push('Focus on the product itself rather than seller fulfillment or carrier shipping.');
  }
  return concerns;
}

const STOP_WORDS = new Set([
  'with', 'that', 'this', 'from', 'your', 'have', 'for', 'and', 'the', 'are', 'was',
  'were', 'been', 'will', 'into', 'pack', 'item', 'amazon', 'vine', 'product', 'size',
  'inch', 'inches', 'year', 'brand', 'color', 'black', 'white', 'silver', 'blue', 'gray',
  'used', 'using', 'very', 'good', 'great', 'nice', 'well', 'more', 'most', 'only',
]);

function extractProductKeywords(text: string): string[] {
  const tokens = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w) && !/^[a-z0-9]{10}$/.test(w));
  return Array.from(new Set(tokens)).slice(0, 24);
}

// 100% Free / Zero-Token Local Heuristic Quality Inspector
function runLocalHeuristicQualityInspection(params: {
  title: string;
  body: string;
  rating: number;
  asin: string;
  productTitle: string;
  description: string;
  notes: string;
  recentOpeners: string[];
}) {
  const title = String(params.title || '').trim();
  const body = String(params.body || '').trim();
  const combined = `${title} ${body}`;
  const lowerBody = body.toLowerCase();
  const words = body.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const metaCheck = inspectAsinAndMetadata(params.asin, params.productTitle, params.description);

  const concerns = detectDeterministicConcerns(title, body);
  const strengths: string[] = [];
  const suggestions: Array<{ quote?: string; issue: string; question: string }> = [];

  // 1. ASIN & Product Match check
  const productKeywords = extractProductKeywords(`${params.productTitle} ${params.description}`);
  const matchedKeywords = productKeywords.filter((kw) => combined.toLowerCase().includes(kw));

  let matchStatus: 'matched' | 'mismatch' | 'insufficient_metadata' = 'matched';
  let matchReason = `Matched ${matchedKeywords.length} product keyword(s) against ASIN ${metaCheck.asin}.`;

  if (!metaCheck.isStandardAsin) {
    matchStatus = 'insufficient_metadata';
    matchReason = `ASIN "${metaCheck.asin || 'empty'}" is not a standard 10-character Amazon ASIN.`;
  } else if (metaCheck.isPlaceholderTitle && !metaCheck.hasRichMetadata) {
    matchStatus = 'insufficient_metadata';
    matchReason = 'Product title is a placeholder without listing details — enter the real product name to verify ASIN match.';
  } else if (productKeywords.length >= 3 && matchedKeywords.length === 0) {
    matchStatus = 'mismatch';
    matchReason = `Review draft mentions none of the product terms from "${params.productTitle.slice(0, 60)}" (possible ASIN/product mismatch).`;
    concerns.unshift(`ASIN / Product mismatch: ${matchReason}`);
  } else if (matchedKeywords.length >= 2) {
    strengths.push(`Directly references product attributes (${matchedKeywords.slice(0, 4).join(', ')}) matching ASIN ${metaCheck.asin}.`);
  }

  // 2. Originality & Human Experience check
  const aiClichés = [
    'game changer',
    'look no further',
    'in conclusion',
    'elevates my workflow',
    'testament to',
    'whether you are a beginner',
    'overall, this is a solid choice',
    'exceeded all my expectations',
  ];
  const hitClichés = aiClichés.filter((p) => lowerBody.includes(p));

  const humanMarkers = [
    /\b(i|my|we|our)\s+(used|tested|installed|set|mounted|plugged|wore|washed|tried|kept|noticed|measured|checked|picked)\b/i,
    /\b(setup|assembly|grip|weight|finish|texture|noise|fit|clearance|cable|hinge|battery|latch|button|heat|size|desk|base|swivel|wobble|rotation|ergonomics)\b/i,
    /\b((\d+|one|two|three|four|five|several|a\s+few)\s*(min|minute|minutes|hour|hours|day|days|week|weeks|month|months|inch|inches|mm|cm|ft|watt|watts|lb|lbs|oz)|daily|out\s+of\s+the\s+box)\b/i,
  ];
  const humanHits = humanMarkers.filter((re) => re.test(body)).length;
  const hasBalance = /\b(however|although|though|minor|drawback|downside|wish|con:|trade-off|slightly|a bit)\b/i.test(body);

  // Cross-batch repetition check
  const bodyPrefix = body.slice(0, 80).toLowerCase();
  const repeatedOpener = params.recentOpeners.some((prev) => {
    const prevSlice = prev.toLowerCase();
    return prevSlice.length > 20 && bodyPrefix.length > 20 && prevSlice.includes(bodyPrefix.slice(0, 32));
  });

  let originalityVerified = true;
  let originalityReason = 'Shows first-person hands-on observations and natural human cadence.';

  if (hitClichés.length > 0) {
    originalityVerified = false;
    originalityReason = `Contains generic AI phrasing ("${hitClichés[0]}"). Replace with specific lived-in details.`;
    suggestions.push({
      quote: hitClichés[0],
      issue: 'Generic template phrase detected.',
      question: 'What concrete moment from unboxing or daily use supports this point instead?',
    });
  } else if (repeatedOpener) {
    originalityVerified = false;
    originalityReason = 'Opening lines closely resemble another recent review in this session.';
    suggestions.push({
      quote: body.slice(0, 90),
      issue: 'Opening phrasing mirrors recent batch drafts.',
      question: 'Can you start directly with your specific use case or first hands-on observation?',
    });
  } else if (humanHits < 2 || wordCount < 55) {
    originalityVerified = false;
    originalityReason = 'Needs more concrete hands-on testing context (setup, materials, measurements, or duration).';
    suggestions.push({
      issue: 'Limited sensory or practical usage detail.',
      question: 'How long did you use it, how did it fit/perform in practice, and what stood out physically?',
    });
  } else {
    strengths.push('Includes concrete hands-on usage and physical/practical product observations.');
  }

  if (hasBalance) {
    strengths.push('Balances pros with candid observations or practical trade-offs.');
  } else if (params.rating <= 4) {
    suggestions.push({
      issue: `Rating is ${params.rating}/5 without clearly explaining a trade-off or limitation.`,
      question: 'What kept this from being a full 5/5 for your setup?',
    });
  }

  if (wordCount >= 80 && wordCount <= 400) {
    strengths.push(`Well-paced length (${wordCount} words) suited for shoppers scanning Vine reviews.`);
  } else if (wordCount < 55) {
    suggestions.push({
      issue: `Review is quite brief (${wordCount} words).`,
      question: 'Adding 1-2 sentences on build quality and who this fits best will boost helpfulness.',
    });
  }

  let band: 'needs_detail' | 'good' | 'strong' = 'strong';
  if (concerns.length > 0 || matchStatus === 'mismatch' || wordCount < 45) {
    band = 'needs_detail';
  } else if (!originalityVerified || matchStatus === 'insufficient_metadata' || suggestions.length > 0) {
    band = wordCount < 65 && !originalityVerified ? 'needs_detail' : 'good';
  }

  const summary =
    band === 'strong'
      ? `Free Local Inspector verified ASIN match, authentic human specificity (${wordCount} words), and zero guideline concerns.`
      : band === 'good'
        ? `Solid compliant draft (${wordCount} words). Addressing the highlighted detail or metadata note will bring it to Strong.`
        : `Draft needs stronger specificity or resolution of flagged ASIN/guideline concerns before caching as Strong.`;

  return {
    band,
    summary,
    asinProductMatch: { status: matchStatus, reason: matchReason },
    originality: { verified: originalityVerified, reason: originalityReason },
    strengths: strengths.slice(0, 6),
    suggestions: suggestions.slice(0, 6),
    concerns: Array.from(new Set(concerns)).slice(0, 6),
    usage: { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
    providerUsed: 'free_local',
  };
}

// 100% Free / Zero-Token Local Draft Synthesizer
function runLocalReviewSynthesizer(params: {
  asin: string;
  productTitle: string;
  productDescription: string;
  rating: number;
  liked: string;
  disliked: string;
  usage: string;
  notes: string;
  recommend: string;
  tone: string;
  length: string;
  recentOpeners: string[];
}) {
  const cleanTitle = deDash(params.productTitle || `Product ${params.asin}`).trim();
  const shortProduct = cleanTitle.split(/[-–|,]/)[0].trim().slice(0, 75) || cleanTitle.slice(0, 75);
  const rating = Math.max(1, Math.min(5, Number(params.rating || 5)));

  const openers = [
    `I picked up the ${shortProduct} to put into regular rotation`,
    `After spending time testing the ${shortProduct} in daily use`,
    `Using the ${shortProduct} over the past several sessions`,
    `Setting up the ${shortProduct} was straightforward right out of the box`,
  ];
  const openerIdx =
    (params.asin.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) +
      params.recentOpeners.length) %
    openers.length;

  const headlinePool =
    rating >= 4
      ? [
          `Practical ${shortProduct.slice(0, 42)} with dependable daily performance`,
          `Solid build and useful everyday features (${rating}/5)`,
          `Works reliably for ${params.usage ? params.usage.slice(0, 35) : 'everyday setup'}`,
        ]
      : rating === 3
        ? [
            `Mixed results on the ${shortProduct.slice(0, 40)} - decent basics, notable trade-offs`,
            `Functional ${shortProduct.slice(0, 42)} with room to improve`,
          ]
        : [
            `Fell short in real-world use (${rating}/5)`,
            `Worth checking limitations before ordering`,
          ];

  const headline = deDash(headlinePool[openerIdx % headlinePool.length]).slice(0, 88);

  const paragraphs: string[] = [];
  const usageClause = params.usage.trim()
    ? `, specifically for ${deDash(params.usage.trim())}`
    : ' across routine everyday testing';
  const descSnippet = params.productDescription.trim()
    ? ` Looking closely at the design (${deDash(params.productDescription.trim().slice(0, 140))}), the overall construction matches what is described on the listing.`
    : '';

  paragraphs.push(`${openers[openerIdx]}${usageClause}.${descSnippet}`);

  if (params.liked.trim()) {
    paragraphs.push(
      `What stood out most in hands-on use: ${deDash(params.liked.trim())}. In day-to-day handling, those details make a noticeable difference compared to flimsier alternatives.`
    );
  } else {
    paragraphs.push(
      `Build quality, finish, and ergonomics feel consistent with a ${rating}-star product, and controls/fit behaved predictably without unnecessary fuss.`
    );
  }

  if (params.disliked.trim()) {
    paragraphs.push(
      `On the flip side, one honest trade-off to note is ${deDash(params.disliked.trim())}. It is not necessarily a dealbreaker depending on your setup, though it is worth factoring in.`
    );
  } else if (rating < 5) {
    paragraphs.push(
      `While the core function works well, minor polish and tolerance details keep it slightly shy of a full 5-star mark.`
    );
  }

  const extraParts: string[] = [];
  if (params.notes.trim()) extraParts.push(deDash(params.notes.trim()));
  if (params.recommend === 'yes') {
    extraParts.push('Overall, it delivers dependable value for shoppers looking specifically for this category.');
  } else if (params.recommend === 'no') {
    extraParts.push('Given the trade-offs encountered during testing, I would weigh alternatives before committing.');
  }
  if (extraParts.length > 0 && params.length !== 'short') {
    paragraphs.push(extraParts.join(' '));
  }

  return {
    title: headline,
    body: deDash(paragraphs.join('\n\n')),
    rating,
    usage: { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
    providerUsed: 'free_local',
  };
}

function runLocalReviewRefiner(params: {
  title: string;
  body: string;
  rating: number;
  productTitle: string;
  productDescription: string;
  liked: string;
  disliked: string;
  usage: string;
  notes: string;
  suggestions?: Array<{ issue?: string; question?: string }>;
}) {
  const shortProduct = deDash(params.productTitle || 'this product')
    .split(/[-–|,]/)[0]
    .trim()
    .slice(0, 64);
  let cleanTitle = deDash(params.title || '').trim();
  let cleanBody = deDash(params.body || '').trim();

  // Strip Vine/free/URL/cliche phrasing
  cleanBody = cleanBody
    .replace(/\b(amazon\s+vine|vine\s+voice|got\s+this\s+for\s+free|free\s+in\s+exchange)\b/gi, 'this item')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b(game changer|look no further|in conclusion|elevates my workflow)\b/gi, 'noticeably helpful')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (shortProduct && !cleanTitle.toLowerCase().includes(shortProduct.toLowerCase().slice(0, 14))) {
    cleanTitle = `${cleanTitle.slice(0, 56)} - ${shortProduct.slice(0, 28)}`.slice(0, 88);
  }

  const additions: string[] = [];
  if (params.usage.trim() && !cleanBody.toLowerCase().includes(params.usage.trim().slice(0, 18).toLowerCase())) {
    additions.push(`In day-to-day testing (${deDash(params.usage.trim())}), setup and handling stayed consistent with expectations.`);
  }
  if (params.liked.trim() && !cleanBody.toLowerCase().includes(params.liked.trim().slice(0, 18).toLowerCase())) {
    additions.push(`Standout detail in practice: ${deDash(params.liked.trim())}.`);
  }
  if (params.disliked.trim() && !cleanBody.toLowerCase().includes(params.disliked.trim().slice(0, 18).toLowerCase())) {
    additions.push(`One honest trade-off worth noting: ${deDash(params.disliked.trim())}.`);
  }
  if (params.notes.trim() && !cleanBody.toLowerCase().includes(params.notes.trim().slice(0, 18).toLowerCase())) {
    additions.push(deDash(params.notes.trim()));
  }

  if (additions.length === 0 && cleanBody === deDash(params.body || '').trim()) {
    const descHint = deDash(params.productDescription || '').trim().slice(0, 110);
    additions.push(
      descHint
        ? `Comparing hands-on performance with the listing specs for ${shortProduct} (${descHint}), fit, finish, and usability aligned closely in regular use.`
        : `Overall for ${shortProduct}, hands-on build quality and everyday reliability held up well across repeated use.`
    );
  }

  if (additions.length > 0) {
    cleanBody = `${cleanBody}\n\n${additions.join(' ')}`;
  }

  return {
    title: cleanTitle,
    body: deDash(cleanBody),
    rating: params.rating,
    usage: { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
    providerUsed: 'free_local',
  };
}

interface BridgeIncomingItem {
  id: string;
  asin: string;
  productTitle: string;
  productDescription?: string;
  productImage?: string;
  reviewUrl?: string;
  reviewLink?: string;
  unavailableReason?: string;
  amazonStatusText?: string;
  amazonQualityText?: string;
  orderDateText?: string;
  bucket?: 'queued' | 'interaction_required' | 'submitted' | 'completed';
  marketplace?: string;
  batchId?: string;
  source?: 'amazon_detection' | 'amazon_pagination' | 'batch_import';
  createdAt: number;
}

interface BridgeSubmissionEvent {
  asin: string;
  title?: string;
  body?: string;
  rating?: number;
  evidence?: string;
  timestamp: number;
}

const bridgeQueues = new Map<string, BridgeIncomingItem[]>();
const bridgeSubmissions = new Map<string, BridgeSubmissionEvent[]>();
interface BridgeStagedDraft {
  id: string;
  asin: string;
  productTitle: string;
  rating: number;
  draftTitle: string;
  draftBody: string;
  reviewUrl: string;
  marketplace: string;
  status: string;
  updatedAt: number;
}
const bridgeStagedDrafts = new Map<string, BridgeStagedDraft[]>();

function isValidBridgeKey(key: string): boolean {
  return /^[a-zA-Z0-9_-]{8,96}$/.test(key);
}

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '15mb' }));

  app.use('/api/bridge', (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // 0. Health & Configured Providers (zero token cost)
  app.get('/api/ai/health', (_req, res) => {
    const providers = {
      free_local: true,
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      custom_endpoint: Boolean(process.env.CUSTOM_AI_BASE_URL || process.env.OLLAMA_BASE_URL),
    };
    res.json({
      ok: true,
      configured: true,
      providers,
      model: GEMINI_MODEL_NAME,
      activeCalls: activeAiCalls,
      queuedCalls: aiWaitQueue.length,
      maxConcurrent: MAX_CONCURRENT_AI,
    });
  });

  // 0b. System Prompts Transparency Endpoint
  app.get('/api/ai/prompts', (_req, res) => {
    res.json({
      originalExtensionPrompt: ORIGINAL_EXTENSION_HANDOFF_TEMPLATE,
      originalExtensionNote: ORIGINAL_EXTENSION_ARCHITECTURE_NOTE,
      defaultGenerationPrompt: DEFAULT_GENERATION_SYSTEM_PROMPT,
      lockedQualityPrompt: LOCKED_QUALITY_INSPECTION_PROMPT,
      defaultRefinePrompt: DEFAULT_REFINE_SYSTEM_PROMPT,
      personaDistillPrompt: DEFAULT_PERSONA_DISTILL_PROMPT,
    });
  });

  // 1. AI Review Generation
  app.post('/api/ai/review/generate', async (req, res) => {
    try {
      const {
        product,
        context,
        images,
        batchMode,
        recentOpeners,
        learnedVoice,
        provider = 'gemini',
        model,
        endpointUrl,
      } = req.body || {};
      if (!product?.title && !product?.description) {
        res.status(400).json({ error: 'Product title or description is required.' });
        return;
      }
      const rating = Number(context?.rating || 0);
      if (rating < 1 || rating > 5) {
        res.status(400).json({ error: 'Rating must be between 1 and 5.' });
        return;
      }

      const metaCheck = inspectAsinAndMetadata(
        product?.asin,
        product?.title,
        product?.description
      );
      const recentList = Array.isArray(recentOpeners)
        ? recentOpeners.slice(-8).map((s) => String(s).slice(0, 140)).filter(Boolean)
        : [];

      if (provider === 'free_local') {
        const synthesized = runLocalReviewSynthesizer({
          asin: metaCheck.asin,
          productTitle: String(product?.title || ''),
          productDescription: String(product?.description || ''),
          rating,
          liked: String(context?.liked || ''),
          disliked: String(context?.disliked || ''),
          usage: String(context?.usage || ''),
          notes: String(context?.notes || ''),
          recommend: String(context?.recommend || 'unset'),
          tone: String(context?.tone || 'balanced'),
          length: String(context?.length || 'medium'),
          recentOpeners: recentList,
        });
        res.json({
          review: {
            title: synthesized.title,
            body: synthesized.body,
            rating,
          },
          usage: synthesized.usage,
          providerUsed: 'free_local',
        });
        return;
      }

      const descLimit = batchMode ? 1500 : 3500;
      const lengthGuidance =
        context?.length === 'short'
          ? 'Keep the review concise (95 to 145 words, 1-2 tight paragraphs).'
          : context?.length === 'long'
            ? 'Write a thorough, detailed review (240 to 360 words across clear paragraphs).'
            : 'Write a well-paced medium review (150 to 230 words across 2-3 readable paragraphs).';

      const toneGuidance =
        context?.tone === 'enthusiastic'
          ? 'Tone: upbeat and genuinely pleased, grounded in concrete product observations.'
          : context?.tone === 'critical'
            ? 'Tone: candid, analytical, and matter-of-fact - highlight trade-offs clearly.'
            : context?.tone === 'concise'
              ? 'Tone: direct, practical, zero-fluff.'
              : 'Tone: balanced, trustworthy, conversational everyday reviewer voice.';

      const recommendLine =
        context?.recommend === 'yes'
          ? 'Reviewer recommends this product.'
          : context?.recommend === 'no'
            ? 'Reviewer does not recommend this product.'
            : 'Convey recommendation naturally via rating and details.';

      const antiRepetitionBlock = recentList.length
        ? `\n7. Originality & variety: Do NOT reuse opening hooks, sentence templates, or phrasing from these recent reviews in the batch:\n- ${recentList.join('\n- ')}`
        : '';

      const learnedVoiceBlock = buildLearnedVoiceBlock(learnedVoice);
      const systemInstruction = `${DEFAULT_GENERATION_SYSTEM_PROMPT}
Style & pacing: ${toneGuidance} ${lengthGuidance} ${recommendLine}${context?.instructions ? `\nCustom User Rules: ${String(context.instructions).slice(0, 1200)}` : ''}${learnedVoiceBlock}${antiRepetitionBlock}`;

      const userPrompt = `My experience:
- Star rating: ${rating}/5
- What I liked: ${String(context?.liked || '—').slice(0, 800)}
- What I didn't like: ${String(context?.disliked || '—').slice(0, 800)}
- How I used it: ${String(context?.usage || '—').slice(0, 800)}
- Extra notes: ${String(context?.notes || '—').slice(0, 1200)}

Product:
- Title: ${String(product.title || '').slice(0, 400)}
- ASIN: ${metaCheck.asin || 'N/A'}
- Listing details: ${String(product.description || 'Not provided').slice(0, descLimit)}

Return JSON: {"title": string, "body": string}`;

      let rawText = '';
      let usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };

      if (provider === 'anthropic') {
        const result = await callWithBackoff(() =>
          callAnthropicJson({ model, systemInstruction, userPrompt })
        );
        rawText = result.text;
        usage = result.usage;
      } else if (provider === 'custom_endpoint') {
        const result = await callWithBackoff(() =>
          callCustomEndpointJson({ endpointUrl, model, systemInstruction, userPrompt })
        );
        rawText = result.text;
        usage = result.usage;
      } else {
        const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
        if (!batchMode && Array.isArray(images)) {
          for (const img of images.slice(0, 4)) {
            if (img?.data && typeof img.data === 'string') {
              parts.push({
                inlineData: {
                  mimeType: img.mime || 'image/jpeg',
                  data: img.data,
                },
              });
            }
          }
        }
        parts.push({ text: userPrompt });

        const ai = getGeminiClient();
        const response = await callWithBackoff(() =>
          ai.models.generateContent({
            model: GEMINI_MODEL_NAME,
            contents: { parts },
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: 'Short natural review headline (max 90 chars).' },
                  body: { type: Type.STRING, description: 'Full guideline-compliant, human-sounding review body.' },
                },
                required: ['title', 'body'],
              },
            },
          })
        );
        rawText = response.text || '';
        usage = extractGeminiUsage(response);
      }

      const parsed = safeParseJson<{ title?: string; body?: string }>(rawText, {});
      if (!parsed.title && !parsed.body) {
        throw new Error('AI returned an empty review payload.');
      }

      res.json({
        review: {
          title: deDash(parsed.title || '').trim(),
          body: deDash(parsed.body || '').trim(),
          rating,
        },
        usage,
        providerUsed: provider,
      });
    } catch (err) {
      const status = parseHttpStatus(err);
      const message = err instanceof Error ? err.message : String(err);
      console.error('Review generation error:', message);
      res.status(status).json({ error: message, code: status === 429 ? 'RATE_LIMIT' : 'AI_ERROR' });
    }
  });

  // 2. AI Quality Inspection Tool (Locked Prompt unless Advanced Override enabled)
  app.post('/api/ai/review/quality', async (req, res) => {
    try {
      const {
        title,
        body,
        rating,
        asin,
        product_title,
        description,
        notes,
        batchMode,
        recentOpeners,
        provider = 'gemini',
        model,
        endpointUrl,
        overrideEnabled = false,
        systemPromptOverride,
      } = req.body || {};

      if (!String(title || '').trim() || !String(body || '').trim() || Number(rating) < 1) {
        res.status(400).json({ error: 'Title, body, and rating (1-5) are required for quality inspection.' });
        return;
      }

      const metaCheck = inspectAsinAndMetadata(asin, product_title, description);
      const recentList = Array.isArray(recentOpeners)
        ? recentOpeners.slice(-8).map((s) => String(s).slice(0, 140)).filter(Boolean)
        : [];

      if (provider === 'free_local') {
        const result = runLocalHeuristicQualityInspection({
          title: String(title),
          body: String(body),
          rating: Number(rating),
          asin: metaCheck.asin,
          productTitle: String(product_title || ''),
          description: String(description || ''),
          notes: String(notes || ''),
          recentOpeners: recentList,
        });
        res.json(result);
        return;
      }

      // Locked quality inspection system prompt unless explicitly unlocked & customized via Advanced Menu
      const effectivePrompt =
        overrideEnabled === true && String(systemPromptOverride || '').trim()
          ? String(systemPromptOverride).trim().slice(0, 6000)
          : LOCKED_QUALITY_INSPECTION_PROMPT;

      const systemInstruction = `${effectivePrompt}${
        recentList.length
          ? `\n\nCheck that the draft does not repeat opening patterns from these recent batch items:\n- ${recentList.join('\n- ')}`
          : ''
      }`;

      const descLimit = batchMode ? 1000 : 2500;
      const prompt = `ASIN: ${metaCheck.asin || 'N/A'} (Standard 10-char ASIN: ${metaCheck.isStandardAsin ? 'yes' : 'no'})
Product Title: ${String(product_title || 'Unknown').slice(0, 400)}
Listing Details: ${String(description || 'N/A').slice(0, descLimit)}
Reviewer Notes: ${String(notes || 'None').slice(0, 1000)}
Star Rating: ${rating}/5
Draft Headline: ${String(title).slice(0, 400)}
Draft Body:
${String(body).slice(0, 8000)}

Return JSON matching: {"band": "needs_detail"|"good"|"strong", "summary": string, "asinProductMatch": {"status": "matched"|"mismatch"|"insufficient_metadata", "reason": string}, "originality": {"verified": boolean, "reason": string}, "strengths": string[], "suggestions": [{"quote"?: string, "issue": string, "question": string}], "concerns": string[]}`;

      let rawText = '';
      let usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };

      if (provider === 'anthropic') {
        const result = await callWithBackoff(() =>
          callAnthropicJson({ model, systemInstruction, userPrompt: prompt })
        );
        rawText = result.text;
        usage = result.usage;
      } else if (provider === 'custom_endpoint') {
        const result = await callWithBackoff(() =>
          callCustomEndpointJson({ endpointUrl, model, systemInstruction, userPrompt: prompt })
        );
        rawText = result.text;
        usage = result.usage;
      } else {
        const ai = getGeminiClient();
        const response = await callWithBackoff(() =>
          ai.models.generateContent({
            model: GEMINI_MODEL_NAME,
            contents: prompt,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  band: {
                    type: Type.STRING,
                    enum: ['needs_detail', 'good', 'strong'],
                  },
                  summary: { type: Type.STRING },
                  asinProductMatch: {
                    type: Type.OBJECT,
                    properties: {
                      status: {
                        type: Type.STRING,
                        enum: ['matched', 'mismatch', 'insufficient_metadata'],
                      },
                      reason: { type: Type.STRING },
                    },
                    required: ['status', 'reason'],
                  },
                  originality: {
                    type: Type.OBJECT,
                    properties: {
                      verified: { type: Type.BOOLEAN },
                      reason: { type: Type.STRING },
                    },
                    required: ['verified', 'reason'],
                  },
                  strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                  suggestions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        quote: { type: Type.STRING },
                        issue: { type: Type.STRING },
                        question: { type: Type.STRING },
                      },
                      required: ['issue', 'question'],
                    },
                  },
                  concerns: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: [
                  'band',
                  'summary',
                  'asinProductMatch',
                  'originality',
                  'strengths',
                  'suggestions',
                  'concerns',
                ],
              },
            },
          })
        );
        rawText = response.text || '';
        usage = extractGeminiUsage(response);
      }

      interface RawQualityResponse {
        band?: string;
        summary?: string;
        asinProductMatch?: { status?: string; reason?: string };
        originality?: { verified?: boolean; reason?: string };
        strengths?: unknown[];
        suggestions?: Array<Record<string, unknown>>;
        concerns?: unknown[];
      }

      const parsed = safeParseJson<RawQualityResponse>(rawText, {});

      let band: 'needs_detail' | 'good' | 'strong' =
        parsed.band === 'needs_detail' || parsed.band === 'good' || parsed.band === 'strong'
          ? parsed.band
          : 'good';

      let matchStatus: 'matched' | 'mismatch' | 'insufficient_metadata' =
        parsed.asinProductMatch?.status === 'matched' ||
        parsed.asinProductMatch?.status === 'mismatch' ||
        parsed.asinProductMatch?.status === 'insufficient_metadata'
          ? parsed.asinProductMatch.status
          : metaCheck.hasRichMetadata
            ? 'matched'
            : 'insufficient_metadata';

      let matchReason = String(
        parsed.asinProductMatch?.reason ||
          (matchStatus === 'matched'
            ? `Review aligns with ASIN ${metaCheck.asin} and product details.`
            : 'Insufficient product title/details to confirm ASIN match.')
      ).slice(0, 400);

      if (!metaCheck.isStandardAsin) {
        matchStatus = 'insufficient_metadata';
        matchReason = `ASIN "${metaCheck.asin || 'empty'}" is not a standard 10-character Amazon ASIN.`;
      } else if (metaCheck.isPlaceholderTitle && !metaCheck.hasRichMetadata && matchStatus === 'matched') {
        matchStatus = 'insufficient_metadata';
        matchReason = 'Product title is a generic placeholder and listing details are empty — supply the real product title to verify ASIN match.';
      }

      const originalityVerified =
        typeof parsed.originality?.verified === 'boolean' ? parsed.originality.verified : band !== 'needs_detail';
      const originalityReason = String(
        parsed.originality?.reason ||
          (originalityVerified
            ? 'Reads as an original, hands-on reviewer account.'
            : 'Draft sounds generic or lacks specific hands-on usage details.')
      ).slice(0, 400);

      const concerns = [
        ...detectDeterministicConcerns(String(title), String(body)),
        ...(Array.isArray(parsed.concerns) ? parsed.concerns.map((c) => String(c).slice(0, 400)) : []),
      ];

      if (matchStatus === 'mismatch') {
        band = 'needs_detail';
        if (!concerns.some((c) => /asin|mismatch|product/i.test(c))) {
          concerns.unshift(`ASIN / Product mismatch: ${matchReason}`);
        }
      } else if (matchStatus === 'insufficient_metadata' && band === 'strong') {
        band = 'good';
        if (!concerns.some((c) => /asin|metadata|placeholder/i.test(c))) {
          concerns.push(`ASIN verification incomplete: ${matchReason}`);
        }
      }

      if (!originalityVerified && band === 'strong') {
        band = 'good';
      }
      if (concerns.length > 0 && band === 'strong') {
        band = 'needs_detail';
      }

      res.json({
        band,
        summary: String(parsed.summary || ''),
        asinProductMatch: {
          status: matchStatus,
          reason: matchReason,
        },
        originality: {
          verified: originalityVerified,
          reason: originalityReason,
        },
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 6).map(String) : [],
        suggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions.slice(0, 6).map((s: Record<string, unknown>) => ({
              ...(s.quote ? { quote: String(s.quote).slice(0, 400) } : {}),
              issue: String(s.issue || '').slice(0, 400),
              question: String(s.question || '').slice(0, 400),
            }))
          : [],
        concerns: Array.from(new Set(concerns)).slice(0, 6),
        usage,
        providerUsed: provider,
      });
    } catch (err) {
      const status = parseHttpStatus(err);
      const message = err instanceof Error ? err.message : String(err);
      console.error('Review quality check error:', message);
      res.status(status).json({ error: message, code: status === 429 ? 'RATE_LIMIT' : 'AI_ERROR' });
    }
  });

  // 3. AI Review Refiner
  app.post('/api/ai/review/refine', async (req, res) => {
    try {
      const {
        product,
        context,
        draft,
        assessment,
        recentOpeners,
        learnedVoice,
        provider = 'gemini',
        model,
        endpointUrl,
      } = req.body || {};

      if (!draft?.title || !draft?.body) {
        res.status(400).json({ error: 'Existing draft title and body are required to refine.' });
        return;
      }

      if (provider === 'free_local') {
        const refined = runLocalReviewRefiner({
          title: String(draft.title),
          body: String(draft.body),
          rating: Number(context?.rating || 5),
          productTitle: String(product?.title || ''),
          productDescription: String(product?.description || ''),
          liked: String(context?.liked || ''),
          disliked: String(context?.disliked || ''),
          usage: String(context?.usage || ''),
          notes: String(context?.notes || ''),
          suggestions: Array.isArray(assessment?.suggestions) ? assessment.suggestions : [],
        });
        res.json({
          review: {
            title: refined.title,
            body: refined.body,
            rating: refined.rating,
          },
          usage: refined.usage,
          providerUsed: 'free_local',
        });
        return;
      }

      const recentList = Array.isArray(recentOpeners)
        ? recentOpeners.slice(-8).map((s) => String(s).slice(0, 140)).filter(Boolean)
        : [];
      const antiRepetition = recentList.length
        ? ` Avoid echoing phrases or openings from: ${recentList.join(' | ')}.`
        : '';

      const learnedVoiceBlock = buildLearnedVoiceBlock(learnedVoice);
      const systemInstruction = `${DEFAULT_REFINE_SYSTEM_PROMPT}${learnedVoiceBlock}${antiRepetition}`;
      const prompt = `Product: ${String(product?.title || '').slice(0, 400)} (ASIN: ${String(product?.asin || '')})
Listing Details: ${String(product?.description || 'Not provided').slice(0, 2000)}
Star Rating: ${Number(context?.rating || 5)}/5
Reviewer Experience: Liked=${String(context?.liked || '')} | Disliked=${String(context?.disliked || '')} | Usage=${String(context?.usage || '')} | Extra=${String(context?.notes || '')}
Current Quality Band: ${String(assessment?.band || 'unknown')}
Draft Headline: ${String(draft.title).slice(0, 400)}
Draft Body:
${String(draft.body).slice(0, 8000)}
ASIN Match Check: ${JSON.stringify(assessment?.asinProductMatch || {})}
Originality Check: ${JSON.stringify(assessment?.originality || {})}
Quality Suggestions to Fix: ${JSON.stringify(assessment?.suggestions || []).slice(0, 2000)}
Guideline Concerns to Fix: ${JSON.stringify(assessment?.concerns || []).slice(0, 1000)}

Rewrite the headline and body completely to address every suggestion and concern so it achieves a "strong" Vine quality score. Return JSON: {"title": string, "body": string}`;

      let rawText = '';
      let usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };

      if (provider === 'anthropic') {
        const result = await callWithBackoff(() =>
          callAnthropicJson({ model, systemInstruction, userPrompt: prompt })
        );
        rawText = result.text;
        usage = result.usage;
      } else if (provider === 'custom_endpoint') {
        const result = await callWithBackoff(() =>
          callCustomEndpointJson({ endpointUrl, model, systemInstruction, userPrompt: prompt })
        );
        rawText = result.text;
        usage = result.usage;
      } else {
        const ai = getGeminiClient();
        const response = await callWithBackoff(() =>
          ai.models.generateContent({
            model: GEMINI_MODEL_NAME,
            contents: prompt,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  body: { type: Type.STRING },
                },
                required: ['title', 'body'],
              },
            },
          })
        );
        rawText = response.text || '';
        usage = extractGeminiUsage(response);
      }

      const parsed = safeParseJson<{ title?: string; body?: string }>(rawText, {});
      const nextTitle = deDash(parsed.title || '').trim();
      const nextBody = deDash(parsed.body || '').trim();

      if (!nextBody) {
        throw new Error('AI refiner returned an empty rewrite. Please try again.');
      }

      res.json({
        review: {
          title: nextTitle || deDash(draft.title).trim(),
          body: nextBody,
          rating: Number(context?.rating || 5),
        },
        usage,
        providerUsed: provider,
      });
    } catch (err) {
      const status = parseHttpStatus(err);
      const message = err instanceof Error ? err.message : String(err);
      console.error('Review refine error:', message);
      res.status(status).json({ error: message, code: status === 429 ? 'RATE_LIMIT' : 'AI_ERROR' });
    }
  });

  // 3b. Learned Tone & Reviewer Persona Distillation (from past ordered items & reviews)
  app.post('/api/ai/persona/distill', async (req, res) => {
    try {
      const {
        reviews: sampleReviews = [],
        externalSamplesText = '',
        existingSummary = '',
        existingFacts = [],
        provider = 'gemini',
        model,
        endpointUrl,
      } = req.body || {};

      const samples = Array.isArray(sampleReviews) ? sampleReviews.slice(0, 40) : [];
      const pasted = String(externalSamplesText || '').trim().slice(0, 16000);

      if (samples.length === 0 && !pasted) {
        res.status(400).json({
          error:
            'No past ordered items or reviews found yet. Generate/save a few reviews, import from Firefox Companion, or paste past reviews below to distill your learned tone.',
        });
        return;
      }

      if (provider === 'free_local') {
        const titles = samples
          .map((s: Record<string, unknown>) => deDash(String(s?.productTitle || '')).trim())
          .filter(Boolean);
        const bodies = samples
          .map((s: Record<string, unknown>) => deDash(String(s?.body || s?.draftBody || '')).trim())
          .filter(Boolean);
        const avgWords =
          bodies.length > 0
            ? Math.round(
                bodies.reduce((sum, b) => sum + b.split(/\s+/).filter(Boolean).length, 0) /
                  bodies.length
              )
            : 150;
        const ratings = samples
          .map((s: Record<string, unknown>) => Number(s?.rating || 0))
          .filter((n) => n >= 1 && n <= 5);
        const avgRating =
          ratings.length > 0
            ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
            : '4.5';

        const facts: string[] = Array.isArray(existingFacts)
          ? existingFacts.map((f) => String(f || '').trim()).filter(Boolean)
          : [];
        if (titles.length > 0) {
          facts.unshift(
            `Ordered & reviewed ${titles.length} tracked product(s), including ${titles
              .slice(0, 3)
              .map((t) => t.split(/[-–|,]/)[0].trim().slice(0, 40))
              .join(', ')}`
          );
        }
        facts.push(`Typical review length averages ~${avgWords} words (avg rating ${avgRating}/5)`);

        const uniqueFacts = Array.from(new Set(facts)).slice(0, 16);
        const summary =
          deDash(String(existingSummary || '')).trim() ||
          `Writes practical, first-person reviews averaging around ${avgWords} words with an average ${avgRating}/5 rating, grounded in specific ordered items and everyday hands-on observations.`;

        res.json({
          toneSummary: summary,
          facts: uniqueFacts,
          reviewsUsed: samples.length + (pasted ? 1 : 0),
          usage: { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
          providerUsed: 'free_local',
        });
        return;
      }

      const formattedSamples = samples
        .map((s: Record<string, unknown>, idx: number) => {
          const title = String(s?.productTitle || 'Unknown Product').slice(0, 220);
          const asin = String(s?.asin || '').slice(0, 20);
          const orderDate = String(s?.orderDateText || '').slice(0, 60);
          const rating = Number(s?.rating || 0);
          const draftTitle = String(s?.draftTitle || s?.title || '').slice(0, 200);
          const draftBody = String(s?.draftBody || s?.body || '').slice(0, 1400);
          const notes = [s?.liked, s?.disliked, s?.usage, s?.notes]
            .map((x) => String(x || '').trim())
            .filter(Boolean)
            .join(' | ')
            .slice(0, 600);
          return `#${idx + 1} [${asin || 'NO-ASIN'}${orderDate ? ` · Ordered ${orderDate}` : ''}] ${title}${
            rating ? ` (${rating}/5)` : ''
          }${notes ? `\nNotes: ${notes}` : ''}${
            draftTitle || draftBody ? `\nReview: ${draftTitle}\n${draftBody}` : ''
          }`;
        })
        .join('\n\n');

      const prompt = `Distill the reviewer's authentic voice and personal context from these ordered items and past reviews:

${formattedSamples ? `=== STUDIO HISTORY & ORDERED ITEMS ===\n${formattedSamples}\n\n` : ''}${
        pasted ? `=== PAST REVIEWS / NOTES PROVIDED BY USER ===\n${pasted}\n\n` : ''
      }${
        existingSummary || (Array.isArray(existingFacts) && existingFacts.length)
          ? `=== PREVIOUS LEARNED PROFILE (refine/update, do not discard valid facts) ===\nSummary: ${String(existingSummary || '')}\nFacts: ${JSON.stringify(existingFacts)}\n\n`
          : ''
      }Return strictly JSON: {"toneSummary": string, "facts": string[]}`;

      let rawText = '';
      let usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };

      if (provider === 'anthropic') {
        const result = await callWithBackoff(() =>
          callAnthropicJson({
            model,
            systemInstruction: DEFAULT_PERSONA_DISTILL_PROMPT,
            userPrompt: prompt,
          })
        );
        rawText = result.text;
        usage = result.usage;
      } else if (provider === 'custom_endpoint') {
        const result = await callWithBackoff(() =>
          callCustomEndpointJson({
            endpointUrl,
            model,
            systemInstruction: DEFAULT_PERSONA_DISTILL_PROMPT,
            userPrompt: prompt,
          })
        );
        rawText = result.text;
        usage = result.usage;
      } else {
        const ai = getGeminiClient();
        const response = await callWithBackoff(() =>
          ai.models.generateContent({
            model: GEMINI_MODEL_NAME,
            contents: prompt,
            config: {
              systemInstruction: DEFAULT_PERSONA_DISTILL_PROMPT,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  toneSummary: { type: Type.STRING },
                  facts: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['toneSummary', 'facts'],
              },
            },
          })
        );
        rawText = response.text || '';
        usage = extractGeminiUsage(response);
      }

      const parsed = safeParseJson<{ toneSummary?: string; facts?: unknown[] }>(rawText, {});
      const toneSummary = deDash(String(parsed.toneSummary || '')).trim().slice(0, 3000);
      const facts = Array.isArray(parsed.facts)
        ? parsed.facts
            .map((f) => deDash(String(f || '')).trim().slice(0, 450))
            .filter(Boolean)
            .slice(0, 20)
        : [];

      if (!toneSummary && facts.length === 0) {
        throw new Error('Could not distill learned tone from the provided items/reviews.');
      }

      res.json({
        toneSummary,
        facts,
        reviewsUsed: samples.length + (pasted ? pasted.split(/\n{2,}/).filter(Boolean).length : 0),
        usage,
        providerUsed: provider,
      });
    } catch (err) {
      const status = parseHttpStatus(err);
      const message = err instanceof Error ? err.message : String(err);
      console.error('Persona distill error:', message);
      res.status(status).json({ error: message, code: status === 429 ? 'RATE_LIMIT' : 'AI_ERROR' });
    }
  });

  // 4. Bridge Ingest Endpoint (supports large chunked pagination syncs from amazon.com/vine/vine-reviews)
  app.post('/api/bridge/ingest', (req, res) => {
    const { bridgeKey, items } = req.body || {};
    if (!isValidBridgeKey(String(bridgeKey || ''))) {
      res.status(400).json({ error: 'Invalid bridgeKey.' });
      return;
    }
    if (!Array.isArray(items) || !items.length) {
      res.status(400).json({ error: 'At least one item is required.' });
      return;
    }

    const queue = bridgeQueues.get(bridgeKey) || [];
    const batchId = items.length > 1 ? `batch_${Date.now()}` : undefined;
    const added: BridgeIncomingItem[] = [];

    for (const raw of items.slice(0, 500)) {
      const asin = String(raw?.asin || '').toUpperCase().trim();
      if (!/^[A-Z0-9]{8,14}$/.test(asin)) continue;
      const bucket = ['queued', 'interaction_required', 'submitted', 'completed'].includes(
        String(raw?.bucket || '')
      )
        ? (raw.bucket as BridgeIncomingItem['bucket'])
        : 'queued';

      const source = ['amazon_detection', 'amazon_pagination', 'batch_import'].includes(
        String(raw?.source || '')
      )
        ? (raw.source as BridgeIncomingItem['source'])
        : items.length > 1
          ? 'batch_import'
          : 'amazon_detection';

      const entry: BridgeIncomingItem = {
        id: `br_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        asin,
        productTitle: String(raw?.title || raw?.productTitle || `Amazon Item ${asin}`).slice(0, 500),
        productDescription: String(raw?.description || raw?.productDescription || '').slice(0, 5000),
        productImage: String(raw?.image || raw?.productImage || '').slice(0, 1000),
        reviewUrl: String(raw?.reviewUrl || raw?.writeReviewUrl || '').slice(0, 1000),
        reviewLink: raw?.reviewLink ? String(raw.reviewLink).slice(0, 1000) : undefined,
        unavailableReason: raw?.unavailableReason ? String(raw.unavailableReason).slice(0, 500) : undefined,
        amazonStatusText: raw?.amazonStatusText ? String(raw.amazonStatusText).slice(0, 200) : undefined,
        amazonQualityText: raw?.amazonQualityText ? String(raw.amazonQualityText).slice(0, 200) : undefined,
        orderDateText: raw?.orderDateText ? String(raw.orderDateText).slice(0, 100) : undefined,
        bucket,
        marketplace: String(raw?.marketplace || 'amazon.com').slice(0, 64),
        ...(batchId ? { batchId } : {}),
        source,
        createdAt: Date.now(),
      };
      queue.push(entry);
      added.push(entry);
    }

    bridgeQueues.set(bridgeKey, queue.slice(-1500));
    res.json({ ok: true, accepted: added.length, batchId: batchId || null });
  });

  app.get('/api/bridge/pending', (req, res) => {
    const bridgeKey = String(req.query.bridgeKey || '');
    if (!isValidBridgeKey(bridgeKey)) {
      res.status(400).json({ error: 'Invalid bridgeKey.' });
      return;
    }
    const items = bridgeQueues.get(bridgeKey) || [];
    const submissions = bridgeSubmissions.get(bridgeKey) || [];
    if (req.query.drain === '1') {
      bridgeQueues.delete(bridgeKey);
      bridgeSubmissions.delete(bridgeKey);
    }
    res.json({ items, submissions });
  });

  app.post('/api/bridge/submitted', (req, res) => {
    const { bridgeKey, asin, title, body, rating, evidence } = req.body || {};
    if (!isValidBridgeKey(String(bridgeKey || ''))) {
      res.status(400).json({ error: 'Invalid bridgeKey.' });
      return;
    }
    const cleanAsin = String(asin || '').toUpperCase().trim();
    if (!/^[A-Z0-9]{8,14}$/.test(cleanAsin)) {
      res.status(400).json({ error: 'Invalid ASIN.' });
      return;
    }
    const list = bridgeSubmissions.get(bridgeKey) || [];
    list.push({
      asin: cleanAsin,
      title: title ? String(title).slice(0, 500) : undefined,
      body: body ? String(body).slice(0, 20000) : undefined,
      rating: Number.isFinite(Number(rating)) ? Number(rating) : undefined,
      evidence: evidence ? String(evidence).slice(0, 200) : 'companion_bridge',
      timestamp: Date.now(),
    });
    bridgeSubmissions.set(bridgeKey, list.slice(-100));
    res.json({ ok: true });
  });

  // Safe-Zone Staged Drafts for Firefox Clipboard Popup (zero Amazon touch)
  app.post('/api/bridge/staged', (req, res) => {
    const { bridgeKey, drafts } = req.body || {};
    if (!isValidBridgeKey(String(bridgeKey || ''))) {
      res.status(400).json({ error: 'Invalid bridgeKey.' });
      return;
    }
    const list: BridgeStagedDraft[] = Array.isArray(drafts)
      ? drafts.slice(0, 100).map((d: Record<string, unknown>) => {
          const asin = String(d?.asin || '').toUpperCase().trim();
          const marketplace = String(d?.marketplace || 'amazon.com').slice(0, 64);
          const rawUrl = String(d?.reviewUrl || '').split('#')[0];
          const cleanUrl = /^https?:\/\/[^/]*amazon\./i.test(rawUrl)
            ? rawUrl
            : `https://www.${marketplace}/review/create-review?encoding=UTF&asin=${encodeURIComponent(asin)}`;
          return {
            id: String(d?.id || asin).slice(0, 128),
            asin,
            productTitle: String(d?.productTitle || `Amazon Item ${asin}`).slice(0, 500),
            rating: Math.max(1, Math.min(5, Number(d?.rating || 5))),
            draftTitle: String(d?.draftTitle || '').slice(0, 500),
            draftBody: String(d?.draftBody || '').slice(0, 20000),
            reviewUrl: cleanUrl.slice(0, 1000),
            marketplace,
            status: String(d?.status || 'cached_strong').slice(0, 40),
            updatedAt: Date.now(),
          };
        })
      : [];
    bridgeStagedDrafts.set(bridgeKey, list);
    res.json({ ok: true, count: list.length });
  });

  app.get('/api/bridge/staged', (req, res) => {
    const bridgeKey = String(req.query.bridgeKey || '');
    if (!isValidBridgeKey(bridgeKey)) {
      res.status(400).json({ error: 'Invalid bridgeKey.' });
      return;
    }
    res.json({ drafts: bridgeStagedDrafts.get(bridgeKey) || [] });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VineCraft Studio server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
