import Image from 'next/image';
import Link from 'next/link';

export default function Header() {
  return (
    <header className="relative z-20 pt-4 pb-2 md:pb-0">
      <div className="content-width grid grid-cols-3 items-center">
        <div aria-hidden />
        <Link href="/" aria-label="Rethread home" className="justify-self-center">
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
          aria-label="Profile"
          className="justify-self-end inline-flex items-center justify-center w-10 h-10 rounded-full border border-rule text-ink hover:bg-surface transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5"
            aria-hidden
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
          </svg>
        </Link>
      </div>
    </header>
  );
}
