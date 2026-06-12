'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const HIDDEN_ROUTES = ['/scan', '/scanning'];

export default function Footer() {
  const pathname = usePathname();
  if (HIDDEN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return null;
  }

  return (
    <footer className="mt-8">
      <div className="content-width py-6 border-t border-rule flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="font-display text-[18px] text-ink leading-none">Rethread</p>
        <div className="flex items-center gap-4">
          <Link
            href="/verification"
            className="text-[12px] tracking-[0.1em] uppercase text-ink-faint hover:text-ink-muted transition-colors leading-none"
          >
            Verification
          </Link>
          <p
            className="text-[13px] text-ink-faint leading-none"
            style={{ fontFamily: 'var(--font-marker)' }}
          >
            stitched together with care
          </p>
        </div>
        <p className="text-[11px] tracking-[0.15em] uppercase text-ink-faint leading-none">
          © {new Date().getFullYear()}
        </p>
      </div>
    </footer>
  );
}
