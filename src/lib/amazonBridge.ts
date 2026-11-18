import { ReviewItem } from '../types';

export function buildAmazonReviewUrl(item: ReviewItem): string {
  const marketplace = item.marketplace || 'amazon.com';
  const raw = (item.reviewUrl || '').split('#')[0].trim();
  if (raw && /^https?:\/\/[^/]*amazon\./i.test(raw)) {
    return raw;
  }
  return `https://www.${marketplace}/review/create-review?encoding=UTF&asin=${encodeURIComponent(item.asin)}`;
}

/**
 * Safe-Zone Amazon Launch:
 * - Never appends prefill fragments (#vinecraft_prefill=...)
 * - Never injects scripts, synthetic clicks, or React input hacks onto Amazon
 * - Copies the review body to the user's clipboard and opens the plain Amazon review URL
 *   so the human reviewer naturally selects stars, pastes, reviews, and clicks Submit.
 */
export async function copyAndOpenCleanAmazonReview(item: ReviewItem): Promise<{ url: string; copied: boolean }> {
  const url = buildAmazonReviewUrl(item);
  let copied = false;

  if (typeof navigator !== 'undefined' && navigator.clipboard && (item.draftBody || item.draftTitle)) {
    try {
      await navigator.clipboard.writeText((item.draftBody || item.draftTitle || '').trim());
      copied = true;
    } catch {
      copied = false;
    }
  }

  if (typeof window !== 'undefined') {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return { url, copied };
}
