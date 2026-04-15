'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/firebase/auth-context';

export function HeaderNav() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  if (loading) {
    return (
      <div className="w-8 h-8 rounded-full bg-surface-sunk animate-pulse mr-5" />
    );
  }

  if (!user) {
    return (
      <a
        href="/login"
        className="mr-5 text-[14px] font-medium text-ink border border-rule rounded-md px-4 py-1.5 hover:bg-surface transition-colors"
      >
        Sign in
      </a>
    );
  }

  return (
    <div className="mr-5 flex items-center gap-3">
      {/* Avatar → profile */}
      <a href="/profile" className="flex items-center gap-2 group">
        {user.photoURL ? (
          <Image
            src={user.photoURL}
            alt={user.displayName ?? 'Profile'}
            width={32}
            height={32}
            className="w-8 h-8 rounded-full object-cover border border-rule group-hover:opacity-80 transition-opacity"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-accent-200 flex items-center justify-center text-[13px] font-bold text-accent-700 border border-rule group-hover:opacity-80 transition-opacity">
            {(user.displayName ?? user.email ?? '?')[0]?.toUpperCase()}
          </div>
        )}
        <span className="hidden sm:block text-[14px] font-medium text-ink group-hover:text-ink-muted transition-colors">
          {user.displayName?.split(' ')[0] ?? 'Profile'}
        </span>
      </a>

      {/* Sign out */}
      <button
        onClick={async () => {
          await signOut();
          router.push('/');
        }}
        className="text-[13px] text-ink-faint hover:text-ink-muted transition-colors"
        title="Sign out"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
    </div>
  );
}
