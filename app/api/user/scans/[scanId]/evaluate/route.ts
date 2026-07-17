// POST /api/user/scans/[scanId]/evaluate
// Fresh image-based resale appraisal for the closet "Sell It" flow.
// Downloads the scan's stored photos, has Gemini re-identify the garment
// (brand labels included — the scan-time estimate never saw the images) and
// price the payout. Results are persisted onto the scan doc so the closet
// tile and sell flow reuse them without re-paying for the call.

import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db, adminStorage, storageBucketName } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { evaluateResaleFromImages } from '@/lib/google/gemini';
import type { ScanResult } from '@/types/garment';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EVAL_IMAGES = 3;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ scanId: string }> },
) {
  const { scanId } = await params;

  if (!UUID_RE.test(scanId)) {
    return Response.json({ error: 'Invalid scan ID format.' }, { status: 400 });
  }

  const ip = getClientIp(request);
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter ?? 60) } },
    );
  }

  const user = await verifyBearerToken(request);
  if (!user) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const scanRef = db()
      .collection('users')
      .doc(user.uid)
      .collection('scans')
      .doc(scanId);

    const scanSnap = await scanRef.get();
    if (!scanSnap.exists) {
      return Response.json({ error: 'Scan not found.' }, { status: 404 });
    }
    const scanData = scanSnap.data() as { result?: ScanResult };

    const [files] = await adminStorage()
      .bucket(storageBucketName())
      .getFiles({ prefix: `scans/${user.uid}/${scanId}/` });

    if (files.length === 0) {
      return Response.json(
        { error: 'No photos are saved for this garment, so it can’t be re-evaluated.' },
        { status: 409 },
      );
    }

    const images = await Promise.all(
      files.slice(0, MAX_EVAL_IMAGES).map(async (file) => {
        const [buffer] = await file.download();
        return { mimeType: 'image/jpeg', data: buffer.toString('base64') };
      }),
    );

    const evaluation = await evaluateResaleFromImages(images, scanData.result?.garment ?? null);

    // Persist what the photos taught us — the appraisal and any corrected
    // garment identity (e.g. a brand the OCR missed).
    const updates: Record<string, unknown> = {
      resaleEvaluatedAt: FieldValue.serverTimestamp(),
    };
    if (evaluation.resale) updates['result.cost.resale'] = evaluation.resale;
    if (evaluation.brand) updates['result.garment.brand'] = evaluation.brand;
    if (evaluation.category) updates['result.garment.category'] = evaluation.category;
    if (evaluation.color) updates['result.garment.color'] = evaluation.color;
    if (evaluation.condition) updates['result.garment.condition'] = evaluation.condition;
    await scanRef.update(updates);

    return Response.json({
      resale: evaluation.resale,
      garment: {
        brand: evaluation.brand,
        category: evaluation.category,
        color: evaluation.color,
        condition: evaluation.condition,
      },
    });
  } catch (err) {
    console.error('[scans evaluate] failed', {
      uid: user.uid,
      scanId,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Evaluation failed — please try again.' }, { status: 502 });
  }
}
