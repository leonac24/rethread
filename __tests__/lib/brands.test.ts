import { describe, expect, test } from 'bun:test';
import { SEED_BRANDS } from '@/scripts/seed-brands';
import { slugifyBrand } from '@/lib/score/brand';

describe('SEED_BRANDS list', () => {
  test('has exactly 50 entries', () => {
    expect(SEED_BRANDS.length).toBe(50);
  });

  test('all names are distinct after slugification', () => {
    const slugs = SEED_BRANDS.map((b) => slugifyBrand(b.name));
    const unique = new Set(slugs);
    expect(unique.size).toBe(50);
  });

  test('every alias is already slug-form (slugifyBrand(alias) === alias)', () => {
    for (const entry of SEED_BRANDS) {
      for (const alias of entry.aliases ?? []) {
        expect(slugifyBrand(alias)).toBe(alias);
      }
    }
  });
});
