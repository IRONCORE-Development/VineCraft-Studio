import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  ArrowRight,
  Check,
  Copy,
  Database,
  ExternalLink,
  Eye,
  ImagePlus,
  LogIn,
  LogOut,
  Moon,
  Plus,
  Send,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { auth, googleProvider } from './firebase';
import { ErrorBoundary } from './components/ErrorBoundary';
import { QualityInspectorPanel } from './components/QualityInspectorPanel';
import { BatchQueueView } from './components/BatchQueueView';
import { CachedStrongView } from './components/CachedStrongView';
import { FirefoxBridgeView } from './components/FirefoxBridgeView';
import { PromptsPayload, SystemPromptsModal } from './components/SystemPromptsModal';
import { AdvancedAiModal } from './components/AdvancedAiModal';
import { copyAndOpenCleanAmazonReview } from './lib/amazonBridge';
import {
  CreateReviewInput,
  createReviewBatch,
  createReviewItem,
  deleteReviewItem,
  downscaleFileToJpeg,
  ensureUserProfile,
  normalizeAsin,
  saveDraftAndQuality,
  subscribeUserProfile,
  subscribeUserReviews,
  transitionReviewStatus,
  updateReviewExperience,
  updateUserProfile,
} from './lib/reviewService';
import {
  AiEnginePreset,
  QualityAssessment,
  QualityBand,
  RecommendChoice,
  ReviewItem,
  ReviewLength,
  ReviewStatus,
  ReviewTone,
  StagedPhoto,
  UserProfile,
} from './types';

type ActiveView = 'workspace' | 'batch' | 'cache' | 'bridge';

function deDash(s: string): string {
  return String(s || '').replace(/[‒–—―−]/g, '-');
}

function VineCraftStudio() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [activeView, setActiveView] = useState<ActiveView>('workspace');
  const [darkMode, setDarkMode] = useState(false);

  // Active item state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [asin, setAsin] = useState('');
  const [productTitle, setProductTitle] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [marketplace, setMarketplace] = useState('amazon.com');
  const [reviewUrl, setReviewUrl] = useState('');
  const [rating, setRating] = useState(5);
  const [liked, setLiked] = useState('');
  const [disliked, setDisliked] = useState('');
  const [usage, setUsage] = useState('');
  const [notes, setNotes] = useState('');
  const [recommend, setRecommend] = useState<RecommendChoice>('yes');
  const [tone, setTone] = useState<ReviewTone>('balanced');
  const [length, setLength] = useState<ReviewLength>('medium');
  const [customInstructions, setCustomInstructions] = useState('');
  const [showInstructions, setShowInstructions] = useState(false);
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);

  // Draft & Inspection state
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [qualityBand, setQualityBand] = useState<QualityBand>('none');
  const [assessment, setAssessment] = useState<QualityAssessment | null>(null);
  const [checkedSignature, setCheckedSignature] = useState('');

  // Action states
  const [generating, setGenerating] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [refining, setRefining] = useState(false);
  const [copiedDraft, setCopiedDraft] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  // Batch runner state
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    activeAsin?: string;
    tokensUsed: number;
    tokenCap: number;
  } | null>(null);
  const stopBatchRef = useRef(false);

  // Prompts transparency & Advanced Override modals
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [serverPrompts, setServerPrompts] = useState<PromptsPayload | null>(null);
  const [serverProviders, setServerProviders] = useState({
    free_local: true,
    anthropic: false,
    gemini: false,
    custom_endpoint: false,
  });
  const [copiedHandoff, setCopiedHandoff] = useState(false);

  const bridgeKey = useMemo(
    () => (user ? `vc_${user.uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)}` : ''),
    [user]
  );

  // Fetch canonical prompts & available server backends
  useEffect(() => {
    fetch('/api/ai/prompts')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setServerPrompts(data as PromptsPayload);
      })
      .catch(() => {});
    fetch('/api/ai/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.providers) setServerProviders(data.providers);
      })
      .catch(() => {});
  }, []);

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  // Firebase Auth & Firestore subscriptions
  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let unsubReviews: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      unsubProfile?.();
      unsubReviews?.();
      unsubProfile = null;
      unsubReviews = null;

      setUser(fbUser);
      if (!fbUser) {
        setProfile(null);
        setReviews([]);
        setAuthReady(true);
        return;
      }

      try {
        const ensured = await ensureUserProfile(fbUser.uid, fbUser.email, fbUser.displayName);
        setProfile(ensured);
        setMarketplace(ensured.amazonMarketplace || 'amazon.com');
        setTone(ensured.defaultTone || 'balanced');
        setLength(ensured.defaultLength || 'medium');
        setCustomInstructions(ensured.customInstructions || '');

        unsubProfile = subscribeUserProfile(fbUser.uid, (p) => {
          setProfile(p);
        });
        unsubReviews = subscribeUserReviews(fbUser.uid, (list) => {
          setReviews(list);
        });
      } catch (err) {
        setErrorNotice(err instanceof Error ? err.message : 'Failed to initialize user workspace.');
      } finally {
        setAuthReady(true);
      }
    });

    return () => {
      unsubAuth();
      unsubProfile?.();
      unsubReviews?.();
    };
  }, []);

  // One-time upgrade for users whose Firestore profile defaulted to 'free_local' before LLM default restoration
  useEffect(() => {
    if (!user || !profile || !serverProviders.gemini) return;
    if (profile.aiEnginePreset === 'free_local') {
      try {
        const flagKey = `vc_default_llm_upgraded_${user.uid}`;
        if (!localStorage.getItem(flagKey)) {
          localStorage.setItem(flagKey, '1');
          updateUserProfile(user.uid, {
            aiEnginePreset: 'gemini',
            generationModel: 'gemini-4-hydrogen',
            qualityModel: 'gemini-4-hydrogen',
          }).catch(() => {});
        }
      } catch {
        // ignore storage access issues
      }
    }
  }, [user, profile, serverProviders.gemini]);

  const loadItemIntoEditor = useCallback((item: ReviewItem) => {
    setActiveId(item.id);
    setAsin(item.asin);
    setProductTitle(item.productTitle);
    setProductDescription(item.productDescription || '');
    setMarketplace(item.marketplace || 'amazon.com');
    setReviewUrl(item.reviewUrl || '');
    setRating(item.rating || 5);
    setLiked(item.liked || '');
    setDisliked(item.disliked || '');
    setUsage(item.usage || '');
    setNotes(item.notes || '');
    setRecommend(item.recommend || 'unset');
    setTone(item.tone || 'balanced');
    setLength(item.length || 'medium');
    setDraftTitle(item.draftTitle || '');
    setDraftBody(item.draftBody || '');
    setQualityBand(item.qualityBand || 'none');

    if (item.qualityBand !== 'none' && item.qualitySummary) {
      setAssessment({
        band: item.qualityBand as Exclude<QualityBand, 'none'>,
        summary: item.qualitySummary,
        ...(item.qualityAsinMatch ? { asinProductMatch: item.qualityAsinMatch } : {}),
        ...(item.qualityOriginality ? { originality: item.qualityOriginality } : {}),
        strengths: item.qualityStrengths || [],
        suggestions: item.qualitySuggestions || [],
        concerns: item.qualityConcerns || [],
      });
      setCheckedSignature(
        JSON.stringify({
          title: item.draftTitle || '',
          body: item.draftBody || '',
          rating: item.rating || 5,
        })
      );
    } else {
      setAssessment(null);
      setCheckedSignature('');
    }
    setErrorNotice(null);
  }, []);

  const clearEditorForNewItem = useCallback(() => {
    setActiveId(null);
    setAsin('');
    setProductTitle('');
    setProductDescription('');
    setReviewUrl('');
    setRating(5);
    setLiked('');
    setDisliked('');
    setUsage('');
    setNotes('');
    setRecommend('yes');
    setTone(profile?.defaultTone || 'balanced');
    setLength(profile?.defaultLength || 'medium');
    setMarketplace(profile?.amazonMarketplace || 'amazon.com');
    setDraftTitle('');
    setDraftBody('');
    setQualityBand('none');
    setAssessment(null);
    setCheckedSignature('');
    setPhotos([]);
    setErrorNotice(null);
  }, [profile]);

  // Poll bridge inbox for Amazon "Review item" detection prompt imports & submit confirmations
  useEffect(() => {
    if (!user || !bridgeKey || !profile) return;
    let cancelled = false;

    async function pollBridge() {
      if (cancelled || !user || !profile) return;
      try {
        const res = await fetch(`/api/bridge/pending?bridgeKey=${encodeURIComponent(bridgeKey)}&drain=1`);
        if (!res.ok) return;
        const data = await res.json();
        const incoming = Array.isArray(data?.items) ? data.items : [];
        const submissions = Array.isArray(data?.submissions) ? data.submissions : [];

        if (incoming.length > 0) {
          const batchResult = await createReviewBatch(
            user.uid,
            incoming.map((it: Record<string, unknown>) => ({
              asin: String(it.asin || ''),
              productTitle: String(it.productTitle || ''),
              productDescription: String(it.productDescription || ''),
              productImage: String(it.productImage || ''),
              reviewUrl: String(it.reviewUrl || ''),
              reviewLink: it.reviewLink ? String(it.reviewLink) : undefined,
              unavailableReason: it.unavailableReason ? String(it.unavailableReason) : undefined,
              amazonStatusText: it.amazonStatusText ? String(it.amazonStatusText) : undefined,
              amazonQualityText: it.amazonQualityText ? String(it.amazonQualityText) : undefined,
              orderDateText: it.orderDateText ? String(it.orderDateText) : undefined,
              status: it.bucket ? (String(it.bucket) as ReviewStatus) : 'queued',
              marketplace: String(it.marketplace || profile.amazonMarketplace || 'amazon.com'),
              source:
                it.source === 'amazon_pagination'
                  ? 'amazon_pagination'
                  : incoming.length > 1
                    ? 'batch_import'
                    : 'amazon_detection',
            })),
            profile.amazonMarketplace,
            profile.defaultTone,
            profile.defaultLength,
            reviews
          );
          setStatusNotice(
            incoming.length > 1
              ? `Synced ${batchResult.created} new and ${batchResult.updated} existing item(s) from Amazon.`
              : `Amazon Detection Prompt loaded ${incoming[0].asin} into your queue.`
          );
          if (incoming.length > 1) setActiveView('batch');
        }

        if (submissions.length > 0) {
          for (const sub of submissions) {
            const match = reviews.find(
              (r) => r.asin === sub.asin && r.status !== 'posted'
            );
            if (match) {
              await transitionReviewStatus(user.uid, match.id, 'posted');
            }
          }
          setStatusNotice(`Confirmed Amazon submission for ${submissions.map((s: { asin: string }) => s.asin).join(', ')}.`);
        }
      } catch {
        // silent network retry on next tick
      }
    }

    const interval = setInterval(pollBridge, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user, bridgeKey, profile, reviews]);

  const readyToPostDrafts = useMemo(
    () =>
      reviews.filter(
        (r) =>
          (r.status === 'cached_strong' || r.status === 'ready_to_post' || r.qualityBand === 'strong') &&
          r.status !== 'posted' &&
          Boolean(r.draftBody?.trim())
      ),
    [reviews]
  );

  // Sync ready drafts to local Studio companion popup (zero Amazon touch)
  useEffect(() => {
    if (!user || !bridgeKey) return;
    fetch('/api/bridge/staged', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bridgeKey,
        drafts: readyToPostDrafts.slice(0, 50).map((r) => ({
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
    }).catch(() => {});
  }, [user, bridgeKey, readyToPostDrafts]);

  // Helper: advance to the next queued item automatically
  const advanceToNextQueued = useCallback(
    (excludeId: string) => {
      const next = reviews.find(
        (r) => r.id !== excludeId && (r.status === 'queued' || r.status === 'needs_review')
      );
      if (next) {
        loadItemIntoEditor(next);
        return next;
      }
      clearEditorForNewItem();
      return null;
    },
    [reviews, loadItemIntoEditor, clearEditorForNewItem]
  );

  // API Helpers
  const recentDraftOpeners = useMemo(
    () =>
      reviews
        .filter((r) => r.draftTitle && r.draftBody)
        .slice(0, 8)
        .map((r) => `${r.draftTitle}: ${(r.draftBody || '').slice(0, 90)}`),
    [reviews]
  );

  const activeEngine: AiEnginePreset = profile?.aiEnginePreset || 'gemini';
  const overrideEnabled = Boolean(profile?.advancedOverrideEnabled);
  const learnedToneActive = Boolean(
    profile?.learnedToneEnabled !== false &&
      (profile?.learnedToneSummary?.trim() || (profile?.learnedFacts?.length ?? 0) > 0)
  );
  const learnedVoicePayload = useMemo(
    () => ({
      enabled: profile?.learnedToneEnabled !== false,
      summary: profile?.learnedToneSummary || '',
      facts: profile?.learnedFacts || [],
    }),
    [profile?.learnedToneEnabled, profile?.learnedToneSummary, profile?.learnedFacts]
  );

  async function callGenerateApi(params: {
    asin: string;
    productTitle: string;
    productDescription: string;
    rating: number;
    liked: string;
    disliked: string;
    usage: string;
    notes: string;
    recommend: RecommendChoice;
    tone: ReviewTone;
    length: ReviewLength;
    instructions: string;
    images?: StagedPhoto[];
    batchMode?: boolean;
    recentOpeners?: string[];
  }): Promise<{ title: string; body: string; tokensUsed: number }> {
    const res = await fetch('/api/ai/review/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: {
          asin: params.asin,
          title: params.productTitle,
          description: params.productDescription,
        },
        context: {
          rating: params.rating,
          liked: params.liked,
          disliked: params.disliked,
          usage: params.usage,
          notes: params.notes,
          instructions: params.instructions,
          recommend: params.recommend,
          tone: params.tone,
          length: params.length,
        },
        images: (params.images || []).map((p) => ({
          name: p.name,
          mime: p.mime,
          data: p.data,
        })),
        batchMode: Boolean(params.batchMode),
        recentOpeners: params.recentOpeners || recentDraftOpeners,
        learnedVoice: learnedVoicePayload,
        provider: activeEngine,
        model: overrideEnabled ? profile?.generationModel : undefined,
        endpointUrl: overrideEnabled ? profile?.customEndpointUrl : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.review) {
      throw new Error(data?.error || 'Failed to generate review.');
    }
    return {
      title: deDash(data.review.title || ''),
      body: deDash(data.review.body || ''),
      tokensUsed: Number(data?.usage?.totalTokens || 0),
    };
  }

  async function callQualityApi(params: {
    title: string;
    body: string;
    rating: number;
    asin: string;
    productTitle: string;
    productDescription: string;
    notes: string;
    batchMode?: boolean;
    recentOpeners?: string[];
  }): Promise<QualityAssessment> {
    const res = await fetch('/api/ai/review/quality', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        rating: params.rating,
        asin: params.asin,
        product_title: params.productTitle,
        description: params.productDescription,
        notes: params.notes,
        batchMode: Boolean(params.batchMode),
        recentOpeners: params.recentOpeners || recentDraftOpeners,
        provider: activeEngine,
        model: overrideEnabled ? profile?.qualityModel : undefined,
        endpointUrl: overrideEnabled ? profile?.customEndpointUrl : undefined,
        overrideEnabled,
        systemPromptOverride: overrideEnabled ? profile?.qualitySystemPromptOverride : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.band) {
      throw new Error(data?.error || 'Quality inspection failed.');
    }
    return data as QualityAssessment;
  }

  async function callRefineApi(params: {
    asin: string;
    productTitle: string;
    productDescription: string;
    rating: number;
    liked: string;
    disliked: string;
    usage: string;
    notes: string;
    draftTitle: string;
    draftBody: string;
    assessment: QualityAssessment;
    recentOpeners?: string[];
  }): Promise<{ title: string; body: string; tokensUsed: number }> {
    const res = await fetch('/api/ai/review/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: {
          asin: params.asin,
          title: params.productTitle,
          description: params.productDescription,
        },
        context: {
          rating: params.rating,
          liked: params.liked,
          disliked: params.disliked,
          usage: params.usage,
          notes: params.notes,
        },
        draft: {
          title: params.draftTitle,
          body: params.draftBody,
        },
        assessment: params.assessment,
        recentOpeners: params.recentOpeners || recentDraftOpeners,
        learnedVoice: learnedVoicePayload,
        provider: activeEngine,
        model: overrideEnabled ? profile?.generationModel : undefined,
        endpointUrl: overrideEnabled ? profile?.customEndpointUrl : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.review) {
      throw new Error(data?.error || 'Failed to refine review.');
    }
    return {
      title: deDash(data.review.title || ''),
      body: deDash(data.review.body || ''),
      tokensUsed: Number(data?.usage?.totalTokens || 0),
    };
  }

  // Ensure current editor item exists in Firestore before saving draft/quality
  async function ensureActiveItemPersisted(): Promise<string> {
    if (!user) throw new Error('Sign in required.');
    const cleanAsin = normalizeAsin(asin);
    if (!/^[A-Z0-9]{8,14}$/.test(cleanAsin)) {
      throw new Error('Enter a valid 10-character Amazon ASIN (e.g. B0C1234567).');
    }
    if (!productTitle.trim() && !productDescription.trim()) {
      throw new Error('Enter a product title or listing details.');
    }

    if (activeId) {
      await updateReviewExperience(user.uid, activeId, {
        productTitle: productTitle.trim() || `Amazon Item ${cleanAsin}`,
        productDescription,
        reviewUrl,
        marketplace,
        rating,
        liked,
        disliked,
        usage,
        notes,
        recommend,
        tone,
        length,
      });
      return activeId;
    }

    const newId = await createReviewItem(user.uid, {
      asin: cleanAsin,
      productTitle: productTitle.trim() || `Amazon Item ${cleanAsin}`,
      productDescription,
      reviewUrl,
      marketplace,
      rating,
      liked,
      disliked,
      usage,
      notes,
      recommend,
      tone,
      length,
      source: 'manual',
    });
    setActiveId(newId);
    return newId;
  }

  // Core Pipeline: Generate -> Automatic Quality Inspection -> Strong Action (Cache & Next OR Direct Post)
  async function handleGenerateAndInspect() {
    if (!user || !profile || generating) return;
    setErrorNotice(null);
    setStatusNotice(null);
    setGenerating(true);

    try {
      const itemId = await ensureActiveItemPersisted();
      const cleanAsin = normalizeAsin(asin);

      let generated = await callGenerateApi({
        asin: cleanAsin,
        productTitle,
        productDescription,
        rating,
        liked,
        disliked,
        usage,
        notes,
        recommend,
        tone,
        length,
        instructions: customInstructions,
        images: photos,
      });

      setDraftTitle(generated.title);
      setDraftBody(generated.body);

      let itemTokens = generated.tokensUsed;
      let latestAssessment: QualityAssessment | null = null;
      let latestBand: QualityBand = 'none';

      if (profile.autoInspectOnGenerate) {
        setInspecting(true);
        try {
          latestAssessment = await callQualityApi({
            title: generated.title,
            body: generated.body,
            rating,
            asin: cleanAsin,
            productTitle,
            productDescription,
            notes,
          });
          itemTokens += Number(latestAssessment?.usage?.totalTokens || 0);
          latestBand = latestAssessment.band;

          // Optional auto-refine 1 pass if below 'strong'
          if (profile.autoRefineBelowStrong && latestBand !== 'strong') {
            setRefining(true);
            try {
              const refined = await callRefineApi({
                asin: cleanAsin,
                productTitle,
                productDescription,
                rating,
                liked,
                disliked,
                usage,
                notes,
                draftTitle: generated.title,
                draftBody: generated.body,
                assessment: latestAssessment,
              });
              itemTokens += refined.tokensUsed;
              generated = refined;
              setDraftTitle(refined.title);
              setDraftBody(refined.body);

              latestAssessment = await callQualityApi({
                title: refined.title,
                body: refined.body,
                rating,
                asin: cleanAsin,
                productTitle,
                productDescription,
                notes,
              });
              itemTokens += Number(latestAssessment?.usage?.totalTokens || 0);
              latestBand = latestAssessment.band;
            } finally {
              setRefining(false);
            }
          }
        } finally {
          setInspecting(false);
        }
      }

      setAssessment(latestAssessment);
      setQualityBand(latestBand);
      setCheckedSignature(
        JSON.stringify({ title: generated.title, body: generated.body, rating })
      );

      // Strong Action Routing (Safe-Zone: never auto-opens or injects into Amazon)
      if (latestBand === 'strong') {
        if (profile.strongActionMode === 'direct_post') {
          await saveDraftAndQuality(user.uid, itemId, {
            draftTitle: generated.title,
            draftBody: generated.body,
            rating,
            qualityBand: 'strong',
            assessment: latestAssessment,
            tokensUsed: itemTokens,
            status: 'ready_to_post',
          });
          setStatusNotice(
            `Strong quality verified for ${cleanAsin}. Marked Ready to Post & synced to your Safe Clipboard Popup — click "Copy & Open Amazon" when ready.`
          );
        } else {
          // Cache to DB & move to next review!
          await saveDraftAndQuality(user.uid, itemId, {
            draftTitle: generated.title,
            draftBody: generated.body,
            rating,
            qualityBand: 'strong',
            assessment: latestAssessment,
            tokensUsed: itemTokens,
            status: 'cached_strong',
          });
          const next = advanceToNextQueued(itemId);
          setStatusNotice(
            next
              ? `Cached Strong review for ${cleanAsin} to DB and advanced to ${next.asin}.`
              : `Cached Strong review for ${cleanAsin} to DB. Queue complete.`
          );
        }
      } else {
        await saveDraftAndQuality(user.uid, itemId, {
          draftTitle: generated.title,
          draftBody: generated.body,
          rating,
          qualityBand: latestBand,
          assessment: latestAssessment,
          tokensUsed: itemTokens,
          status: 'needs_review',
        });
        setStatusNotice(
          latestBand === 'none'
            ? `Draft generated for ${cleanAsin}.`
            : `Inspection rated ${cleanAsin} as "${latestBand === 'needs_detail' ? 'Needs detail' : 'Good'}". Review suggestions or click Refine to Strong.`
        );
      }
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleManualInspect() {
    if (!user || !draftTitle.trim() || !draftBody.trim()) return;
    setErrorNotice(null);
    setInspecting(true);
    try {
      const itemId = await ensureActiveItemPersisted();
      const cleanAsin = normalizeAsin(asin);
      const res = await callQualityApi({
        title: draftTitle,
        body: draftBody,
        rating,
        asin: cleanAsin,
        productTitle,
        productDescription,
        notes,
      });
      setAssessment(res);
      setQualityBand(res.band);
      setCheckedSignature(JSON.stringify({ title: draftTitle, body: draftBody, rating }));

      const nextStatus: ReviewStatus =
        res.band === 'strong'
          ? profile?.strongActionMode === 'direct_post'
            ? 'ready_to_post'
            : 'cached_strong'
          : 'needs_review';

      await saveDraftAndQuality(user.uid, itemId, {
        draftTitle: deDash(draftTitle),
        draftBody: deDash(draftBody),
        rating,
        qualityBand: res.band,
        assessment: res,
        status: nextStatus,
      });

      if (res.band === 'strong' && profile?.strongActionMode === 'cache_and_next') {
        const next = advanceToNextQueued(itemId);
        setStatusNotice(
          next
            ? `Quality passed as Strong — cached ${cleanAsin} to DB and loaded ${next.asin}.`
            : `Quality passed as Strong — cached ${cleanAsin} to DB.`
        );
      }
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Quality inspection failed.');
    } finally {
      setInspecting(false);
    }
  }

  async function handleManualRefine() {
    if (!user || !assessment || !draftBody.trim()) return;
    setErrorNotice(null);
    setRefining(true);
    try {
      const itemId = await ensureActiveItemPersisted();
      const cleanAsin = normalizeAsin(asin);
      const previousTitle = draftTitle.trim();
      const previousBody = draftBody.trim();
      const refined = await callRefineApi({
        asin: cleanAsin,
        productTitle,
        productDescription,
        rating,
        liked,
        disliked,
        usage,
        notes,
        draftTitle,
        draftBody,
        assessment,
      });
      setDraftTitle(refined.title);
      setDraftBody(refined.body);

      setInspecting(true);
      const recheck = await callQualityApi({
        title: refined.title,
        body: refined.body,
        rating,
        asin: cleanAsin,
        productTitle,
        productDescription,
        notes,
      });
      setAssessment(recheck);
      setQualityBand(recheck.band);
      setCheckedSignature(
        JSON.stringify({ title: refined.title, body: refined.body, rating })
      );

      const status: ReviewStatus =
        recheck.band === 'strong'
          ? profile?.strongActionMode === 'direct_post'
            ? 'ready_to_post'
            : 'cached_strong'
          : 'needs_review';

      await saveDraftAndQuality(user.uid, itemId, {
        draftTitle: refined.title,
        draftBody: refined.body,
        rating,
        qualityBand: recheck.band,
        assessment: recheck,
        status,
      });

      const changed = refined.title.trim() !== previousTitle || refined.body.trim() !== previousBody;
      if (!changed) {
        setErrorNotice(
          'Rewrite returned the same text. Check your AI Engine Preselect (switch from Offline Template to Built-in Gemini LLM) or add a brief usage note and try again.'
        );
      } else {
        setStatusNotice(
          recheck.band === 'strong'
            ? `Refined ${cleanAsin} to Strong and saved to DB.`
            : `Rewrote ${cleanAsin} (rated "${recheck.band}"). Add any missing product detail or run Refine again.`
        );
      }
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Refinement failed.');
    } finally {
      setRefining(false);
      setInspecting(false);
    }
  }

  async function handleCacheStrongAndNext() {
    if (!user || !draftTitle.trim() || !draftBody.trim()) return;
    try {
      const itemId = await ensureActiveItemPersisted();
      await saveDraftAndQuality(user.uid, itemId, {
        draftTitle: deDash(draftTitle),
        draftBody: deDash(draftBody),
        rating,
        qualityBand: qualityBand === 'none' ? 'strong' : qualityBand,
        assessment,
        status: 'cached_strong',
      });
      const next = advanceToNextQueued(itemId);
      setStatusNotice(
        next
          ? `Cached ${normalizeAsin(asin)} to DB and advanced to ${next.asin}.`
          : `Cached ${normalizeAsin(asin)} to DB.`
      );
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Failed to cache review.');
    }
  }

  async function handlePostItemToAmazon(item: ReviewItem) {
    if (!user || !profile) return;
    try {
      if (item.status !== 'posted' && item.status !== 'ready_to_post') {
        await transitionReviewStatus(user.uid, item.id, 'ready_to_post');
      }
      const { copied } = await copyAndOpenCleanAmazonReview(item);
      setStatusNotice(
        copied
          ? `Copied review body for ${item.asin} & opened clean Amazon review page (Safe Zone: paste & submit manually).`
          : `Opened clean Amazon review page for ${item.asin}. Copy headline/body from Studio or popup and submit manually.`
      );
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Failed to open Amazon page.');
    }
  }

  async function handlePostCurrentToAmazon() {
    if (!user || !profile || !draftTitle.trim() || !draftBody.trim()) return;
    try {
      const itemId = await ensureActiveItemPersisted();
      const cleanAsin = normalizeAsin(asin);
      await saveDraftAndQuality(user.uid, itemId, {
        draftTitle: deDash(draftTitle),
        draftBody: deDash(draftBody),
        rating,
        qualityBand: qualityBand === 'none' ? 'good' : qualityBand,
        assessment,
        status: 'ready_to_post',
      });
      const targetItem: ReviewItem = {
        id: itemId,
        ownerId: user.uid,
        asin: cleanAsin,
        productTitle,
        marketplace,
        reviewUrl,
        rating,
        recommend,
        tone,
        length,
        draftTitle: deDash(draftTitle),
        draftBody: deDash(draftBody),
        qualityBand: qualityBand === 'none' ? 'good' : qualityBand,
        status: 'ready_to_post',
        source: 'manual',
      };
      const { copied } = await copyAndOpenCleanAmazonReview(targetItem);
      setStatusNotice(
        copied
          ? `Copied review body for ${cleanAsin} & opened clean Amazon review page (Safe Zone: paste & submit manually).`
          : `Opened clean Amazon review page for ${cleanAsin}. Paste headline/body and submit manually.`
      );
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Failed to open Amazon page.');
    }
  }

  // Batch Mode Runner with health preflight, token cap, item cap, anti-repetition, and polite pacing
  async function handleStartBatch() {
    if (!user || !profile || batchRunning) return;
    const maxItems = profile.maxBatchItems ?? 25;
    const tokenCap = profile.maxBatchTokens ?? 150000;
    const delayMs = profile.batchDelayMs ?? 2000;

    const queue = reviews
      .filter((r) => r.status === 'queued' || r.status === 'needs_review')
      .slice(0, maxItems);
    if (!queue.length) return;

    try {
      const healthRes = await fetch('/api/ai/health');
      if (healthRes.ok) {
        const health = await healthRes.json();
        if (health?.providers) setServerProviders(health.providers);
        if (activeEngine === 'anthropic' && !health?.providers?.anthropic) {
          setErrorNotice('ANTHROPIC_API_KEY is not set in server Secrets. Switch engine to Free Local ($0) or configure ANTHROPIC_API_KEY.');
          return;
        }
        if (activeEngine === 'gemini' && !health?.providers?.gemini) {
          setErrorNotice('GEMINI_API_KEY is not set in server Secrets. Switch engine to Free Local ($0) or configure GEMINI_API_KEY.');
          return;
        }
      }
    } catch {
      // continue; individual endpoint errors will report cleanly
    }

    stopBatchRef.current = false;
    setBatchRunning(true);
    setErrorNotice(null);
    let strongCount = 0;
    let totalTokens = 0;
    let failedCount = 0;
    const batchOpeners = [...recentDraftOpeners];

    try {
      for (let idx = 0; idx < queue.length; idx++) {
        if (stopBatchRef.current) break;
        if (totalTokens >= tokenCap) {
          setStatusNotice(
            `Batch auto-paused after ${idx} item(s): token guardrail (${tokenCap.toLocaleString()} tokens) reached. ${strongCount} Strong review(s) cached.`
          );
          return;
        }

        const item = queue[idx];
        setBatchProgress({
          current: idx + 1,
          total: queue.length,
          activeAsin: item.asin,
          tokensUsed: totalTokens,
          tokenCap,
        });

        try {
          let itemTokens = 0;
          let gen = await callGenerateApi({
            asin: item.asin,
            productTitle: item.productTitle,
            productDescription: item.productDescription || '',
            rating: item.rating || 5,
            liked: item.liked || '',
            disliked: item.disliked || '',
            usage: item.usage || '',
            notes: item.notes || '',
            recommend: item.recommend || 'unset',
            tone: item.tone || profile.defaultTone,
            length: item.length || profile.defaultLength,
            instructions: profile.customInstructions || '',
            batchMode: true,
            recentOpeners: batchOpeners,
          });
          itemTokens += gen.tokensUsed;

          let inspectRes = await callQualityApi({
            title: gen.title,
            body: gen.body,
            rating: item.rating || 5,
            asin: item.asin,
            productTitle: item.productTitle,
            productDescription: item.productDescription || '',
            notes: item.notes || '',
            batchMode: true,
            recentOpeners: batchOpeners,
          });
          itemTokens += Number(inspectRes?.usage?.totalTokens || 0);

          if (profile.autoRefineBelowStrong && inspectRes.band !== 'strong') {
            gen = await callRefineApi({
              asin: item.asin,
              productTitle: item.productTitle,
              productDescription: item.productDescription || '',
              rating: item.rating || 5,
              liked: item.liked || '',
              disliked: item.disliked || '',
              usage: item.usage || '',
              notes: item.notes || '',
              draftTitle: gen.title,
              draftBody: gen.body,
              assessment: inspectRes,
              recentOpeners: batchOpeners,
            });
            itemTokens += gen.tokensUsed;

            inspectRes = await callQualityApi({
              title: gen.title,
              body: gen.body,
              rating: item.rating || 5,
              asin: item.asin,
              productTitle: item.productTitle,
              productDescription: item.productDescription || '',
              notes: item.notes || '',
              batchMode: true,
              recentOpeners: batchOpeners,
            });
            itemTokens += Number(inspectRes?.usage?.totalTokens || 0);
          }

          totalTokens += itemTokens;
          batchOpeners.push(`${gen.title}: ${gen.body.slice(0, 90)}`);
          if (batchOpeners.length > 8) batchOpeners.shift();

          const isStrong = inspectRes.band === 'strong';
          if (isStrong) strongCount++;

          const nextStatus: ReviewStatus = isStrong
            ? profile.strongActionMode === 'direct_post'
              ? 'ready_to_post'
              : 'cached_strong'
            : 'needs_review';

          await saveDraftAndQuality(user.uid, item.id, {
            draftTitle: gen.title,
            draftBody: gen.body,
            rating: item.rating || 5,
            qualityBand: inspectRes.band,
            assessment: inspectRes,
            tokensUsed: itemTokens,
            status: nextStatus,
          });
        } catch (itemErr) {
          failedCount++;
          console.error(`Batch error on ${item.asin}:`, itemErr);
        }

        if (idx < queue.length - 1 && delayMs > 0 && !stopBatchRef.current) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      setStatusNotice(
        stopBatchRef.current
          ? `Batch paused. ${strongCount} Strong review(s) cached (${totalTokens.toLocaleString()} tokens).`
          : `Batch finished: processed ${queue.length} item(s), ${strongCount} Strong${failedCount ? `, ${failedCount} failed` : ''} (${totalTokens.toLocaleString()} tokens).`
      );
    } finally {
      setBatchRunning(false);
      setBatchProgress(null);
    }
  }

  async function handlePhotoUpload(files: FileList | null) {
    if (!files?.length) return;
    const added: StagedPhoto[] = [];
    for (const f of Array.from(files).slice(0, 6 - photos.length)) {
      try {
        const jpeg = await downscaleFileToJpeg(f);
        added.push(jpeg);
      } catch {
        // ignore unsupported file
      }
    }
    if (added.length) setPhotos((prev) => [...prev, ...added].slice(0, 6));
  }

  async function handleSaveCustomInstructions() {
    if (!user) return;
    await updateUserProfile(user.uid, { customInstructions });
    setStatusNotice('Saved custom reviewer instructions.');
  }

  const currentDraftSignature = JSON.stringify({
    title: draftTitle,
    body: draftBody,
    rating,
  });
  const isAssessmentStale = Boolean(assessment && currentDraftSignature !== checkedSignature);

  const queueItems = useMemo(
    () => reviews.filter((r) => r.status === 'queued' || r.status === 'needs_review'),
    [reviews]
  );
  const strongCachedCount = useMemo(
    () => reviews.filter((r) => r.status === 'cached_strong' || r.status === 'ready_to_post').length,
    [reviews]
  );
  const postedCount = useMemo(
    () => reviews.filter((r) => r.status === 'posted').length,
    [reviews]
  );

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Loading VineCraft Studio…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar Contract: Brand wordmark — 4 single-line nav links — 1 primary action */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 h-14 flex items-center justify-between gap-8 sticky top-0 z-30">
        <a
          href="#workspace"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('workspace');
          }}
          className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
        >
          VineCraft Studio
        </a>

        {user ? (
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            {(
              [
                ['workspace', 'Workspace'],
                ['batch', 'Batch Queue'],
                ['cache', 'Cached Strong'],
                ['bridge', 'Firefox Bridge'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveView(key)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  activeView === key
                    ? 'border-blue-600 text-slate-900 dark:text-slate-100'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        ) : (
          <div className="hidden md:block" />
        )}

        <div className="flex items-center gap-3 shrink-0">
          {user ? (
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="size-3.5" />
              Sign out
            </button>
          ) : (
            <button
              type="button"
              onClick={() => signInWithPopup(auth, googleProvider)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap shrink-0"
            >
              <LogIn className="size-3.5" />
              Sign in with Google
            </button>
          )}
        </div>
      </header>

      {!user ? (
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-2xl w-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-8 space-y-6">
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Amazon Vine Review Automation & Quality Inspection
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Generate guideline-compliant Vine reviews, automatically run the AI Quality Inspection check, and cache “Strong” reviews to your Firestore database for safe manual copy-paste into your normal Amazon browser session.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              <div className="space-y-1">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Auto-Inspect Pipeline
                </div>
                <p className="text-slate-500 dark:text-slate-400">
                  Every generated draft is immediately graded as Needs detail, Good, or Strong with guideline checks.
                </p>
              </div>
              <div className="space-y-1">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Strong Cache & Safe Copy
                </div>
                <p className="text-slate-500 dark:text-slate-400">
                  Auto-cache Strong reviews to DB and copy cleanly from Studio or the zero-script Firefox clipboard popup.
                </p>
              </div>
              <div className="space-y-1">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  100% Zero-Amazon-Touch
                </div>
                <p className="text-slate-500 dark:text-slate-400">
                  No scripts, click interception, or form auto-fill ever run on Amazon pages—staying safely human at all times.
                </p>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => signInWithPopup(auth, googleProvider)}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
              >
                <LogIn className="size-4" />
                Sign in with Google to Open Studio
              </button>
            </div>
          </div>
        </main>
      ) : (
        <div className="flex-1 flex flex-col md:flex-row max-w-[1440px] w-full mx-auto">
          {/* Left Workspace Rail */}
          <aside className="w-full md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-6">
            {/* Mobile view switcher */}
            <div className="flex md:hidden items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto">
              {(
                [
                  ['workspace', 'Studio'],
                  ['batch', 'Batch'],
                  ['cache', 'Cached'],
                  ['bridge', 'Bridge'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveView(key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                    activeView === key
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Pipeline Metrics */}
            <div className="grid grid-cols-3 gap-2 pb-4 border-b border-slate-100 dark:border-slate-800 text-center">
              <div>
                <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {queueItems.length}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Queued</div>
              </div>
              <div>
                <div className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {strongCachedCount}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Strong DB</div>
              </div>
              <div>
                <div className="text-lg font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                  {postedCount}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Posted</div>
              </div>
            </div>

            {/* Automation Configuration */}
            {profile && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Automation Settings
                  </h2>
                  <button
                    type="button"
                    onClick={() => setDarkMode((d) => !d)}
                    aria-label="Toggle color theme"
                    className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    {darkMode ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                  </button>
                </div>

                {/* Strong Action Mode */}
                <div className="space-y-1.5">
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    When Quality is “Strong”
                  </div>
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    <button
                      type="button"
                      onClick={() =>
                        updateUserProfile(user.uid, { strongActionMode: 'cache_and_next' })
                      }
                      className={`px-2 py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        profile.strongActionMode === 'cache_and_next'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Cache & Next
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateUserProfile(user.uid, { strongActionMode: 'direct_post' })
                      }
                      className={`px-2 py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        profile.strongActionMode === 'direct_post'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Stage Ready
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Safe-Zone mode: zero scripts, auto-clicks, or form-fill ever touch Amazon.
                  </p>
                </div>

                {/* Zero-Interaction AI Engine Preselect */}
                <div className="space-y-1.5">
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    AI Engine Preselect
                  </div>
                  <select
                    value={activeEngine}
                    onChange={(e) =>
                      updateUserProfile(user.uid, {
                        aiEnginePreset: e.target.value as AiEnginePreset,
                      })
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="gemini">
                      Built-in Gemini LLM {serverProviders.gemini ? '(Default)' : '(Needs Server Key)'}
                    </option>
                    <option value="anthropic">
                      Anthropic Claude {serverProviders.anthropic ? '' : '(Needs Server Key)'}
                    </option>
                    <option value="custom_endpoint">Ollama / Custom Endpoint ($0 Local)</option>
                    <option value="free_local">Offline Template Only (No LLM)</option>
                  </select>
                  {activeEngine === 'free_local' && serverProviders.gemini && (
                    <button
                      type="button"
                      onClick={() =>
                        updateUserProfile(user.uid, { aiEnginePreset: 'gemini' })
                      }
                      className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline text-left"
                    >
                      Offline Template active — switch to Built-in Gemini LLM for real AI writing
                    </button>
                  )}
                </div>

                <label className="flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <span>Auto-inspect on generate</span>
                  <input
                    type="checkbox"
                    checked={profile.autoInspectOnGenerate}
                    onChange={(e) =>
                      updateUserProfile(user.uid, { autoInspectOnGenerate: e.target.checked })
                    }
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </label>

                <label className="flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <span>Auto-refine if below Strong</span>
                  <input
                    type="checkbox"
                    checked={profile.autoRefineBelowStrong}
                    onChange={(e) =>
                      updateUserProfile(user.uid, { autoRefineBelowStrong: e.target.checked })
                    }
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </label>

                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setPromptsOpen(true)}
                    className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Eye className="size-3" />
                    Prompts
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen(true)}
                    className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <SlidersHorizontal className="size-3" />
                    Advanced
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setAdvancedOpen(true)}
                  className="w-full text-left px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      Learned Tone & Persona
                    </span>
                    <span
                      className={
                        learnedToneActive
                          ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                          : 'text-slate-400'
                      }
                    >
                      {learnedToneActive
                        ? `Active (${profile?.learnedFacts?.length || 0} facts)`
                        : profile?.learnedToneEnabled === false
                          ? 'Off'
                          : 'Distill'}
                    </span>
                  </div>
                </button>
              </div>
            )}

            {/* Queue Navigator */}
            <div className="space-y-2.5 pt-4 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Review Queue
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    clearEditorForNewItem();
                    setActiveView('workspace');
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
                >
                  <Plus className="size-3.5" />
                  New Item
                </button>
              </div>

              {queueItems.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                  Queue is empty. Add an item or import a batch.
                </p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                  {queueItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        loadItemIntoEditor(item);
                        setActiveView('workspace');
                      }}
                      className={`w-full text-left px-2.5 py-2 rounded-lg border text-xs transition-colors ${
                        activeId === item.id
                          ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40 text-slate-900 dark:text-slate-100'
                          : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {item.asin}
                        </span>
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          {item.qualityBand === 'none'
                            ? 'Queued'
                            : item.qualityBand === 'needs_detail'
                              ? 'Needs detail'
                              : item.qualityBand === 'good'
                                ? 'Good'
                                : 'Strong'}
                        </span>
                      </div>
                      <div className="truncate font-medium mt-0.5">{item.productTitle}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* Main Workspace */}
          <main className="flex-1 p-6 md:p-8 space-y-6 min-w-0">
            {(statusNotice || errorNotice) && (
              <div
                className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs ${
                  errorNotice
                    ? 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
                    : 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                }`}
              >
                <span>{errorNotice || statusNotice}</span>
                <button
                  type="button"
                  onClick={() => {
                    setStatusNotice(null);
                    setErrorNotice(null);
                  }}
                  aria-label="Dismiss notice"
                  className="p-0.5 hover:opacity-75"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            {activeView === 'workspace' && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                  <div>
                    <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      {activeId ? `Review Editor · ${asin}` : 'New Vine Review'}
                    </h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Generates review, runs AI quality check automatically, and executes your configured Strong rule (
                      {profile?.strongActionMode === 'direct_post'
                        ? 'Mark Ready for Safe Copy'
                        : 'Cache to DB & Advance'}
                      ).
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {activeId && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!user || !activeId) return;
                          await deleteReviewItem(user.uid, activeId);
                          clearEditorForNewItem();
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 whitespace-nowrap shrink-0"
                      >
                        <Trash2 className="size-3.5" />
                        Remove
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleGenerateAndInspect}
                      disabled={generating || !asin.trim() || (!productTitle.trim() && !productDescription.trim())}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Sparkles className="size-3.5" />
                      {generating ? 'Generating & Inspecting…' : 'Generate & Auto-Inspect'}
                    </button>
                  </div>
                </div>

                {/* Product & Experience Form */}
                <section className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                    <div className="md:col-span-3 space-y-1">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Amazon ASIN
                      </label>
                      <input
                        type="text"
                        value={asin}
                        onChange={(e) => setAsin(e.target.value.toUpperCase())}
                        placeholder="B0C1234567"
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="md:col-span-6 space-y-1">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Product Title
                      </label>
                      <input
                        type="text"
                        value={productTitle}
                        onChange={(e) => setProductTitle(e.target.value)}
                        placeholder="e.g. Anodized Aluminum Monitor Stand with USB-C Hub"
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="md:col-span-3 space-y-1">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Marketplace
                      </label>
                      <select
                        value={marketplace}
                        onChange={(e) => setMarketplace(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="amazon.com">amazon.com (US)</option>
                        <option value="amazon.ca">amazon.ca (CA)</option>
                        <option value="amazon.co.uk">amazon.co.uk (UK)</option>
                        <option value="amazon.de">amazon.de (DE)</option>
                        <option value="amazon.fr">amazon.fr (FR)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Listing Details / Specifications (optional)
                    </label>
                    <textarea
                      value={productDescription}
                      onChange={(e) => setProductDescription(e.target.value)}
                      rows={2}
                      placeholder="Paste key bullet points, dimensions, or materials from the product listing…"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Rating, Tone, Length, Recommend */}
                  <div className="flex flex-wrap items-center gap-6 pt-1">
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Star Rating
                      </div>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setRating(n)}
                            aria-label={`${n} stars`}
                            className="p-0.5 text-amber-500 hover:scale-105 transition-transform"
                          >
                            <Star
                              className="size-5"
                              fill={n <= rating ? 'currentColor' : 'none'}
                            />
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Tone
                      </div>
                      <select
                        value={tone}
                        onChange={(e) => setTone(e.target.value as ReviewTone)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      >
                        <option value="balanced">Balanced</option>
                        <option value="enthusiastic">Enthusiastic</option>
                        <option value="critical">Critical</option>
                        <option value="concise">Concise</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Length
                      </div>
                      <select
                        value={length}
                        onChange={(e) => setLength(e.target.value as ReviewLength)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      >
                        <option value="short">Short</option>
                        <option value="medium">Medium</option>
                        <option value="long">Long</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Recommend
                      </div>
                      <select
                        value={recommend}
                        onChange={(e) => setRecommend(e.target.value as RecommendChoice)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      >
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                        <option value="unset">Neutral</option>
                      </select>
                    </div>
                  </div>

                  {/* Experience Fields */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        What I liked
                      </label>
                      <input
                        type="text"
                        value={liked}
                        onChange={(e) => setLiked(e.target.value)}
                        placeholder="e.g. Solid hinge tension, matte finish resists fingerprints"
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        What I didn’t like
                      </label>
                      <input
                        type="text"
                        value={disliked}
                        onChange={(e) => setDisliked(e.target.value)}
                        placeholder="e.g. Included cable is slightly stiff"
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        How I used it
                      </label>
                      <input
                        type="text"
                        value={usage}
                        onChange={(e) => setUsage(e.target.value)}
                        placeholder="e.g. Daily 8-hour work setup with a 16-inch laptop"
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Extra notes
                      </label>
                      <input
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="e.g. Fits thicker cases, measurements match listing"
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  {/* Photos + Custom Voice Instructions */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0">
                        <ImagePlus className="size-3.5" />
                        Stage Photos (auto-JPEG)
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => handlePhotoUpload(e.target.files)}
                          className="hidden"
                        />
                      </label>
                      {photos.map((p) => (
                        <div key={p.id} className="relative size-10 rounded-md overflow-hidden border border-slate-200 dark:border-slate-700">
                          <img src={p.previewUrl} alt={p.name} className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))}
                            className="absolute top-0 right-0 bg-slate-900/80 text-white p-0.5"
                            aria-label="Remove photo"
                          >
                            <X className="size-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowInstructions((s) => !s)}
                      className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 whitespace-nowrap shrink-0"
                    >
                      {showInstructions ? 'Hide Voice Instructions' : 'Edit Custom Voice Instructions'}
                    </button>
                  </div>

                  {showInstructions && (
                    <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <textarea
                        value={customInstructions}
                        onChange={(e) => setCustomInstructions(e.target.value)}
                        rows={2}
                        placeholder="Persistent instructions applied to every generated review (e.g. avoid exclamation marks, always mention build materials)…"
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={handleSaveCustomInstructions}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                      >
                        Save Persistent Instructions
                      </button>
                    </div>
                  )}
                </section>

                {/* Generated Draft & Actions */}
                <section className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Review Draft
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(`${draftTitle}\n\n${draftBody}`.trim());
                          setCopiedDraft(true);
                          setTimeout(() => setCopiedDraft(false), 1500);
                        }}
                        disabled={!draftBody.trim()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        {copiedDraft ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                        {copiedDraft ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={handleCacheStrongAndNext}
                        disabled={!draftTitle.trim() || !draftBody.trim()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <Database className="size-3.5" />
                        Cache & Next
                        <ArrowRight className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={handlePostCurrentToAmazon}
                        disabled={!draftTitle.trim() || !draftBody.trim()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <Send className="size-3.5" />
                        Copy & Open Amazon
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(deDash(e.target.value))}
                      placeholder="Review headline…"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <textarea
                      value={draftBody}
                      onChange={(e) => setDraftBody(deDash(e.target.value))}
                      onPaste={(e) => {
                        if (draftTitle.trim() || draftBody.trim()) return;
                        const pasted = e.clipboardData?.getData('text/plain') || '';
                        const match = pasted.match(/^\s*(.+?)\s*\n\s*\n([\s\S]+)$/);
                        if (!match) return;
                        e.preventDefault();
                        setDraftTitle(deDash(match[1].replace(/^(headline|title)\s*[:—-]\s*/i, '').trim()));
                        setDraftBody(deDash(match[2].trim()));
                      }}
                      rows={7}
                      placeholder="Generated review body appears here (or paste Headline + blank line + Body from Claude/ChatGPT)…"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Zero-Cost External Web Assistant Handoff (ported from original extension) */}
                  {(() => {
                    const tpl =
                      serverPrompts?.originalExtensionPrompt ||
                      'Help me write my Amazon Vine review for {title} (ASIN: {asin}). Rating: {rating}/5. Liked: {liked}. Disliked: {disliked}. Usage: {usage}. Notes: {notes}.';
                    const fillVal = (s: string) => s.trim() || '—';
                    const handoffPrompt = `${tpl
                      .replaceAll('{rating}', String(rating || 5))
                      .replaceAll('{liked}', fillVal(liked))
                      .replaceAll('{disliked}', fillVal(disliked))
                      .replaceAll('{usage}', fillVal(usage))
                      .replaceAll('{notes}', fillVal(notes))
                      .replaceAll('{title}', fillVal(productTitle))
                      .replaceAll('{asin}', fillVal(asin))
                      .replaceAll('{description}', fillVal(productDescription))}${
                      learnedToneActive
                        ? `\n\nMy learned voice & context:\n${
                            profile?.learnedToneSummary ? `${profile.learnedToneSummary}\n` : ''
                          }${
                            profile?.learnedFacts?.length
                              ? `- ${profile.learnedFacts.slice(0, 8).join('\n- ')}`
                              : ''
                          }`
                        : ''
                    }${
                      customInstructions.trim()
                        ? `\n\nVoice rules: ${customInstructions.trim()}`
                        : ''
                    }`;
                    const copyHandoff = async () => {
                      await navigator.clipboard.writeText(handoffPrompt);
                      setCopiedHandoff(true);
                      setTimeout(() => setCopiedHandoff(false), 1800);
                    };
                    return (
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500 dark:text-slate-400">
                          Zero-Token Web Handoff (copies prompt & smart-pastes back):
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={copyHandoff}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                          >
                            {copiedHandoff ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                            {copiedHandoff ? 'Prompt Copied' : 'Copy Prompt'}
                          </button>
                          <a
                            href={`https://claude.ai/new?q=${encodeURIComponent(handoffPrompt.slice(0, 5500))}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={copyHandoff}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                          >
                            Claude.ai
                            <ExternalLink className="size-3" />
                          </a>
                          <a
                            href={`https://chatgpt.com/?q=${encodeURIComponent(handoffPrompt.slice(0, 5500))}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={copyHandoff}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                          >
                            ChatGPT
                            <ExternalLink className="size-3" />
                          </a>
                          <a
                            href="https://gemini.google.com/app"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={copyHandoff}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                          >
                            Gemini Web
                            <ExternalLink className="size-3" />
                          </a>
                        </div>
                      </div>
                    );
                  })()}
                </section>

                {/* Automatic AI Quality Inspection Panel */}
                <QualityInspectorPanel
                  band={qualityBand}
                  assessment={assessment}
                  inspecting={inspecting}
                  refining={refining}
                  stale={isAssessmentStale}
                  hasDraft={Boolean(draftTitle.trim() && draftBody.trim())}
                  onInspect={handleManualInspect}
                  onRefine={handleManualRefine}
                />
              </div>
            )}

            {activeView === 'batch' && (
              <BatchQueueView
                items={reviews}
                marketplace={profile?.amazonMarketplace || 'amazon.com'}
                batchRunning={batchRunning}
                batchProgress={batchProgress}
                maxBatchItems={profile?.maxBatchItems ?? 25}
                maxBatchTokens={profile?.maxBatchTokens ?? 150000}
                batchDelayMs={profile?.batchDelayMs ?? 2000}
                onUpdateBatchConfig={async (patch) => {
                  await updateUserProfile(user.uid, patch);
                }}
                onImportItems={async (batchItems) => {
                  await createReviewBatch(
                    user.uid,
                    batchItems,
                    profile?.amazonMarketplace || 'amazon.com',
                    profile?.defaultTone || 'balanced',
                    profile?.defaultLength || 'medium',
                    reviews
                  );
                }}
                onStartBatch={handleStartBatch}
                onStopBatch={() => {
                  stopBatchRef.current = true;
                }}
                onSelectItem={(item) => {
                  loadItemIntoEditor(item);
                  setActiveView('workspace');
                }}
                onDeleteItem={async (id) => {
                  await deleteReviewItem(user.uid, id);
                  if (activeId === id) clearEditorForNewItem();
                }}
              />
            )}

            {activeView === 'cache' && (
              <CachedStrongView
                items={reviews}
                onPostToAmazon={handlePostItemToAmazon}
                onMarkPosted={async (item) => {
                  await transitionReviewStatus(user.uid, item.id, 'posted');
                  setStatusNotice(`Marked ${item.asin} as Posted.`);
                }}
                onOpenInEditor={(item) => {
                  loadItemIntoEditor(item);
                  setActiveView('workspace');
                }}
              />
            )}

            {activeView === 'bridge' && (
              <FirefoxBridgeView
                bridgeKey={bridgeKey}
                readyDrafts={readyToPostDrafts}
              />
            )}
          </main>
        </div>
      )}

      <SystemPromptsModal
        open={promptsOpen}
        onClose={() => setPromptsOpen(false)}
        prompts={serverPrompts}
        customInstructions={customInstructions}
        overrideEnabled={overrideEnabled}
        qualityPromptOverride={profile?.qualitySystemPromptOverride || ''}
        learnedToneEnabled={profile?.learnedToneEnabled !== false}
        learnedToneSummary={profile?.learnedToneSummary || ''}
        learnedFacts={profile?.learnedFacts || []}
        learnedToneOverrideEnabled={Boolean(profile?.learnedToneOverrideEnabled)}
        onOpenAdvanced={() => setAdvancedOpen(true)}
      />

      {user && profile && (
        <AdvancedAiModal
          open={advancedOpen}
          onClose={() => setAdvancedOpen(false)}
          lockedQualityPrompt={serverPrompts?.lockedQualityPrompt || ''}
          aiEnginePreset={activeEngine}
          advancedOverrideEnabled={overrideEnabled}
          generationModel={profile.generationModel || ''}
          qualityModel={profile.qualityModel || ''}
          customEndpointUrl={profile.customEndpointUrl || ''}
          qualitySystemPromptOverride={profile.qualitySystemPromptOverride || ''}
          learnedToneEnabled={profile.learnedToneEnabled !== false}
          learnedToneSummary={profile.learnedToneSummary || ''}
          learnedFacts={profile.learnedFacts || []}
          learnedReviewsUsed={profile.learnedReviewsUsed || 0}
          learnedToneOverrideEnabled={Boolean(profile.learnedToneOverrideEnabled)}
          reviews={reviews}
          serverProviders={serverProviders}
          onSave={async (patch) => {
            await updateUserProfile(user.uid, patch);
            setStatusNotice('Saved Advanced AI engine, Learned Tone, and inspector configuration.');
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <VineCraftStudio />
    </ErrorBoundary>
  );
}
