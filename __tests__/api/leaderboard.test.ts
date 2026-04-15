import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── Mock Firestore ───────────────────────────────────────────────────────────

const mockGet = mock(async () => ({ docs: [] }));
const mockLimit = mock(() => ({ get: mockGet }));
const mockOrderBy = mock(() => ({ limit: mockLimit }));
const mockCollection = mock(() => ({ orderBy: mockOrderBy }));
const mockDb = mock(() => ({ collection: mockCollection }));

mock.module('../../lib/firebase/admin', () => ({ db: mockDb }));

const { GET } = await import('../../app/api/leaderboard/route');

describe('GET /api/leaderboard', () => {
  beforeEach(() => {
    mockGet.mockImplementation(async () => ({ docs: [] }));
  });

  it('returns 200 with an empty leaderboard when no users', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leaderboard).toEqual([]);
  });

  it('returns leaderboard entries with correct shape', async () => {
    mockGet.mockImplementation(async () => ({
      docs: [
        {
          data: () => ({
            displayName: 'Alice',
            totalCO2SavedKg: 12.5,
            totalWaterSavedLiters: 5400,
            actionCount: 3,
          }),
        },
        {
          data: () => ({
            displayName: 'Bob',
            totalCO2SavedKg: 8.0,
            totalWaterSavedLiters: 2700,
            actionCount: 1,
          }),
        },
      ],
    }));

    const res = await GET();
    const body = await res.json();
    expect(body.leaderboard).toHaveLength(2);
    expect(body.leaderboard[0].displayName).toBe('Alice');
    expect(body.leaderboard[0].totalCO2SavedKg).toBe(12.5);
    expect(body.leaderboard[1].displayName).toBe('Bob');
  });

  it('falls back to "Anonymous" when displayName is missing', async () => {
    mockGet.mockImplementation(async () => ({
      docs: [{ data: () => ({ totalCO2SavedKg: 5, totalWaterSavedLiters: 1000, actionCount: 1 }) }],
    }));

    const res = await GET();
    const body = await res.json();
    expect(body.leaderboard[0].displayName).toBe('Anonymous');
  });

  it('never exposes uid or email in response', async () => {
    mockGet.mockImplementation(async () => ({
      docs: [
        {
          data: () => ({
            uid: 'secret-uid',
            email: 'user@example.com',
            displayName: 'Charlie',
            totalCO2SavedKg: 1,
            totalWaterSavedLiters: 100,
            actionCount: 1,
          }),
        },
      ],
    }));

    const res = await GET();
    const body = await res.json();
    expect(body.leaderboard[0].uid).toBeUndefined();
    expect(body.leaderboard[0].email).toBeUndefined();
  });

  it('sets Cache-Control header for public caching', async () => {
    const res = await GET();
    expect(res.headers.get('Cache-Control')).toContain('max-age=60');
  });

  it('returns 503 when Firestore throws', async () => {
    mockGet.mockImplementation(async () => { throw new Error('Firestore unavailable'); });
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/unavailable/i);
  });
});
