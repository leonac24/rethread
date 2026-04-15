// GET /api/user/me
// Returns the authenticated user's profile and environmental impact totals.
// Email is never included in the response.

import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';

export async function GET(request: Request) {
  const user = await verifyBearerToken(request);
  if (!user) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const snapshot = await db().collection('users').doc(user.uid).get();
    if (!snapshot.exists) {
      return Response.json(
        { error: 'User not found. Call /api/auth/callback first.' },
        { status: 404 },
      );
    }

    const data = snapshot.data()!;

    return Response.json({
      uid: user.uid,
      displayName: data.displayName ?? null,
      avatarUrl: data.avatarUrl ?? null,
      totalCO2SavedKg: data.totalCO2SavedKg ?? 0,
      totalWaterSavedLiters: data.totalWaterSavedLiters ?? 0,
      actionCount: data.actionCount ?? 0,
      joinedAt: data.joinedAt?.toMillis() ?? null,
    });
  } catch (err) {
    console.error('[user/me] Firestore error', { uid: user.uid, err: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to retrieve user profile.' }, { status: 503 });
  }
}
