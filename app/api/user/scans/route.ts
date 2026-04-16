import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import type { OutcomeAction, ScanResult } from '@/types/garment';

export async function GET(request: Request) {
  const user = await verifyBearerToken(request);
  if (!user) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const snapshot = await db()
      .collection('users')
      .doc(user.uid)
      .collection('scans')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const scans = snapshot.docs.map((doc) => {
      const data = doc.data() as {
        scanId: string;
        action: OutcomeAction;
        result: ScanResult;
        createdAt?: FirebaseFirestore.Timestamp;
      };
      return {
        scanId: data.scanId,
        action: data.action,
        result: data.result,
        createdAt: data.createdAt?.toMillis() ?? 0,
      };
    });

    return Response.json({ scans });
  } catch (err) {
    console.error('[user/scans] Firestore error', {
      uid: user.uid,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to retrieve scans.' }, { status: 500 });
  }
}
