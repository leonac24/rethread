import Image from 'next/image';
import Link from 'next/link';

export default function Header() {
  return (
    <header className="relative z-20 pt-4 pb-2 md:pb-0">
      <div className="content-width flex items-center justify-between">
        <Link href="/">
          <Image
            src="/images/hero.webp"
            alt="Rethread"
            width={100}
            height={100}
            className="w-[100px] h-auto object-contain"
          />
        </Link>
        <Link
          href="/profile"
          className="text-[14px] font-medium text-ink border border-rule rounded-md px-4 py-1.5 hover:bg-surface transition-colors"
        >
          Profile
        </Link>
      </div>
    </header>
  );
}
