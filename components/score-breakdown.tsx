'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { GarmentScore } from '@/lib/score/garment';
import type { Garment } from '@/types/garment';

type ScoreBreakdownProps = {
  subScores: GarmentScore['subScores'];
  confidence: GarmentScore['confidence'];
  provenance?: Garment['provenance'];
};

type BarRowProps = {
  label: string;
  value: number | null;
  inferred?: boolean;
  index: number;
};

function barColor(value: number): string {
  if (value >= 65) return 'var(--success)';
  if (value >= 50) return 'var(--accent-500)';
  if (value >= 35) return 'var(--warning)';
  if (value >= 20) return 'color-mix(in srgb, var(--warning) 60%, var(--danger) 40%)';
  return 'var(--danger)';
}

function confidenceColor(conf: GarmentScore['confidence']): { bg: string; text: string } {
  switch (conf) {
    case 'high':
      return {
        bg: 'color-mix(in srgb, var(--success) 9%, transparent)',
        text: 'var(--success)',
      };
    case 'medium':
      return {
        bg: 'color-mix(in srgb, var(--warning) 9%, transparent)',
        text: 'var(--warning)',
      };
    case 'low':
    default:
      return {
        bg: 'color-mix(in srgb, var(--danger) 9%, transparent)',
        text: 'var(--danger)',
      };
  }
}

function BarRow({ label, value, inferred = false, index }: BarRowProps) {
  const prefersReducedMotion = useReducedMotion();

  if (value === null) {
    return (
      <div className="flex items-center gap-3 py-2">
        <span className="w-28 flex-shrink-0 text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--ink-faint)' }}>
          {label}
        </span>
        <span className="text-[12px] italic font-mono" style={{ color: 'var(--ink-faint)' }}>not enough data</span>
      </div>
    );
  }

  const color = barColor(value);
  const clampedValue = Math.max(0, Math.min(100, value));
  const scaleX = clampedValue / 100;

  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {label}
          </span>
          {inferred && (
            <span
              className="text-[10px] font-mono uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-sm border"
              style={{
                color: 'var(--ink-faint)',
                borderColor: 'var(--rule)',
                backgroundColor: 'transparent',
              }}
            >
              estimated
            </span>
          )}
        </div>
        <span
          className="text-[14px] font-bold font-mono tabular-nums"
          style={{ color }}
        >
          {Math.round(value)}
        </span>
      </div>
      <div
        className="relative w-full h-[8px] rounded-sm overflow-hidden"
        style={{ backgroundColor: 'var(--rule)' }}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        aria-label={`${label} score`}
      >
        <motion.div
          className="absolute top-0 left-0 h-full w-full rounded-sm"
          initial={prefersReducedMotion ? false : { scaleX: 0 }}
          whileInView={prefersReducedMotion ? { scaleX } : { scaleX }}
          viewport={{ once: true, amount: 0.5 }}
          transition={
            prefersReducedMotion
              ? { duration: 0 }
              : { duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.06 * index }
          }
          style={{
            backgroundColor: color,
            transformOrigin: 'left',
            scaleX: prefersReducedMotion ? scaleX : undefined,
          }}
        />
      </div>
    </div>
  );
}

export function ScoreBreakdown({ subScores, confidence, provenance }: ScoreBreakdownProps) {
  const { bg: confBg, text: confText } = confidenceColor(confidence);

  const rows: { key: keyof typeof subScores; label: string; inferred: boolean }[] = [
    {
      key: 'materials',
      label: 'Materials',
      inferred: provenance?.fibers === 'inferred',
    },
    {
      key: 'manufacturing',
      label: 'Manufacturing',
      inferred: provenance?.origin === 'inferred',
    },
    {
      key: 'brand',
      label: 'Brand',
      inferred: provenance?.brand === 'inferred',
    },
    {
      key: 'endOfLife',
      label: 'End of Life',
      inferred: false,
    },
  ];

  return (
    <div>
      <div className="divide-y divide-rule">
        {rows.map((row, i) => (
          <BarRow
            key={row.key}
            label={row.label}
            value={subScores[row.key]}
            inferred={row.inferred}
            index={i}
          />
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold font-mono uppercase tracking-[0.06em]"
          style={{ backgroundColor: confBg, color: confText }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: confText }}
          />
          {confidence} confidence
        </span>
        <span className="text-[12px] text-ink-faint">
          based on available label data
        </span>
      </div>
    </div>
  );
}
