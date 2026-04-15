'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HeaderNav } from '@/components/header-nav';

export default function Header() {
  const pathname = usePathname();
  const isHome = pathname === '/';

  return (
    <header className="relative z-20 pt-4 pb-2 md:pb-0">
      <div className="content-width grid grid-cols-3 items-center">
        <div aria-hidden />
        <Link
          href="/"
          aria-label="Rethread home"
          className={`justify-self-center ${isHome ? 'md:translate-y-[140px]' : ''}`}
        >
          <Image
            src="/images/hero.webp"
            alt="Rethread"
            width={100}
            height={100}
            className="w-[100px] h-auto object-contain"
          />
        </Link>
        <div className="justify-self-end">
          <HeaderNav />
        </div>
      </div>
    </header>
  );
}
