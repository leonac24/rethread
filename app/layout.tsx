import type { Metadata } from 'next';
import { Fraunces, Inter, JetBrains_Mono, Architects_Daughter } from 'next/font/google';
import Image from 'next/image';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

const architectsDaughter = Architects_Daughter({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-marker',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Rethread',
  description: 'Scan a tag. See the true cost. Give the garment another life.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable} ${architectsDaughter.variable}`}
    >
      <body>
        <header className="relative z-20 pt-4 pb-2 md:pb-0">
          <div className="content-width flex items-center justify-between">
            <a href="/">
              <Image src="/images/hero.webp" alt="Rethread" width={100} height={100} className="w-[100px] h-auto object-contain" />
            </a>
            <a
              href="/profile"
              className="text-[14px] font-medium text-ink border border-rule rounded-md px-4 py-1.5 hover:bg-surface transition-colors"
            >
              Profile
            </a>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
