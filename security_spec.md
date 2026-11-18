# VineCraft Studio Security Specification (Phase 0)

## 1. Data Invariants
1. A `UserProfile` at `/users/{userId}` can only be read or written by the verified authenticated user whose `request.auth.uid == userId`.
2. A `ReviewItem` at `/users/{userId}/reviews/{reviewId}` belongs strictly to `{userId}` (`ownerId == userId`), requires the parent `/users/{userId}` document to exist (Master Gate), and cannot change `ownerId`, `asin`, `source`, or `createdAt` after creation.
3. Timestamps (`createdAt`, `updatedAt`) must equal server `request.time`.
4. All document IDs (`userId`, `reviewId`) must satisfy `^[a-zA-Z0-9_\-]+$` and length `<= 128`.
5. Once a `ReviewItem` reaches terminal `status == 'posted'`, no further updates are permitted.

## 2. Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated read/write**: Read `/users/u1/reviews/r1` without `request.auth`.
2. **Unverified email write**: Create `/users/u1` with `email_verified: false`.
3. **Cross-tenant read/list**: User `u2` reads or lists `/users/u1/reviews`.
4. **Identity spoofing on create**: User `u1` creates `/users/u1/reviews/r1` with `ownerId: "u2"`.
5. **Shadow / ghost field injection**: User `u1` creates `/users/u1` with extra field `isAdmin: true`.
6. **ID poisoning**: User `u1` creates `/users/u1/reviews/` with an oversized or invalid character ID (`"a".repeat(200)`).
7. **Timestamp forgery**: User `u1` creates `/users/u1/reviews/r1` with a client-forged `createdAt` instead of `request.time`.
8. **Invalid ASIN injection**: User `u1` creates a `ReviewItem` with `asin: "bad<script>"`.
9. **Denial-of-Wallet oversized body**: User `u1` writes a `draftBody` exceeding `20000` chars.
10. **Unbounded array injection**: User `u1` writes `qualityStrengths` with 50 elements (`> 20`).
11. **Terminal state mutation**: User `u1` updates a `ReviewItem` whose existing `status == 'posted'`.
12. **Immutable field mutation**: User `u1` updates `asin` or `createdAt` on an existing `ReviewItem`.
