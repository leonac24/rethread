// POST /api/auth/callback
// Called by the client after Google sign-in with a Firebase ID token.
// Verifies the token server-side, upserts the user doc in Firestore,
// and returns the user's profile + environmental totals.
// Optionally accepts a retailer signup payload that puts the user in the
// manual approval queue (`retailer.status: 'pending'`).

import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { geocodeAddress } from '@/lib/google/places';
import type { RetailerStatus } from '@/types/marketplace';

const ZIP_RE = /^\d{5}(-\d{4})?$/;
const RETAILER_FIELDS = ['storeName', 'street1', 'city', 'state', 'zip', 'phone'] as const;

type RetailerInput = Record<(typeof RETAILER_FIELDS)[number], string>;

// All six fields required, non-empty strings of at most 120 chars; zip must be
// a valid US zip. Returns null when the payload is invalid.
function parseRetailerInput(value: unknown): RetailerInput | null {
  if (typeof value !== 'object' || value === null) return null;

  const out = {} as RetailerInput;
  for (const field of RETAILER_FIELDS) {
    const raw = (value as Record<string, unknown>)[field];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 120) return null;
    out[field] = trimmed;
  }

  if (!ZIP_RE.test(out.zip)) return null;
  return out;
}

export async function POST(request: Request) {
  const user = await verifyBearerToken(request);
  if (!user) {
    return Response.json({ error: 'Invalid or expired token.' }, { status: 401 });
  }

  // Body is optional — only retailer signups send one.
  const body = (await request.json().catch(() => null)) as { retailer?: unknown } | null;
  let retailerInput: RetailerInput | null = null;
  if (body !== null && typeof body === 'object' && body.retailer !== undefined) {
    retailerInput = parseRetailerInput(body.retailer);
    if (!retailerInput) {
      return Response.json({ error: 'Invalid retailer details.' }, { status: 400 });
    }
  }

  try {
    const userRef = db().collection('users').doc(user.uid);
    const snapshot = await userRef.get();
    const existing = snapshot.exists ? (snapshot.data() ?? {}) : {};

    // Never downgrade an approved retailer — ignore any re-submitted payload.
    const alreadyApproved = existing.retailer?.status === 'approved';

    let retailerWrite: Record<string, unknown> | null = null;
    if (retailerInput && !alreadyApproved) {
      const { storeName, street1, city, state, zip, phone } = retailerInput;
      const coords = await geocodeAddress(`${street1}, ${city}, ${state} ${zip}`);
      retailerWrite = {
        role: 'retailer',
        retailer: {
          storeName,
          street1,
          city,
          state,
          zip,
          phone,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          status: 'pending',
          appliedAt: FieldValue.serverTimestamp(),
        },
      };
    }

    if (!snapshot.exists) {
      // First sign-in — create the document with joinedAt set once
      await userRef.set({
        email: user.email ?? '',
        displayName: null,
        avatarUrl: null,
        totalCO2SavedKg: 0,
        totalWaterSavedLiters: 0,
        actionCount: 0,
        joinedAt: FieldValue.serverTimestamp(),
        ...(retailerWrite ?? {}),
      });
    } else {
      // Returning user — only update email in case it changed, never touch joinedAt
      await userRef.set({ email: user.email ?? '', ...(retailerWrite ?? {}) }, { merge: true });
    }

    const data = snapshot.exists ? (snapshot.data() ?? {}) : {};
    const retailer = (retailerWrite?.retailer ?? data.retailer ?? null) as {
      storeName?: string;
      status?: RetailerStatus;
    } | null;
    const role: 'user' | 'retailer' =
      retailerWrite || data.role === 'retailer' ? 'retailer' : 'user';

    return Response.json({
      uid: user.uid,
      displayName: data.displayName ?? null,
      avatarUrl: data.avatarUrl ?? null,
      totalCO2SavedKg: data.totalCO2SavedKg ?? 0,
      totalWaterSavedLiters: data.totalWaterSavedLiters ?? 0,
      actionCount: data.actionCount ?? 0,
      role,
      retailerStatus: retailer?.status ?? null,
      storeName: retailer?.storeName ?? null,
    });
  } catch (err) {
    console.error('[auth/callback] Firestore error', { uid: user.uid, err: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to initialize user profile.' }, { status: 503 });
  }
}
