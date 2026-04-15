import { describe, it, expect } from 'bun:test';
import { prioritizeRoutesByCondition } from '../../lib/route-utils';
import type { RouteOption, GarmentCondition } from '../../types/garment';

function makeRoutes(): [RouteOption, RouteOption, RouteOption] {
  return [
    { kind: 'repair', name: 'Repair Shop', address: '1 Main St', distance_km: 0.5, accepts_item: true },
    { kind: 'resale', name: 'Thrift Store', address: '2 Main St', distance_km: 1.0, accepts_item: true },
    { kind: 'donation', name: 'Donation Center', address: '3 Main St', distance_km: 1.5, accepts_item: null },
  ];
}

describe('prioritizeRoutesByCondition', () => {
  it('returns routes unchanged when condition is null', () => {
    const routes = makeRoutes();
    const result = prioritizeRoutesByCondition(routes, null);
    expect(result[0].kind).toBe('repair');
    expect(result[1].kind).toBe('resale');
    expect(result[2].kind).toBe('donation');
  });

  it('returns routes unchanged when condition is undefined', () => {
    const routes = makeRoutes();
    const result = prioritizeRoutesByCondition(routes, undefined);
    expect(result[0].kind).toBe('repair');
  });

  it('puts repair first for "poor" condition', () => {
    const routes = makeRoutes();
    const result = prioritizeRoutesByCondition(routes, 'poor');
    expect(result[0].kind).toBe('repair');
  });

  it('puts repair first for "fair" condition', () => {
    // Routes start with repair already at index 0 — test that it stays there
    const result = prioritizeRoutesByCondition(makeRoutes(), 'fair');
    expect(result[0].kind).toBe('repair');
  });

  it('puts resale first for "good" condition', () => {
    const result = prioritizeRoutesByCondition(makeRoutes(), 'good');
    expect(result[0].kind).toBe('resale');
    expect(result).toHaveLength(3);
  });

  it('puts resale first for "excellent" condition', () => {
    const result = prioritizeRoutesByCondition(makeRoutes(), 'excellent');
    expect(result[0].kind).toBe('resale');
  });

  it('preserves all 3 routes after reordering', () => {
    const result = prioritizeRoutesByCondition(makeRoutes(), 'good');
    const kinds = result.map((r) => r.kind).sort();
    expect(kinds).toEqual(['donation', 'repair', 'resale']);
  });

  it('does not mutate the original array', () => {
    const routes = makeRoutes();
    const original0 = routes[0].kind;
    prioritizeRoutesByCondition(routes, 'good');
    expect(routes[0].kind).toBe(original0);
  });

  it('handles routes already in optimal order (no-op for poor with repair first)', () => {
    // repair is already at index 0, nothing should move
    const routes = makeRoutes(); // repair first
    const result = prioritizeRoutesByCondition(routes, 'poor');
    expect(result[0].kind).toBe('repair');
    expect(result[1].kind).toBe('resale');
    expect(result[2].kind).toBe('donation');
  });

  it('handles routes with resale already first for good condition (no-op)', () => {
    const routes: [RouteOption, RouteOption, RouteOption] = [
      { kind: 'resale', name: 'Thrift', address: '', distance_km: 0, accepts_item: true },
      { kind: 'repair', name: 'Tailor', address: '', distance_km: 0, accepts_item: true },
      { kind: 'donation', name: 'Charity', address: '', distance_km: 0, accepts_item: null },
    ];
    const result = prioritizeRoutesByCondition(routes, 'good');
    expect(result[0].kind).toBe('resale');
  });
});
