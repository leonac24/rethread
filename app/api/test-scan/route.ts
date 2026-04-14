import { NextRequest, NextResponse } from 'next/server';

import { scan } from '@/app/actions/scan';
import type { Garment } from '@/types/garment';

type TestScanRequestBody = {
  garment: Garment;
  lat?: number;
  lng?: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const body = (await request.json()) as Partial<TestScanRequestBody>;

    if (!body.garment || typeof body.garment !== 'object') {
      return NextResponse.json(
        {
          ok: false,
          error: 'Body must include a garment object.',
        },
        { status: 400 },
      );
    }

    const formData = new FormData();
    formData.set('garment_json', JSON.stringify(body.garment));

    if (isFiniteNumber(body.lat) && isFiniteNumber(body.lng)) {
      formData.set('lat', String(body.lat));
      formData.set('lng', String(body.lng));
    }

    const result = await scan(formData);

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    temporary: true,
    route: '/api/test-scan',
    method: 'POST',
    expectedBody: {
      garment: {
        fibers: [
          { material: 'cotton', percentage: 80 },
          { material: 'polyester', percentage: 20 },
        ],
        origin: 'Bangladesh',
        category: 't-shirt',
        brand: 'Example Brand',
      },
      lat: 40.7128,
      lng: -74.006,
    },
  });
}
