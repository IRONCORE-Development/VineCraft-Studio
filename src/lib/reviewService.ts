import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  QualityAssessment,
  QualityBand,
  RecommendChoice,
  ReviewItem,
  ReviewLength,
  ReviewSource,
  ReviewStatus,
  ReviewTone,
  StagedPhoto,
  UserProfile,
} from '../types';
import { handleFirestoreError, OperationType } from './firestoreErrors';

export const DEFAULT_USER_PROFILE_FIELDS = {
  autoInspectOnGenerate: true,
  strongActionMode: 'cache_and_next' as const,
  justClickSubmitEnabled: false,
  autoRefineBelowStrong: false,
  defaultTone: 'balanced' as const,
  defaultLength: 'medium' as const,
  customInstructions: '',
  amazonMarketplace: 'amazon.com',
  maxBatchItems: 25,
  maxBatchTokens: 150000,
  batchDelayMs: 2000,
  aiEnginePreset: 'gemini' as const,
  advancedOverrideEnabled: false,
  generationModel: 'gemini-4-hydrogen',
  qualityModel: 'gemini-4-hydrogen',
  customEndpointUrl: '',
  qualitySystemPromptOverride: '',
  learnedToneEnabled: true,
  learnedToneSummary: '',
  learnedFacts: [] as string[],
  learnedReviewsUsed: 0,
  learnedToneOverrideEnabled: false,
};

export function makeSafeDocId(prefix = 'rev'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

export function normalizeAsin(input: string): string {
  const match = String(input || '')
    .toUpperCase()
    .match(/\b([A-Z0-9]{10})\b/);
  if (match) return match[1];
  return String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 14);
}

export async function ensureUserProfile(
  uid: string,
  email?: string | null,
  displayName?: string | null
): Promise<UserProfile> {
  const userRef = doc(db, 'users', uid);
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }
    const initial: Record<string, unknown> = {
      uid,
      ...(displayName ? { displayName: displayName.slice(0, 120) } : {}),
      ...(email ? { email: email.slice(0, 200) } : {}),
      ...DEFAULT_USER_PROFILE_FIELDS,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(userRef, initial);
    const created = await getDoc(userRef);
    return created.data() as UserProfile;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export function subscribeUserProfile(
  uid: string,
  onData: (profile: UserProfile) => void
): () => void {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        onData(snap.data() as UserProfile);
      }
    },
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );
}

export async function updateUserProfile(
  uid: string,
  patch: Partial<Omit<UserProfile, 'uid' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  try {
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (patch.displayName !== undefined) payload.displayName = patch.displayName.slice(0, 120);
    if (patch.email !== undefined) payload.email = patch.email.slice(0, 200);
    if (patch.autoInspectOnGenerate !== undefined)
      payload.autoInspectOnGenerate = patch.autoInspectOnGenerate;
    if (patch.strongActionMode !== undefined) payload.strongActionMode = patch.strongActionMode;
    if (patch.justClickSubmitEnabled !== undefined)
      payload.justClickSubmitEnabled = patch.justClickSubmitEnabled;
    if (patch.autoRefineBelowStrong !== undefined)
      payload.autoRefineBelowStrong = patch.autoRefineBelowStrong;
    if (patch.defaultTone !== undefined) payload.defaultTone = patch.defaultTone;
    if (patch.defaultLength !== undefined) payload.defaultLength = patch.defaultLength;
    if (patch.customInstructions !== undefined)
      payload.customInstructions = patch.customInstructions.slice(0, 4000);
    if (patch.amazonMarketplace !== undefined)
      payload.amazonMarketplace = patch.amazonMarketplace.slice(0, 64);
    if (patch.maxBatchItems !== undefined)
      payload.maxBatchItems = Math.max(1, Math.min(500, Math.round(patch.maxBatchItems)));
    if (patch.maxBatchTokens !== undefined)
      payload.maxBatchTokens = Math.max(5000, Math.min(5000000, Math.round(patch.maxBatchTokens)));
    if (patch.batchDelayMs !== undefined)
      payload.batchDelayMs = Math.max(0, Math.min(60000, Math.round(patch.batchDelayMs)));
    if (patch.aiEnginePreset !== undefined) payload.aiEnginePreset = patch.aiEnginePreset;
    if (patch.advancedOverrideEnabled !== undefined)
      payload.advancedOverrideEnabled = patch.advancedOverrideEnabled;
    if (patch.generationModel !== undefined)
      payload.generationModel = patch.generationModel.slice(0, 120);
    if (patch.qualityModel !== undefined)
      payload.qualityModel = patch.qualityModel.slice(0, 120);
    if (patch.customEndpointUrl !== undefined)
      payload.customEndpointUrl = patch.customEndpointUrl.slice(0, 500);
    if (patch.qualitySystemPromptOverride !== undefined)
      payload.qualitySystemPromptOverride = patch.qualitySystemPromptOverride.slice(0, 6000);
    if (patch.learnedToneEnabled !== undefined)
      payload.learnedToneEnabled = Boolean(patch.learnedToneEnabled);
    if (patch.learnedToneSummary !== undefined)
      payload.learnedToneSummary = patch.learnedToneSummary.slice(0, 3000);
    if (patch.learnedFacts !== undefined)
      payload.learnedFacts = patch.learnedFacts
        .map((f) => String(f || '').trim().slice(0, 500))
        .filter(Boolean)
        .slice(0, 30);
    if (patch.learnedReviewsUsed !== undefined)
      payload.learnedReviewsUsed = Math.max(0, Math.min(10000, Math.round(patch.learnedReviewsUsed)));
    if (patch.learnedToneOverrideEnabled !== undefined)
      payload.learnedToneOverrideEnabled = Boolean(patch.learnedToneOverrideEnabled);

    await updateDoc(ref, payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeUserReviews(
  uid: string,
  onData: (items: ReviewItem[]) => void
): () => void {
  const path = `users/${uid}/reviews`;
  const q = query(
    collection(db, 'users', uid, 'reviews'),
    where('ownerId', '==', uid),
    orderBy('updatedAt', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: ReviewItem[] = snap.docs.map((d) => ({
        ...(d.data() as Omit<ReviewItem, 'id'>),
        id: d.id,
      }));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export interface CreateReviewInput {
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
  status?: ReviewStatus;
  marketplace?: string;
  rating?: number;
  liked?: string;
  disliked?: string;
  usage?: string;
  notes?: string;
  recommend?: RecommendChoice;
  tone?: ReviewTone;
  length?: ReviewLength;
  batchId?: string;
  source?: ReviewSource;
}

export async function createReviewItem(uid: string, input: CreateReviewInput): Promise<string> {
  const id = makeSafeDocId('rev');
  const path = `users/${uid}/reviews/${id}`;
  const asin = normalizeAsin(input.asin);
  if (!/^[A-Z0-9]{8,14}$/.test(asin)) {
    throw new Error('ASIN must be 8-14 alphanumeric characters (e.g. B0C1234567).');
  }
  const marketplace = (input.marketplace || 'amazon.com').slice(0, 64);
  const reviewUrl =
    input.reviewUrl?.trim() ||
    `https://www.${marketplace}/review/create-review?encoding=UTF&asin=${encodeURIComponent(asin)}`;

  const payload: Record<string, unknown> = {
    ownerId: uid,
    asin,
    productTitle: (input.productTitle || `Amazon Product ${asin}`).trim().slice(0, 500),
    productDescription: (input.productDescription || '').slice(0, 5000),
    productImage: (input.productImage || '').slice(0, 1000),
    reviewUrl: reviewUrl.slice(0, 1000),
    ...(input.reviewLink ? { reviewLink: input.reviewLink.slice(0, 1000) } : {}),
    ...(input.unavailableReason ? { unavailableReason: input.unavailableReason.slice(0, 500) } : {}),
    ...(input.amazonStatusText ? { amazonStatusText: input.amazonStatusText.slice(0, 200) } : {}),
    ...(input.amazonQualityText ? { amazonQualityText: input.amazonQualityText.slice(0, 200) } : {}),
    ...(input.orderDateText ? { orderDateText: input.orderDateText.slice(0, 100) } : {}),
    marketplace,
    rating: Math.max(0, Math.min(5, Math.round(input.rating ?? 5))),
    liked: (input.liked || '').slice(0, 2000),
    disliked: (input.disliked || '').slice(0, 2000),
    usage: (input.usage || '').slice(0, 2000),
    notes: (input.notes || '').slice(0, 4000),
    recommend: input.recommend || 'unset',
    tone: input.tone || 'balanced',
    length: input.length || 'medium',
    qualityBand: 'none',
    status: input.status || 'queued',
    ...(input.batchId ? { batchId: input.batchId.slice(0, 128) } : {}),
    source: input.source || 'manual',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'users', uid, 'reviews', id), payload);
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function createReviewBatch(
  uid: string,
  items: CreateReviewInput[],
  defaultMarketplace = 'amazon.com',
  defaultTone: ReviewTone = 'balanced',
  defaultLength: ReviewLength = 'medium',
  existingReviews: ReviewItem[] = []
): Promise<{ created: number; updated: number; ids: string[] }> {
  const batchId = makeSafeDocId('batch');
  const existingByAsin = new Map<string, ReviewItem>();
  for (const r of existingReviews) {
    existingByAsin.set(r.asin.toUpperCase(), r);
  }

  const createdIds: string[] = [];
  let updatedCount = 0;

  // Deduplicate incoming items by ASIN
  const deduped: CreateReviewInput[] = [];
  const seenIncoming = new Set<string>();
  for (const item of items) {
    const asin = normalizeAsin(item.asin);
    if (!/^[A-Z0-9]{8,14}$/.test(asin) || seenIncoming.has(asin)) continue;
    seenIncoming.add(asin);
    deduped.push({ ...item, asin });
  }

  const chunks: CreateReviewInput[][] = [];
  for (let i = 0; i < deduped.length; i += 200) {
    chunks.push(deduped.slice(i, i + 200));
  }

  try {
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      for (const item of chunk) {
        const existing = existingByAsin.get(item.asin);
        const marketplace = (item.marketplace || defaultMarketplace).slice(0, 64);
        const reviewUrl =
          item.reviewUrl?.trim() ||
          `https://www.${marketplace}/review/create-review?encoding=UTF&asin=${encodeURIComponent(item.asin)}`;

        if (existing) {
          // Do not overwrite terminal completed items or discard cached strong drafts
          if (existing.status === 'completed') continue;
          const nextStatus: ReviewStatus =
            item.status === 'completed'
              ? 'completed'
              : item.status === 'interaction_required'
                ? 'interaction_required'
                : existing.status;

          batch.update(doc(db, 'users', uid, 'reviews', existing.id), {
            status: nextStatus,
            productTitle: (item.productTitle || existing.productTitle).slice(0, 500),
            productImage: (item.productImage || existing.productImage || '').slice(0, 1000),
            reviewUrl: reviewUrl.slice(0, 1000),
            ...(item.reviewLink ? { reviewLink: item.reviewLink.slice(0, 1000) } : {}),
            ...(item.unavailableReason
              ? { unavailableReason: item.unavailableReason.slice(0, 500) }
              : {}),
            ...(item.amazonStatusText
              ? { amazonStatusText: item.amazonStatusText.slice(0, 200) }
              : {}),
            ...(item.amazonQualityText
              ? { amazonQualityText: item.amazonQualityText.slice(0, 200) }
              : {}),
            ...(item.orderDateText ? { orderDateText: item.orderDateText.slice(0, 100) } : {}),
            updatedAt: serverTimestamp(),
          });
          updatedCount++;
          continue;
        }

        const id = makeSafeDocId('rev');
        batch.set(doc(db, 'users', uid, 'reviews', id), {
          ownerId: uid,
          asin: item.asin,
          productTitle: (item.productTitle || `Amazon Product ${item.asin}`).trim().slice(0, 500),
          productDescription: (item.productDescription || '').slice(0, 5000),
          productImage: (item.productImage || '').slice(0, 1000),
          reviewUrl: reviewUrl.slice(0, 1000),
          ...(item.reviewLink ? { reviewLink: item.reviewLink.slice(0, 1000) } : {}),
          ...(item.unavailableReason
            ? { unavailableReason: item.unavailableReason.slice(0, 500) }
            : {}),
          ...(item.amazonStatusText
            ? { amazonStatusText: item.amazonStatusText.slice(0, 200) }
            : {}),
          ...(item.amazonQualityText
            ? { amazonQualityText: item.amazonQualityText.slice(0, 200) }
            : {}),
          ...(item.orderDateText ? { orderDateText: item.orderDateText.slice(0, 100) } : {}),
          marketplace,
          rating: Math.max(0, Math.min(5, Math.round(item.rating ?? 5))),
          liked: (item.liked || '').slice(0, 2000),
          disliked: (item.disliked || '').slice(0, 2000),
          usage: (item.usage || '').slice(0, 2000),
          notes: (item.notes || '').slice(0, 4000),
          recommend: item.recommend || 'unset',
          tone: item.tone || defaultTone,
          length: item.length || defaultLength,
          qualityBand: 'none',
          status: item.status || 'queued',
          batchId: item.batchId || batchId,
          source: item.source || 'batch_import',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        createdIds.push(id);
      }
      await batch.commit();
    }
    return { created: createdIds.length, updated: updatedCount, ids: createdIds };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}/reviews`);
  }
}

export async function updateReviewExperience(
  uid: string,
  reviewId: string,
  patch: Partial<{
    productTitle: string;
    productDescription: string;
    productImage: string;
    reviewUrl: string;
    marketplace: string;
    rating: number;
    liked: string;
    disliked: string;
    usage: string;
    notes: string;
    recommend: RecommendChoice;
    tone: ReviewTone;
    length: ReviewLength;
  }>
): Promise<void> {
  const path = `users/${uid}/reviews/${reviewId}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.productTitle !== undefined)
      payload.productTitle = patch.productTitle.trim().slice(0, 500) || 'Untitled Product';
    if (patch.productDescription !== undefined)
      payload.productDescription = patch.productDescription.slice(0, 5000);
    if (patch.productImage !== undefined) payload.productImage = patch.productImage.slice(0, 1000);
    if (patch.reviewUrl !== undefined) payload.reviewUrl = patch.reviewUrl.slice(0, 1000);
    if (patch.marketplace !== undefined) payload.marketplace = patch.marketplace.slice(0, 64);
    if (patch.rating !== undefined)
      payload.rating = Math.max(0, Math.min(5, Math.round(patch.rating)));
    if (patch.liked !== undefined) payload.liked = patch.liked.slice(0, 2000);
    if (patch.disliked !== undefined) payload.disliked = patch.disliked.slice(0, 2000);
    if (patch.usage !== undefined) payload.usage = patch.usage.slice(0, 2000);
    if (patch.notes !== undefined) payload.notes = patch.notes.slice(0, 4000);
    if (patch.recommend !== undefined) payload.recommend = patch.recommend;
    if (patch.tone !== undefined) payload.tone = patch.tone;
    if (patch.length !== undefined) payload.length = patch.length;

    await updateDoc(doc(db, 'users', uid, 'reviews', reviewId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function saveDraftAndQuality(
  uid: string,
  reviewId: string,
  data: {
    draftTitle: string;
    draftBody: string;
    rating: number;
    qualityBand: QualityBand;
    assessment?: QualityAssessment | null;
    tokensUsed?: number;
    status: ReviewStatus;
  }
): Promise<void> {
  const path = `users/${uid}/reviews/${reviewId}`;
  try {
    const payload: Record<string, unknown> = {
      draftTitle: data.draftTitle.slice(0, 500),
      draftBody: data.draftBody.slice(0, 20000),
      rating: Math.max(1, Math.min(5, Math.round(data.rating))),
      qualityBand: data.qualityBand,
      status: data.status,
      updatedAt: serverTimestamp(),
    };
    if (data.tokensUsed !== undefined) {
      payload.tokensUsed = Math.max(0, Math.min(1000000, Math.round(data.tokensUsed)));
    }
    if (data.assessment) {
      payload.qualitySummary = (data.assessment.summary || '').slice(0, 2000);
      if (data.assessment.asinProductMatch) {
        payload.qualityAsinMatch = {
          status: data.assessment.asinProductMatch.status,
          reason: String(data.assessment.asinProductMatch.reason || '').slice(0, 500),
        };
      }
      if (data.assessment.originality) {
        payload.qualityOriginality = {
          verified: Boolean(data.assessment.originality.verified),
          reason: String(data.assessment.originality.reason || '').slice(0, 500),
        };
      }
      payload.qualityStrengths = (data.assessment.strengths || [])
        .slice(0, 20)
        .map((s) => String(s).slice(0, 500));
      payload.qualitySuggestions = (data.assessment.suggestions || []).slice(0, 20).map((s) => ({
        ...(s.quote ? { quote: String(s.quote).slice(0, 500) } : {}),
        issue: String(s.issue || '').slice(0, 500),
        question: String(s.question || '').slice(0, 500),
      }));
      payload.qualityConcerns = (data.assessment.concerns || [])
        .slice(0, 20)
        .map((s) => String(s).slice(0, 500));
    }
    await updateDoc(doc(db, 'users', uid, 'reviews', reviewId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function transitionReviewStatus(
  uid: string,
  reviewId: string,
  status: ReviewStatus
): Promise<void> {
  const path = `users/${uid}/reviews/${reviewId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'reviews', reviewId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteReviewItem(uid: string, reviewId: string): Promise<void> {
  const path = `users/${uid}/reviews/${reviewId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'reviews', reviewId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function downscaleFileToJpeg(
  file: File,
  maxDim = 1800,
  quality = 0.88
): Promise<StagedPhoto> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return {
      id: makeSafeDocId('img'),
      name: `${baseName}.jpg`,
      mime: 'image/jpeg',
      data: base64,
      previewUrl: dataUrl,
      width,
      height,
    };
  } finally {
    bitmap.close?.();
  }
}

// Ported directly from SmartViner's parseReviewsHtml + vine-parse.js
export function parseAmazonVineHtml(
  html: string,
  marketplace = 'amazon.com'
): CreateReviewInput[] {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const origin = `https://www.${marketplace}`;
  const seen = new Set<string>();
  const results: CreateReviewInput[] = [];

  const text = (el: Element | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

  // 1) Vine reviews table rows (tr.vvp-reviews-table--row)
  doc.querySelectorAll('tr.vvp-reviews-table--row').forEach((row) => {
    const productA =
      row.querySelector('#vvp-reviews-product-detail-page-link') ||
      row.querySelector('.vvp-reviews-table--text-col a.a-link-normal');
    const productHref = productA?.getAttribute('href') || '';
    const actionA = row.querySelector('.vvp-reviews-table--actions-col a');
    const actionHref = actionA?.getAttribute('href') || '';
    const asinMatch =
      productHref.match(/(?:\/dp\/|\/gp\/product\/|[?&]asin=)([A-Z0-9]{10})/i)?.[1] ||
      actionHref.match(/[?&]asin=([A-Z0-9]{10})/i)?.[1] ||
      row.querySelector('[data-asin]')?.getAttribute('data-asin') ||
      '';
    const asin = normalizeAsin(asinMatch);
    if (!/^[A-Z0-9]{8,14}$/.test(asin) || seen.has(asin)) return;
    seen.add(asin);

    const title =
      text(productA?.querySelector('.a-truncate-full')) ||
      text(productA?.querySelector('.a-truncate-cut')) ||
      text(productA) ||
      `Amazon Item ${asin}`;
    const img = row.querySelector('.vvp-reviews-table--image-col img')?.getAttribute('src') || '';
    const dateCell = row.querySelector('[data-order-timestamp], td.vvp-reviews-table--text-col:nth-of-type(3)');
    const statusCell = row.querySelector('td.vvp-reviews-table--text-col:nth-of-type(4)');
    const qualityCell = row.querySelector('td.vvp-reviews-table--text-col:nth-of-type(5)');
    const amazonStatusText = text(statusCell);
    const amazonQualityText = text(qualityCell);
    const unavailableReason = text(row.querySelector('.vvp-subtitle-color'));

    const writeReviewUrl =
      actionA && /create-review|write-review/i.test(actionHref)
        ? actionHref.startsWith('http')
          ? actionHref
          : `${origin}${actionHref.startsWith('/') ? '' : '/'}${actionHref}`
        : `${origin}/review/create-review?encoding=UTF&asin=${asin}`;

    const viewA = Array.from(row.querySelectorAll('a')).find((a) => {
      const h = a.getAttribute('href') || '';
      const l = text(a);
      return /view\s*review|edit\s*review/i.test(l) || /\/gp\/customer-reviews\/|\/product-reviews\//i.test(h);
    });
    const rawReviewLink = viewA?.getAttribute('href') || '';
    const reviewLink = rawReviewLink
      ? rawReviewLink.startsWith('http')
        ? rawReviewLink
        : `${origin}${rawReviewLink.startsWith('/') ? '' : '/'}${rawReviewLink}`
      : undefined;

    let status: ReviewStatus = 'queued';
    if (unavailableReason && !productA) {
      status = 'interaction_required';
    } else if (/not approved|rejected/i.test(amazonStatusText)) {
      status = 'interaction_required';
    } else if (/pending approval/i.test(amazonStatusText)) {
      status = 'submitted';
    } else if (/approved|completed/i.test(amazonStatusText) || reviewLink) {
      status = 'completed';
    }

    results.push({
      asin,
      productTitle: title,
      productImage: img,
      reviewUrl: writeReviewUrl,
      ...(reviewLink ? { reviewLink } : {}),
      ...(unavailableReason ? { unavailableReason } : {}),
      ...(amazonStatusText ? { amazonStatusText } : {}),
      ...(amazonQualityText ? { amazonQualityText } : {}),
      ...(text(dateCell) ? { orderDateText: text(dateCell) } : {}),
      status,
      marketplace,
      source: 'html_import',
    });
  });

  // 2) Fallback: Vine queue tiles (.vvp-item-tile) or generic ASIN rows
  doc.querySelectorAll('.vvp-item-tile, [data-asin]').forEach((el) => {
    const dataset = (el.querySelector('input') as HTMLElement | null)?.dataset || {};
    const asin = normalizeAsin(dataset.asin || el.getAttribute('data-asin') || '');
    if (!/^[A-Z0-9]{8,14}$/.test(asin) || seen.has(asin)) return;
    seen.add(asin);
    const title =
      text(el.querySelector('.a-truncate-full')) ||
      text(el.querySelector('a')) ||
      `Amazon Item ${asin}`;
    const image = (el as HTMLElement).dataset?.imgUrl || el.querySelector('img')?.getAttribute('src') || '';
    results.push({
      asin,
      productTitle: title,
      productImage: image,
      reviewUrl: `${origin}/review/create-review?encoding=UTF&asin=${asin}`,
      status: 'queued',
      marketplace,
      source: 'html_import',
    });
  });

  return results;
}

export function parseBatchTextInput(text: string, marketplace = 'amazon.com'): CreateReviewInput[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.items)
          ? parsed.items
          : [parsed];
      return arr
        .map((r: Record<string, unknown>) => ({
          asin: normalizeAsin(String(r.asin || '')),
          productTitle: String(r.title || r.productTitle || `Amazon Item ${r.asin || ''}`).trim(),
          productDescription: r.description
            ? String(r.description)
            : r.productDescription
              ? String(r.productDescription)
              : '',
          productImage: r.image ? String(r.image) : r.productImage ? String(r.productImage) : '',
          reviewUrl: r.reviewUrl ? String(r.reviewUrl) : undefined,
          rating: Number.isFinite(Number(r.rating)) ? Number(r.rating) : 5,
          notes: r.notes ? String(r.notes) : '',
          marketplace: String(r.marketplace || marketplace),
          source: 'batch_import' as const,
        }))
        .filter((x: CreateReviewInput) => /^[A-Z0-9]{8,14}$/.test(x.asin));
    } catch {
      // fall through
    }
  }

  const out: CreateReviewInput[] = [];
  const seen = new Set<string>();
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.includes('|')
      ? line.split('|').map((s) => s.trim())
      : line.includes('\t')
        ? line.split('\t').map((s) => s.trim())
        : line.includes(',')
          ? line.split(',').map((s) => s.trim())
          : [line];
    const asin = normalizeAsin(parts[0] || line);
    if (!/^[A-Z0-9]{8,14}$/.test(asin) || seen.has(asin)) continue;
    seen.add(asin);
    out.push({
      asin,
      productTitle: parts[1] || `Amazon Vine Item ${asin}`,
      notes: parts[2] || '',
      marketplace,
      source: 'batch_import',
    });
  }
  return out;
}
