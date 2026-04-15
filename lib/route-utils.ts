// Pure utility functions for route manipulation.
// Extracted here so they can be unit tested without pulling in the full scan pipeline.

import type { GarmentCondition, RouteOption } from '@/types/garment';

// Reorders a [repair, resale, donation] tuple so the most contextually
// relevant option appears first based on garment condition.
//
// poor | fair  → repair first  (item needs fixing before resale/donation)
// good | excellent → resale first (item is sellable as-is)
// null/undefined → preserve original Places API ordering
export function prioritizeRoutesByCondition(
  routes: [RouteOption, RouteOption, RouteOption],
  condition: GarmentCondition | null | undefined,
): [RouteOption, RouteOption, RouteOption] {
  if (!condition) return routes;
  const sorted = [...routes] as [RouteOption, RouteOption, RouteOption];
  const targetKind = condition === 'poor' || condition === 'fair' ? 'repair' : 'resale';
  const idx = sorted.findIndex((r) => r.kind === targetKind);
  if (idx > 0) {
    const [target] = sorted.splice(idx, 1);
    sorted.unshift(target);
  }
  return sorted as [RouteOption, RouteOption, RouteOption];
}
