'use client';

type GradeBadgeProps = {
  grade: string;
  score?: number;
  size?: 'lg' | 'sm';
};

function gradeColor(grade: string): { bg: string; border: string; text: string } {
  switch (grade) {
    case 'A':
      return { bg: '#5E8B6C18', border: '#5E8B6C', text: '#5E8B6C' };
    case 'B':
      return { bg: '#6FA8CE18', border: '#6FA8CE', text: '#2E5F83' };
    case 'C':
      return { bg: '#C8A24A18', border: '#C8A24A', text: '#C8A24A' };
    case 'D':
      return { bg: '#B07D2E18', border: '#B07D2E', text: '#B07D2E' };
    case 'F':
    default:
      return { bg: '#B23A2B18', border: '#B23A2B', text: '#B23A2B' };
  }
}

export function GradeBadge({ grade, score, size = 'sm' }: GradeBadgeProps) {
  const { bg, border, text } = gradeColor(grade);

  if (size === 'lg') {
    return (
      <div className="flex flex-col items-center gap-1">
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 80,
            height: 80,
            backgroundColor: bg,
            border: `2px solid ${border}`,
          }}
        >
          <span
            className="font-display font-bold leading-none"
            style={{ fontSize: 42, color: text }}
          >
            {grade}
          </span>
        </div>
        {score != null && (
          <span
            className="font-mono text-[13px] font-medium tracking-wide tabular-nums"
            style={{ color: text }}
          >
            {score}/100
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <div
        className="flex items-center justify-center rounded-full"
        style={{
          width: 32,
          height: 32,
          backgroundColor: bg,
          border: `1.5px solid ${border}`,
        }}
      >
        <span
          className="font-display font-bold leading-none"
          style={{ fontSize: 16, color: text }}
        >
          {grade}
        </span>
      </div>
      {score != null && (
        <span
          className="font-mono text-[12px] font-medium tabular-nums"
          style={{ color: text }}
        >
          {score}
        </span>
      )}
    </div>
  );
}
