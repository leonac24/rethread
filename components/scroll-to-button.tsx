'use client';

type Props = {
  targetId: string;
  className?: string;
  children: React.ReactNode;
};

export default function ScrollToButton({ targetId, className, children }: Props) {
  return (
    <button
      type="button"
      onClick={() => {
        document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }}
      className={className}
    >
      {children}
    </button>
  );
}
