'use server';

import { readClothingLabel } from '@/lib/google/vision';
import type { ScanResult } from '@/types/garment';

function buildFallbackResult(garment: ScanResult['garment']): ScanResult {
  return {
    id: crypto.randomUUID(),
    garment,
    cost: {
      water_liters: 0,
      co2_kg: 0,
      dye_pollution_score: 0,
      confidence: 'low',
      reasoning: 'Environmental cost stage is not connected yet.',
      disposal_co2_kg: 0,
      disposal_landfill_years: 0,
      disposal_note: 'Disposal impact unavailable.',
    },
    routes: [
      {
        kind: 'repair',
        name: 'No route selected yet',
        address: 'TBD',
        distance_km: 0,
        accepts_item: null,
      },
      {
        kind: 'resale',
        name: 'No route selected yet',
        address: 'TBD',
        distance_km: 0,
        accepts_item: null,
      },
      {
        kind: 'donation',
        name: 'No route selected yet',
        address: 'TBD',
        distance_km: 0,
        accepts_item: null,
      },
    ],
  };
}

export async function scan(formData: FormData): Promise<ScanResult> {
  const file = formData.get('photo');

  if (!(file instanceof File)) {
    throw new Error('Missing image file in form field "photo"');
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('Uploaded file must be an image');
  }

  const bytes = await file.arrayBuffer();
  const imageBuffer = Buffer.from(bytes);
  const parsed = await readClothingLabel(imageBuffer);

  const garment: ScanResult['garment'] = {
    fibers: parsed.fibers ?? [],
    origin: parsed.origin ?? null,
    category: parsed.category ?? null,
    ...(parsed.brand ? { brand: parsed.brand } : {}),
  };

  return buildFallbackResult(garment);
}

export async function scanFromForm(
  _previous: ScanResult | null,
  formData: FormData,
): Promise<ScanResult> {
  return scan(formData);
}
