'use client';

import Image from 'next/image';
import Link from 'next/link';
import { HeaderNav } from '@/components/header-nav';

export default function Header() {
  return (
    <header className="relative z-20 pt-2">
      <div className="content-width flex items-center justify-between">
        <Link href="/" aria-label="Rethread home">
          <Image
            src="/images/hero.webp"
            alt="Rethread"
            width={100}
            height={100}
            className="w-[60px] h-auto object-contain"
          />
        </Link>
        <HeaderNav />
      </div>
    </header>
  );
}
