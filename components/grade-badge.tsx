type GradeBadgeProps = {
  grade: string;
  score?: number;
  size?: 'lg' | 'sm';
};

function gradeColor(grade: string): { bg: string; border: string; text: string } {
  switch (grade) {
    case 'A':
      return {
        bg: 'color-mix(in srgb, var(--success) 9%, transparent)',
        border: 'var(--success)',
        text: 'var(--success)',
      };
    case 'B':
      return {
        bg: 'color-mix(in srgb, var(--accent-500) 9%, transparent)',
        border: 'var(--accent-500)',
        text: 'var(--accent-700)',
      };
    case 'C':
      return {
        bg: 'color-mix(in srgb, var(--warning) 9%, transparent)',
        border: 'var(--warning)',
        text: 'var(--warning)',
      };
    case 'D':
      return {
        bg: 'color-mix(in srgb, color-mix(in srgb, var(--warning) 60%, var(--danger) 40%) 9%, transparent)',
        border: 'color-mix(in srgb, var(--warning) 60%, var(--danger) 40%)',
        text: 'color-mix(in srgb, var(--warning) 60%, var(--danger) 40%)',
      };
    case 'F':
    default:
      return {
        bg: 'color-mix(in srgb, var(--danger) 9%, transparent)',
        border: 'var(--danger)',
        text: 'var(--danger)',
      };
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
