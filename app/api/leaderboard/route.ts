// GET /api/leaderboard
// Top 10 users by CO2 saved. Exposes display name + aggregated totals only —
// uid and email are never included.

import { db } from '@/lib/firebase/admin';

export async function GET() {
  const snapshot = await db()
    .collection('users')
    .orderBy('totalCO2SavedKg', 'desc')
    .limit(10)
    .get();

  const leaderboard = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      displayName: data.displayName ?? 'Anonymous',
      totalCO2SavedKg: data.totalCO2SavedKg ?? 0,
      totalWaterSavedLiters: data.totalWaterSavedLiters ?? 0,
      actionCount: data.actionCount ?? 0,
    };
  });

  return Response.json(
    { leaderboard },
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
  );
}
