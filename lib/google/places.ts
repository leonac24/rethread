import type { RouteOption } from '@/types/garment';

// Maps + Places — nearest repair / resale / donation for the garment.

export async function findRoutes(
  _lat: number,
  _lng: number,
  _category: string,
): Promise<[RouteOption, RouteOption, RouteOption]> {
  throw new Error('Not implemented');
}
