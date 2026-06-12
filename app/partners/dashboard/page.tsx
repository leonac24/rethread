'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useAuth } from '@/lib/firebase/auth-context';
import { LoadingScreen } from '@/components/loading-screen';
import Header from '@/components/header';
import Footer from '@/components/footer';

type MonthBucket = {
  month: string;
  issued: number;
  redeemed: number;
};

type StatsData = {
  issued: number;
  redeemed: number;
  conversionPct: number;
  estimatedOwed: number;
  monthly: MonthBucket[];
  status: string;
};

function StatTile({
  label,
  value,
  caption,
}: {
  label: string;
  value: string | number;
  caption?: string;
}) {
  return (
    <div className="bg-surface border border-rule p-6 space-y-1">
      <p className="text-[11px] font-bold tracking-[0.15em] uppercase text-ink-faint font-mono">
        {label}
      </p>
      <p className="text-[32px] font-semibold text-ink font-display leading-none">{value}</p>
      {caption && (
        <p className="text-[12px] text-ink-faint">{caption}</p>
      )}
    </div>
  );
}

function MonthlyChart({ data }: { data: MonthBucket[] }) {
  const formatted = data.map((d) => ({
    ...d,
    month: d.month.slice(5), // show MM only
  }));

  return (
    <div style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formatted} barCategoryGap="30%" barGap={4}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(20,22,26,0.08)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 12, fill: '#6B6F72', fontFamily: 'JetBrains Mono, monospace' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12, fill: '#6B6F72', fontFamily: 'JetBrains Mono, monospace' }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{
              background: '#FBF9F4',
              border: '1px solid rgba(20,22,26,0.08)',
              borderRadius: 10,
              fontSize: 12,
              color: '#14161A',
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            }}
            itemStyle={{ color: '#14161A' }}
            cursor={{ fill: 'rgba(20,22,26,0.04)' }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: '#6B6F72', paddingTop: 8 }}
          />
          <Bar dataKey="issued" name="Issued" fill="#6FA8CE" radius={[2, 2, 0, 0]} />
          <Bar dataKey="redeemed" name="Redeemed" fill="#8B9E6E" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function PartnersDashboardPage() {
  const { user, firebaseUser, loading } = useAuth();
  const [stats, setStats] = useState<StatsData | null | 'loading' | 'no-app'>('loading');

  useEffect(() => {
    if (!firebaseUser) {
      setStats(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch('/api/partners/stats', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 404) {
          if (!cancelled) setStats('no-app');
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as StatsData;
          if (!cancelled) setStats(data);
          return;
        }
        if (!cancelled) setStats(null);
      } catch {
        if (!cancelled) setStats(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  if (loading || stats === 'loading') {
    return <LoadingScreen blurbs={['Loading partner dashboard']} />;
  }

  // Not signed in
  if (!user) {
    return (
      <div className="min-h-screen bg-bg flex flex-col">
        <Header />
        <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
          <p className="text-[16px] text-ink-muted text-center">
            Sign in to view your partner dashboard.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-11 px-8 rounded-md bg-ink text-bg text-[14px] font-medium transition-opacity hover:opacity-80"
          >
            Sign in
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  // No application found
  if (stats === 'no-app') {
    return (
      <div className="min-h-screen bg-bg flex flex-col">
        <Header />
        <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
          <p className="text-[16px] text-ink-muted text-center">
            You don&apos;t have a partner application yet.
          </p>
          <Link
            href="/partners/apply"
            className="inline-flex items-center justify-center h-11 px-8 rounded-md bg-ink text-bg text-[14px] font-medium transition-opacity hover:opacity-80"
          >
            Apply now
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  // Error state (null after a non-404 failure)
  if (!stats) {
    return (
      <div className="min-h-screen bg-bg flex flex-col">
        <Header />
        <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
          <p className="text-[16px] text-ink-muted text-center">
            Failed to load dashboard. Please try again.
          </p>
        </main>
        <Footer />
      </div>
    );
  }

  const { issued, redeemed, conversionPct, estimatedOwed, monthly, status } = stats;

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <Header />

      <main className="flex-1 content-width py-12">
        <div className="max-w-3xl mx-auto space-y-10">

          {/* Page header */}
          <div className="space-y-1">
            <p className="text-[11px] font-bold tracking-[0.15em] uppercase text-ink-faint font-mono">
              Partner dashboard
            </p>
            <h1 className="text-[28px] font-semibold text-ink font-display">
              Referral stats
            </h1>
          </div>

          {/* Status banner */}
          {status === 'pending' && (
            <div className="border border-rule bg-surface px-5 py-4 rounded-sm">
              <p className="text-[14px] text-ink-muted">
                Your application is under review — stats will populate once you&apos;re verified.
              </p>
            </div>
          )}
          {status === 'rejected' && (
            <div className="border border-danger/30 bg-danger/5 px-5 py-4 rounded-sm">
              <p className="text-[14px] text-ink-muted">
                Your application wasn&apos;t approved.
              </p>
            </div>
          )}

          {/* Headline tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatTile label="Issued" value={issued} />
            <StatTile label="Redeemed" value={redeemed} />
            <StatTile label="Conversion" value={`${conversionPct}%`} />
            <StatTile
              label="Est. owed"
              value={`$${estimatedOwed.toFixed(2)}`}
              caption="at $0.75 per confirmed redemption"
            />
          </div>

          {/* Monthly chart */}
          <div className="bg-surface border border-rule p-6 space-y-4">
            <p className="text-[11px] font-bold tracking-[0.15em] uppercase text-ink-faint font-mono">
              Last 6 months
            </p>
            <MonthlyChart data={monthly} />
          </div>

        </div>
      </main>

      <Footer />
    </div>
  );
}
