import { describe, it, expect } from 'bun:test';
import { normalizeResaleEstimate } from '../../lib/google/gemini';

describe('normalizeResaleEstimate', () => {
  it('floors decimal bounds to integers', () => {
    const estimate = normalizeResaleEstimate({ low_usd: 6.9, high_usd: 11.2, confidence: 'medium', factors: [] });
    expect(estimate).not.toBeNull();
    expect(estimate!.low_usd).toBe(6);
    expect(estimate!.high_usd).toBe(11);
    expect(estimate!.confidence).toBe('medium');
  });

  it('corrects swapped bounds so high is never below low', () => {
    const estimate = normalizeResaleEstimate({ low_usd: 10, high_usd: 4, confidence: 'high', factors: [] });
    expect(estimate!.low_usd).toBe(10);
    expect(estimate!.high_usd).toBe(10);
  });

  it('clamps low to at least 1', () => {
    const estimate = normalizeResaleEstimate({ low_usd: 0.4, high_usd: 3, confidence: 'low', factors: [] });
    expect(estimate!.low_usd).toBe(1);
    expect(estimate!.high_usd).toBe(3);
  });

  it('returns null for garbage input', () => {
    expect(normalizeResaleEstimate(null)).toBeNull();
    expect(normalizeResaleEstimate(undefined)).toBeNull();
    expect(normalizeResaleEstimate('cheap')).toBeNull();
    expect(normalizeResaleEstimate(42)).toBeNull();
    expect(normalizeResaleEstimate({})).toBeNull();
    expect(normalizeResaleEstimate({ low_usd: 5 })).toBeNull();
    expect(normalizeResaleEstimate({ low_usd: '5', high_usd: 10 })).toBeNull();
    expect(normalizeResaleEstimate({ low_usd: 5, high_usd: 'ten' })).toBeNull();
  });

  it('drops non-string factors, strips HTML, and caps at 4 items', () => {
    const estimate = normalizeResaleEstimate({
      low_usd: 5,
      high_usd: 9,
      confidence: 'medium',
      factors: [
        '<b>denim resells strongly</b>',
        42,
        'good condition',
        { note: 'nope' },
        'fast-fashion brand limits payout',
        'well-known brand',
        'one factor too many',
      ],
    });
    expect(estimate!.factors).toEqual([
      'denim resells strongly',
      'good condition',
      'fast-fashion brand limits payout',
      'well-known brand',
    ]);
  });

  it('drops factors that are empty after sanitizing and defaults to []', () => {
    const stripped = normalizeResaleEstimate({
      low_usd: 5,
      high_usd: 9,
      confidence: 'low',
      factors: ['<span></span>', '   '],
    });
    expect(stripped!.factors).toEqual([]);

    const missing = normalizeResaleEstimate({ low_usd: 5, high_usd: 9, confidence: 'low' });
    expect(missing!.factors).toEqual([]);
  });

  it('defaults invalid confidence to low', () => {
    const estimate = normalizeResaleEstimate({ low_usd: 5, high_usd: 9, confidence: 'certain', factors: [] });
    expect(estimate!.confidence).toBe('low');

    const absent = normalizeResaleEstimate({ low_usd: 5, high_usd: 9 });
    expect(absent!.confidence).toBe('low');
  });
});
