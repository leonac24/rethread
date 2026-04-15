// POST /api/auth/callback
// Called by the client after Google sign-in with a Firebase ID token.
// Verifies the token server-side, upserts the user doc in Firestore,
// and returns the user's profile + environmental totals.

import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(request: Request) {
  const user = await verifyBearerToken(request);
  if (!user) {
    return Response.json({ error: 'Invalid or expired token.' }, { status: 401 });
  }

  try {
    const userRef = db().collection('users').doc(user.uid);
    const snapshot = await userRef.get();

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
      });
    } else {
      // Returning user — only update email in case it changed, never touch joinedAt
      await userRef.set({ email: user.email ?? '' }, { merge: true });
    }

    const fresh = snapshot.exists ? snapshot : await userRef.get();
    const data = fresh.data() ?? {};

    return Response.json({
      uid: user.uid,
      displayName: data.displayName ?? null,
      avatarUrl: data.avatarUrl ?? null,
      totalCO2SavedKg: data.totalCO2SavedKg ?? 0,
      totalWaterSavedLiters: data.totalWaterSavedLiters ?? 0,
      actionCount: data.actionCount ?? 0,
    });
  } catch (err) {
    console.error('[auth/callback] Firestore error', { uid: user.uid, err: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to initialize user profile.' }, { status: 503 });
  }
}
