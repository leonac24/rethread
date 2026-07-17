import { describe, it, expect, mock, beforeEach } from 'bun:test';

let publicCalls: string[] = [];
let makePublicFails = false;

mock.module('../../lib/firebase/admin', () => ({
  db: () => ({}),
  adminStorage: () => ({
    bucket: (_name?: string) => ({
      name: 'demo-bucket',
      file: (path: string) => ({
        makePublic: async () => {
          if (makePublicFails) throw new Error('blocked');
          publicCalls.push(path);
        },
      }),
    }),
  }),
  storageBucketName: () => 'demo-bucket',
}));

const { legacyStoragePath, repairLegacyImageUrls } = await import('../../lib/firebase/repair-image-urls');

const LEGACY_URL =
  'https://firebasestorage.googleapis.com/v0/b/demo-bucket/o/scans%2Fuid-1%2Fscan-1%2F0.jpg?alt=media&token=abc';
const PUBLIC_URL = 'https://storage.googleapis.com/demo-bucket/scans/uid-1/scan-1/0.jpg';

beforeEach(() => {
  publicCalls = [];
  makePublicFails = false;
});

describe('legacyStoragePath', () => {
  it('decodes the object path from a tokenized download URL', () => {
    expect(legacyStoragePath(LEGACY_URL)).toBe('scans/uid-1/scan-1/0.jpg');
  });

  it('returns null for non-legacy URLs', () => {
    expect(legacyStoragePath(PUBLIC_URL)).toBeNull();
    expect(legacyStoragePath('https://example.com/x.jpg')).toBeNull();
  });
});

describe('repairLegacyImageUrls', () => {
  it('returns null when nothing is legacy', async () => {
    expect(await repairLegacyImageUrls([PUBLIC_URL])).toBeNull();
    expect(publicCalls).toHaveLength(0);
  });

  it('makes legacy files public and rewrites their URLs', async () => {
    const repaired = await repairLegacyImageUrls([LEGACY_URL, PUBLIC_URL]);
    expect(repaired).toEqual([PUBLIC_URL, PUBLIC_URL]);
    expect(publicCalls).toEqual(['scans/uid-1/scan-1/0.jpg']);
  });

  it('keeps the original URL when makePublic is blocked', async () => {
    makePublicFails = true;
    expect(await repairLegacyImageUrls([LEGACY_URL])).toBeNull();
  });
});
