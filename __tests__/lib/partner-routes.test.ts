import { describe, it, expect } from 'bun:test';
import { applyVerifiedPartners, PARTNER_RADIUS_KM } from '../../lib/partner-routes';
import type { RouteOption } from '../../types/garment';
import type { PartnerRecord } from '../../types/partner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRoutes(): [RouteOption, RouteOption, RouteOption] {
  return [
    { kind: 'repair', name: 'Repair Shop', address: '1 Main St', distance_km: 0.5, accepts_item: true },
    { kind: 'resale', name: 'Thrift Store', address: '2 Main St', distance_km: 1.0, accepts_item: true },
    { kind: 'donation', name: 'Donation Center', address: '3 Main St', distance_km: 1.5, accepts_item: null },
  ];
}

type PartnerWithId = { id: string } & PartnerRecord;

function makePartner(overrides: Partial<PartnerWithId> & { id: string }): PartnerWithId {
  return {
    id: overrides.id,
    kind: 'partner',
    businessName: 'Test Partner',
    type: 'repair',
    address: '10 Partner Ave',
    lat: 40.7128,
    lng: -74.006,
    discountPct: 10,
    status: 'verified',
    evidence: { links: [], text: '' },
    appliedAt: Date.now(),
    ...overrides,
  };
}

// Base coords: New York City
const BASE_LAT = 40.7128;
const BASE_LNG = -74.006;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PARTNER_RADIUS_KM', () => {
  it('is 25', () => {
    expect(PARTNER_RADIUS_KM).toBe(25);
  });
});

describe('applyVerifiedPartners', () => {
  it('replaces only the matching route kind', () => {
    const routes = makeRoutes();
    const partners: PartnerWithId[] = [
      makePartner({ id: 'p1', type: 'repair', businessName: 'Local Tailor', lat: 40.713, lng: -74.007 }),
    ];

    const result = applyVerifiedPartners(routes, partners, BASE_LAT, BASE_LNG);

    expect(result.find((r) => r.kind === 'repair')?.verified).toBe(true);
    expect(result.find((r) => r.kind === 'repair')?.partnerId).toBe('p1');
    expect(result.find((r) => r.kind === 'resale')?.verified).toBeUndefined();
    expect(result.find((r) => r.kind === 'donation')?.verified).toBeUndefined();
  });

  it('ignores partners beyond 25km radius', () => {
    const routes = makeRoutes();
    // ~26km from BASE coords (roughly 0.234 degrees lat away)
    const partners: PartnerWithId[] = [
      makePartner({ id: 'p-far', type: 'repair', businessName: 'Far Tailor', lat: 40.9472, lng: -74.006 }),
    ];

    const result = applyVerifiedPartners(routes, partners, BASE_LAT, BASE_LNG);

    expect(result.find((r) => r.kind === 'repair')?.verified).toBeUndefined();
    expect(result.find((r) => r.kind === 'repair')?.name).toBe('Repair Shop');
  });

  it('picks the nearest partner when two are within radius', () => {
    const routes = makeRoutes();
    const partners: PartnerWithId[] = [
      makePartner({ id: 'p-near', type: 'repair', businessName: 'Close Tailor', lat: 40.714, lng: -74.007 }),
      makePartner({ id: 'p-medium', type: 'repair', businessName: 'Medium Tailor', lat: 40.75, lng: -74.006 }),
    ];

    const result = applyVerifiedPartners(routes, partners, BASE_LAT, BASE_LNG);
    const repairRoute = result.find((r) => r.kind === 'repair');

    expect(repairRoute?.partnerId).toBe('p-near');
    expect(repairRoute?.name).toBe('Close Tailor');
  });

  it("maps partner type 'recycler' to route kind 'donation'", () => {
    const routes = makeRoutes();
    const partners: PartnerWithId[] = [
      makePartner({ id: 'p-recycler', type: 'recycler', businessName: 'Green Recycler', lat: 40.713, lng: -74.007 }),
    ];

    const result = applyVerifiedPartners(routes, partners, BASE_LAT, BASE_LNG);
    const donationRoute = result.find((r) => r.kind === 'donation');

    expect(donationRoute?.verified).toBe(true);
    expect(donationRoute?.partnerId).toBe('p-recycler');
    expect(donationRoute?.name).toBe('Green Recycler');
  });

  it('skips partners missing lat/lng', () => {
    const routes = makeRoutes();
    const partners: PartnerWithId[] = [
      makePartner({ id: 'p-noloc', type: 'repair', lat: undefined, lng: undefined }),
    ];

    const result = applyVerifiedPartners(routes, partners, BASE_LAT, BASE_LNG);

    expect(result.find((r) => r.kind === 'repair')?.verified).toBeUndefined();
    expect(result.find((r) => r.kind === 'repair')?.name).toBe('Repair Shop');
  });

  it('does not mutate the input routes array', () => {
    const routes = makeRoutes();
    const routesCopy = JSON.parse(JSON.stringify(routes)) as typeof routes;
    const partners: PartnerWithId[] = [
      makePartner({ id: 'p1', type: 'repair', lat: 40.713, lng: -74.007 }),
    ];

    applyVerifiedPartners(routes, partners, BASE_LAT, BASE_LNG);

    expect(routes).toEqual(routesCopy);
  });

  it('does not mutate the input partners array', () => {
    const routes = makeRoutes();
    const partners: PartnerWithId[] = [
      makePartner({ id: 'p1', type: 'repair', lat: 40.713, lng: -74.007 }),
    ];
    const partnersCopy = JSON.parse(JSON.stringify(partners)) as typeof partners;

    applyVerifiedPartners(routes, partners, BASE_LAT, BASE_LNG);

    expect(partners).toEqual(partnersCopy);
  });

  it('returns routes unchanged when no partners provided', () => {
    const routes = makeRoutes();
    const result = applyVerifiedPartners(routes, [], BASE_LAT, BASE_LNG);

    expect(result[0]).toEqual(routes[0]);
    expect(result[1]).toEqual(routes[1]);
    expect(result[2]).toEqual(routes[2]);
  });
});
