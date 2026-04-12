import { NextResponse } from 'next/server';
import { findRoutes } from '@/lib/google/places';

// Dev-only sanity check for lib/google/places.ts.
// GET /api/test-routes?lat=40.7484&lng=-73.9857&category=top
// Defaults to Empire State Building if lat/lng omitted.

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get('lat') ?? '40.7484');
  const lng = Number(searchParams.get('lng') ?? '-73.9857');
  const category = searchParams.get('category');

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json(
      { error: 'lat and lng must be numbers' },
      { status: 400 },
    );
  }

  try {
    const routes = await findRoutes(lat, lng, category);
    return NextResponse.json({ lat, lng, category, routes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
