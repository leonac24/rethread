'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/firebase/auth-context';
import { LoadingScreen } from '@/components/loading-screen';
import { ListingFeed } from '@/components/retailer/listing-feed';
import { DealsTab } from '@/components/retailer/deals-tab';

function GateCard({ title, body, cta }: { title: string; body: string; cta?: { href: string; label: string } }) {
  return (
    <main className="min-h-[80vh] flex flex-col items-center justify-center px-4">
      <div
        className="w-full max-w-sm rounded-2xl p-8 space-y-4 text-center"
        style={{ boxShadow: '0 2px 24px rgba(20,22,26,0.09)', backgroundColor: '#FBF9F4' }}
      >
        <h1 className="text-[22px] font-bold text-ink font-display">{title}</h1>
        <p className="text-[14px] text-ink-muted leading-relaxed">{body}</p>
        {cta && (
          <a
            href={cta.href}
            className="inline-flex items-center justify-center h-11 px-8 rounded-md bg-ink text-bg text-[14px] font-medium transition-opacity hover:opacity-80"
          >
            {cta.label}
          </a>
        )}
      </div>
    </main>
  );
}

export default function RetailerPage() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<'listings' | 'deals'>('listings');

  if (loading) {
    return <LoadingScreen blurbs={['Opening your storefront']} />;
  }

  if (!user || user.role !== 'retailer') {
    return (
      <GateCard
        title="Partner access only"
        body="This page is for approved resale partners. Sign up as a retailer to make offers on locally listed clothing."
        cta={{ href: '/login', label: 'Go to sign-in' }}
      />
    );
  }

  if (user.retailerStatus !== 'approved') {
    return (
      <GateCard
        title="Application under review"
        body="We review every partner application by hand. You'll get access to local listings as soon as you're approved."
      />
    );
  }

  return (
    <main className="min-h-screen bg-bg py-8">
      <div className="content-width space-y-6">
        <div className="pt-4">
          <h1 className="text-[24px] font-bold text-ink font-display">
            {user.storeName ?? 'Your store'} — Partner Dashboard
          </h1>
          <p className="text-[14px] text-ink-muted mt-1">
            Browse locally listed garments and make offers.
          </p>
        </div>
        <div className="flex gap-2">
          {(['listings', 'deals'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full px-5 py-2 text-[13px] font-bold transition-colors cursor-pointer ${
                tab === t
                  ? 'bg-ink text-bg'
                  : 'text-ink-muted border border-rule hover:bg-surface-sunk'
              }`}
            >
              {t === 'listings' ? 'Listings' : 'My Deals'}
            </button>
          ))}
        </div>

        <div className="pb-8">
          {tab === 'listings' ? <ListingFeed /> : <DealsTab />}
        </div>
      </div>
    </main>
  );
}
