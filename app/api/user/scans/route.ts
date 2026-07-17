import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import { repairLegacyImageUrls } from '@/lib/firebase/repair-image-urls';
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

    const scans = await Promise.all(snapshot.docs.map(async (doc) => {
      const data = doc.data() as {
        scanId: string;
        action: OutcomeAction;
        result: ScanResult;
        createdAt?: FirebaseFirestore.Timestamp;
        imageUrls?: string[];
        listingId?: string;
        listingStatus?: string;
        listingOfferCount?: number;
        resaleEvaluatedAt?: FirebaseFirestore.Timestamp;
      };

      // Lazy one-time repair of legacy tokenized URLs (402 on Spark plan).
      let imageUrls = data.imageUrls ?? [];
      try {
        const repaired = await repairLegacyImageUrls(imageUrls);
        if (repaired) {
          imageUrls = repaired;
          await doc.ref.update({ imageUrls: repaired });
        }
      } catch {
        // Repair is best-effort; the scan itself still renders.
      }

      return {
        scanId: data.scanId,
        action: data.action,
        result: data.result,
        createdAt: data.createdAt?.toMillis() ?? 0,
        imageUrls,
        listingId: data.listingId ?? null,
        listingStatus: data.listingStatus ?? null,
        listingOfferCount: data.listingOfferCount ?? 0,
        resaleEvaluatedAt: data.resaleEvaluatedAt?.toMillis() ?? null,
      };
    }));

    return Response.json({ scans });
  } catch (err) {
    console.error('[user/scans] Firestore error', {
      uid: user.uid,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to retrieve scans.' }, { status: 500 });
  }
}
