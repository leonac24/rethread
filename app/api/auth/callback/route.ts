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

  const userRef = db().collection('users').doc(user.uid);

  // merge: true — only sets missing fields, never overwrites existing totals
  await userRef.set(
    {
      email: user.email ?? '',
      joinedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const snapshot = await userRef.get();
  const data = snapshot.data() ?? {};

  return Response.json({
    uid: user.uid,
    displayName: data.displayName ?? null,
    avatarUrl: data.avatarUrl ?? null,
    totalCO2SavedKg: data.totalCO2SavedKg ?? 0,
    totalWaterSavedLiters: data.totalWaterSavedLiters ?? 0,
    actionCount: data.actionCount ?? 0,
  });
}
