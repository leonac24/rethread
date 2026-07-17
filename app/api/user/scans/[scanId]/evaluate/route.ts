// POST /api/user/scans/[scanId]/evaluate
// Fresh image-based appraisal for the closet "Sell It" flow.
// Downloads the scan's stored photos and runs the same Gemini super call as
// scan time — identification, dye/disposal, landfill, and resale payout — then
// persists the WHOLE refreshed result (garment identity, eco cost recomputed
// from the corrected fibers, landfill impact, FTI, appraisal) onto the scan
// doc. The breakdown a user sees always matches the appraised garment, and
// the paid Gemini call is never repeated.

import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db, adminStorage, storageBucketName } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { analyzeGarment } from '@/lib/google/gemini';
import { computeFiberImpact } from '@/lib/fiber-impact';
import { getFashionTransparencyScore } from '@/lib/wikirate';
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
    const prevGarment = scanData.result?.garment ?? null;

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

    const analysis = await analyzeGarment(images, { knownGarment: prevGarment });

    // Prefer what the photos taught us; keep prior values where the photos
    // were silent (e.g. fibers when no care label was captured).
    const fibers = analysis.garment.fibers.length ? analysis.garment.fibers : prevGarment?.fibers ?? [];
    const category = analysis.garment.category ?? prevGarment?.category ?? null;
    const brand = analysis.garment.brand ?? prevGarment?.brand ?? null;

    // Eco cost is recomputed from the corrected identity so the garment
    // breakdown and the appraisal always describe the same item.
    const { water_liters, co2_kg } = computeFiberImpact(fibers, category);
    const cost = {
      water_liters,
      co2_kg,
      ...analysis.cost,
      ...(analysis.resale ? { resale: analysis.resale } : {}),
    };

    const fti = await getFashionTransparencyScore(brand ?? '').catch(() => null);

    const updates: Record<string, unknown> = {
      resaleEvaluatedAt: FieldValue.serverTimestamp(),
      'result.cost': cost,
      'result.landfill_impact': analysis.landfill,
    };
    if (analysis.garment.brand) updates['result.garment.brand'] = analysis.garment.brand;
    if (analysis.garment.category) updates['result.garment.category'] = analysis.garment.category;
    if (analysis.garment.color) updates['result.garment.color'] = analysis.garment.color;
    if (analysis.garment.condition) updates['result.garment.condition'] = analysis.garment.condition;
    if (analysis.garment.origin) updates['result.garment.origin'] = analysis.garment.origin;
    if (analysis.garment.fibers.length) {
      updates['result.garment.fibers'] = analysis.garment.fibers;
      updates['result.garment.fibers_estimated'] = analysis.garment.fibers_estimated;
    }
    if (fti) updates['result.fti'] = fti;
    await scanRef.update(updates);

    return Response.json({
      resale: analysis.resale,
      garment: {
        brand: analysis.garment.brand,
        category: analysis.garment.category,
        color: analysis.garment.color,
        condition: analysis.garment.condition,
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
