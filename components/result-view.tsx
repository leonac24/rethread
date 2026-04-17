'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { OutcomeAction, RouteOption, ScanResult } from '@/types/garment';
import { OutcomeSection } from '@/components/outcome-section';
import { LoadingScreen } from '@/components/loading-screen';
import { useAuth } from '@/lib/firebase/auth-context';

function truncate(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '...';
}

function truncateChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1).trimEnd() + '…';
}

function mapsUrl(route: RouteOption): string {
  const query = encodeURIComponent(route.name + ', ' + route.address);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function mapSrcdoc(route: RouteOption): string | null {
  if (route.lat == null || route.lng == null) return null;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>html,body{margin:0;height:100%}#m{height:100%}.leaflet-control-attribution,.leaflet-control-zoom{display:none!important}</style>
</head><body><div id="m"></div><script>
var m=L.map('m',{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,tap:false,touchZoom:false}).setView([${route.lat},${route.lng}],15);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{subdomains:'abcd'}).addTo(m);
var icon=L.icon({iconUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',iconRetinaUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41],shadowSize:[41,41]});L.marker([${route.lat},${route.lng}],{icon:icon}).addTo(m);
<\/script></body></html>`;
}

const FIBER_COLORS = ['#8B9E6E', '#6FA8CE', '#C8A24A', '#B8739D', '#C4956A', '#8E6BAD', '#6AADA8', '#A6ADB6'];

const ROUTE_META: Record<string, { bg: string; iconColor: string; label: string; icon: React.ReactNode }> = {
  donation: {
    bg: '#E8F0E6',
    iconColor: '#5E8B6C',
    label: 'Donation',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    ),
  },
  resale: {
    bg: '#FBF1D4',
    iconColor: '#C9983E',
    label: 'Resale',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>
      </svg>
    ),
  },
  repair: {
    bg: '#F2E4C7',
    iconColor: '#8B6A1E',
    label: 'Repair',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
      </svg>
    ),
  },
};

const ROUTE_ORDER: Record<string, number> = { donation: 0, resale: 1, repair: 2 };

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-faint flex-shrink-0">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[14px] font-semibold uppercase tracking-[0.1em] text-ink-muted mb-4">
      {children}
    </p>
  );
}

function Card({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`bg-surface rounded-2xl p-5 ${className}`}
      style={{ boxShadow: '0 2px 16px rgba(20,22,26,0.07)', ...style }}
    >
      {children}
    </div>
  );
}

function colorToCSS(name: string): string {
  const map: Record<string, string> = {
    'navy blue': 'navy', 'light blue': 'lightblue', 'dark green': 'darkgreen',
    'light green': 'lightgreen', 'dark red': 'darkred', 'hot pink': 'hotpink',
    'sky blue': 'skyblue', 'olive green': 'olive', 'forest green': 'forestgreen',
    'baby blue': 'lightblue', 'dark grey': 'darkgray', 'dark gray': 'darkgray',
    'light grey': 'lightgray', 'light gray': 'lightgray', 'off white': 'ivory',
  };
  const lower = name.toLowerCase();
  return map[lower] ?? lower.replace(/\s+/g, '');
}


type ResultViewProps = {
  id: string;
  readOnly?: boolean;
};

const SAVED_ACTION_META: Record<OutcomeAction, { label: string; color: string; sentence: string }> = {
  donate: { label: 'Donate', color: '#5E8B6C', sentence: 'You donated this garment.' },
  list: { label: 'List / Swap', color: '#C9983E', sentence: 'You listed this garment.' },
  repair: { label: 'Repair', color: '#8B6A1E', sentence: 'You repaired this garment.' },
  throw_away: { label: 'Throw Away', color: '#B23A2B', sentence: 'You threw this garment away.' },
};

export function ResultView({ id, readOnly = false }: ResultViewProps) {
  const { firebaseUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<{
    text: string;
    result: ScanResult;
    previews?: string[];
  } | null>(null);
  const [savedAction, setSavedAction] = useState<OutcomeAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!firebaseUser) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/user/scans/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Failed to delete.');
      }
      router.push('/profile');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete.');
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!lightboxSrc) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxSrc(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightboxSrc]);

  useEffect(() => {
    let isActive = true;

    async function loadSaved() {
      if (authLoading) return;
      if (!firebaseUser) {
        if (isActive) setError('Sign in to view saved scans.');
        return;
      }
      try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch(`/api/user/scans/${id}`, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = (await response.json()) as {
          error?: string;
          scanId?: string;
          action?: OutcomeAction;
          result?: ScanResult;
          text?: string;
          imageUrls?: string[];
        };
        if (!response.ok || !payload.result || typeof payload.text !== 'string') {
          throw new Error(payload.error ?? 'Result not found.');
        }
        if (isActive) {
          setData({
            text: payload.text,
            result: payload.result,
            previews: payload.imageUrls?.length ? payload.imageUrls : undefined,
          });
          if (payload.action) setSavedAction(payload.action);
        }
      } catch (caughtError) {
        if (isActive) setError(caughtError instanceof Error ? caughtError.message : 'Result not found.');
      }
    }

    async function loadFresh() {
      const cached = sessionStorage.getItem(`scan:${id}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as {
            text?: string;
            result?: ScanResult;
            previews?: string[];
          };
          if (parsed.result && typeof parsed.text === 'string') {
            if (isActive) setData({ text: parsed.text, result: parsed.result, previews: parsed.previews });
            return;
          }
        } catch {
          // ignore
        }
      }

      try {
        const response = await fetch(`/api/scan/${id}`, { cache: 'no-store' });
        const payload = (await response.json()) as {
          error?: string;
          text?: string;
          result?: ScanResult;
        };
        if (!response.ok || !payload.result || typeof payload.text !== 'string') {
          throw new Error(payload.error ?? 'Result not found.');
        }
        if (isActive) setData({ text: payload.text, result: payload.result });
      } catch (caughtError) {
        if (isActive) setError(caughtError instanceof Error ? caughtError.message : 'Result not found.');
      }
    }

    if (readOnly) {
      void loadSaved();
    } else {
      void loadFresh();
    }
    return () => { isActive = false; };
  }, [id, readOnly, firebaseUser, authLoading]);

  const dyeScore = data?.result.cost.dye_pollution_score ?? 0;
  const dyeColor = dyeScore <= 3 ? '#5E8B6C' : dyeScore <= 6 ? '#C8A24A' : '#B23A2B';
  const fiberData = data?.result.garment.fibers.map((f) => ({ name: f.material, value: f.percentage })) ?? [];

  if (!data && !error) {
    return <LoadingScreen blurbs={['Retrieving garment details', 'Loading your scan']} />;
  }

  return (
    <main className="min-h-screen bg-bg">
      {/* Shared torn-edge filter — used by fiber donut and dye bar */}
      <svg width="0" height="0" aria-hidden className="absolute">
        <defs>
          <filter id="torn-edge" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" />
          </filter>
        </defs>
      </svg>
      <div className="pb-10 pt-2 space-y-3 content-width">

        {error && (
          <p className="text-center text-[16px] text-danger py-5">{error}</p>
        )}

        {data && (
          <>
            {/* ── Garment Hero + Fiber Composition row ─────────────── */}
            <div
              className={
                fiberData.length > 0
                  ? 'space-y-3 md:space-y-0 md:grid md:grid-cols-2 md:gap-3 md:items-stretch'
                  : ''
              }
            >
            <Card className="relative overflow-hidden">
              {/* Watermark category text */}
              {data.result.garment.category && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
                  <span
                    className="font-display font-bold text-ink select-none whitespace-nowrap"
                    style={{ fontSize: 122, opacity: 0.04, transform: 'rotate(-8deg)' }}
                  >
                    {data.result.garment.category}
                  </span>
                </div>
              )}

              <SectionLabel>Garment</SectionLabel>

              <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start relative z-10">
                {/* Polaroid frame with photo + tag thumbnails in caption area */}
                {data.previews?.length ? (
                  <div className="flex-shrink-0 relative w-[200px]" style={{ transform: 'rotate(-3deg)' }}>
                    <button
                      type="button"
                      onClick={() => setLightboxSrc(data.previews![0])}
                      className="absolute inset-0 flex items-center justify-center cursor-zoom-in"
                      style={{ paddingTop: '8%', paddingBottom: '28%', paddingLeft: '10%', paddingRight: '10%' }}
                      aria-label="Expand garment photo"
                    >
                      <img src={data.previews[0]} alt="Garment" className="w-full h-full object-cover pointer-events-none" />
                    </button>
                    <Image src="/images/frame.webp" alt="" width={300} height={350} className="relative z-10 w-full h-auto pointer-events-none" />
                    {data.previews.length > 1 && (
                      <div
                        className="absolute left-0 right-0 z-20 flex justify-center gap-1.5"
                        style={{ bottom: '7%', paddingLeft: '12%', paddingRight: '12%' }}
                      >
                        {data.previews.slice(1, 4).map((src, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setLightboxSrc(src)}
                            className="cursor-zoom-in"
                            aria-label={`Expand tag photo ${i + 1}`}
                          >
                            <img
                              src={src}
                              alt={`Tag ${i + 1}`}
                              className="w-[38px] h-[38px] object-cover rounded-[2px] border border-ink/15 pointer-events-none"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <p className="text-[29px] font-bold text-ink leading-tight">
                    {data.result.garment.category ?? 'Unknown'}
                  </p>
                  <p className="text-[16px] text-ink-muted mt-0.5">{data.result.garment.brand ?? 'Unknown brand'}</p>

                  {data.result.fti ? (() => {
                    const { score, year } = data.result.fti!;
                    const color = score >= 61 ? '#5E8B6C' : score >= 41 ? '#C8A24A' : score >= 21 ? '#B07D2E' : '#B23A2B';
                    const label = score >= 61 ? 'High' : score >= 41 ? 'Moderate' : score >= 21 ? 'Low' : 'Very Low';
                    const explanation = score >= 61
                      ? 'This brand publicly discloses most of its supply chain, environmental policies, and labor practices.'
                      : score >= 41
                        ? 'This brand shares some information about its supply chain but significant gaps remain.'
                        : score >= 21
                          ? 'This brand discloses very little about where and how its clothes are made.'
                          : 'This brand provides almost no public information about its supply chain or environmental impact.';
                    return (
                      <div className="mt-3 rounded-xl bg-bg px-3 py-2.5">
                        <div className="flex items-center gap-2 mb-1">
                          <div
                            className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-bold"
                            style={{ backgroundColor: `${color}18`, color }}
                          >
                            <span
                              className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            Transparency {score}/100 · {label}
                          </div>
                          <a
                          href={data.result.fti!.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[12px] text-ink-faint hover:underline underline-offset-2"
                        >
                          FTI {year} ↗
                        </a>
                        </div>
                        <p className="text-[13px] leading-[16px] text-ink-muted">{explanation}</p>
                      </div>
                    );
                  })() : (
                    <p className="text-[13px] text-ink-faint mt-1.5 italic">
                      No Fashion Transparency Index available for this brand.
                    </p>
                  )}

                  {data.result.garment.color && (
                    <div className="flex items-center gap-2 mt-3">
                      <div
                        className="w-4 h-4 rounded-full border border-rule flex-shrink-0"
                        style={{ backgroundColor: colorToCSS(data.result.garment.color) }}
                      />
                      <span className="text-[14px] text-ink-muted">{data.result.garment.color}</span>
                    </div>
                  )}

                  {data.result.garment.origin && (
                    <div className="flex items-center gap-2 mt-2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-faint flex-shrink-0">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                      </svg>
                      <p className="text-[15px] text-ink-muted">Made in <span className="text-ink font-medium">{data.result.garment.origin}</span></p>
                    </div>
                  )}

                </div>
              </div>
            </Card>

            {/* ── Fiber Composition ───────────────────────────────── */}
            {fiberData.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
              >
              <Card style={{ backgroundImage: 'url(/images/burlap.webp)', backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: 'none', backgroundColor: 'transparent' }}>
                <SectionLabel><span className="text-ink bg-white px-1">Fiber Composition</span></SectionLabel>

                {/* SVG defs — crumpled-paper pattern tinted per fiber color */}
                <svg width="0" height="0" aria-hidden className="absolute">
                  <defs>
                    {FIBER_COLORS.map((color, i) => (
                      <pattern
                        key={i}
                        id={`fiber-paper-${i}`}
                        patternUnits="userSpaceOnUse"
                        width="420"
                        height="420"
                      >
                        <rect width="420" height="420" fill={color} />
                        <image
                          href="/images/paperbar.webp"
                          width="420"
                          height="420"
                          preserveAspectRatio="xMidYMid slice"
                          style={{ mixBlendMode: 'luminosity', filter: 'brightness(0.82) contrast(1.1)' }}
                        />
                      </pattern>
                    ))}
                  </defs>
                </svg>

                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={fiberData}
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={78}
                        paddingAngle={2}
                        dataKey="value"
                        startAngle={90}
                        endAngle={-270}
                      >
                        {fiberData.map((_, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={`url(#fiber-paper-${index % FIBER_COLORS.length})`}
                            stroke="none"
                            filter="url(#torn-edge)"
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [`${value ?? 0}%`, name]}
                        contentStyle={{
                          background: '#FBF9F4',
                          border: '1px solid rgba(20,22,26,0.08)',
                          borderRadius: 10,
                          fontSize: 12,
                          color: '#14161A',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                        }}
                        itemStyle={{ color: '#14161A' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {fiberData.map((d, i) => (
                    <span
                      key={d.name}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-bold text-ink"
                      style={{ backgroundColor: 'white' }}
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: FIBER_COLORS[i % FIBER_COLORS.length] }}
                      />
                      {d.name} · {d.value}%
                    </span>
                  ))}
                </div>
              </Card>
              </motion.div>
            )}
            </div>

            {/* ── Environmental Impact ─────────────────────────────── */}
            <Card>
              <SectionLabel>Environmental Impact</SectionLabel>

              {/* Water + CO2 ripped paper cards */}
              <div className="grid grid-cols-2 gap-[34px] mb-1 md:mb-4">
                <motion.div
                  className="text-center md:p-6 md:bg-[url(/images/tape.webp)] md:bg-cover md:bg-center"
                  initial={{ opacity: 0, y: -24, rotate: -14 }}
                  whileInView={{ opacity: 1, y: 0, rotate: -1.5 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ type: 'spring', stiffness: 180, damping: 14, delay: 0.05 }}
                >
                  <div className="py-5 px-6 flex flex-col items-center justify-center bg-[url(/images/tape.webp)] bg-[length:auto_250%] bg-no-repeat bg-[position:center_55%] md:py-0 md:px-0 md:block md:bg-none">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-ink font-semibold mb-1">Water</p>
                    <p className="text-[26px] font-bold text-ink leading-none">
                      {Math.round(data.result.cost.water_liters * 0.264172).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-ink font-medium mt-1">gallons</p>
                  </div>
                  <p className="text-[9px] text-ink-muted mt-2 pb-4 md:pb-0 leading-tight">
                    est. based on <a href="https://waterfootprint.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-ink">WaterFootprint.org</a><br/>per-fiber LCA data
                  </p>
                </motion.div>
                <motion.div
                  className="text-center md:p-6 md:bg-[url(/images/tape.webp)] md:bg-cover md:bg-center"
                  initial={{ opacity: 0, y: -24, rotate: 14 }}
                  whileInView={{ opacity: 1, y: 0, rotate: 1.2 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ type: 'spring', stiffness: 180, damping: 14, delay: 0.18 }}
                >
                  <div className="py-5 px-6 flex flex-col items-center justify-center bg-[url(/images/tape.webp)] bg-[length:auto_250%] bg-no-repeat bg-[position:center_55%] md:py-0 md:px-0 md:block md:bg-none">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-ink font-semibold mb-1">CO₂</p>
                    <p className="text-[26px] font-bold text-ink leading-none">
                      {(data.result.cost.co2_kg * 2.20462).toFixed(1)}
                    </p>
                    <p className="text-[10px] text-ink font-medium mt-1">pounds</p>
                  </div>
                  <p className="text-[9px] text-ink-muted mt-2 pb-4 md:pb-0 leading-tight">
                    est. based on <a href="https://textileexchange.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-ink">Textile Exchange</a><br/>per-fiber LCA data
                  </p>
                </motion.div>
              </div>

              {/* Dye risk bar — crumpled-paper fill tinted by dye color */}
              <div className="rounded-xl bg-bg p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[14px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Dye Risk</p>
                  <span className="text-[15px] font-bold" style={{ color: dyeColor }}>{dyeScore}/10</span>
                </div>
                <div className="relative w-full h-[28px] bg-ink/[0.07] rounded-md">
                  <motion.div
                    className="absolute top-[-5px] bottom-[-5px] left-0"
                    initial={{ width: '0%' }}
                    whileInView={{ width: `${Math.max(0, Math.min(10, dyeScore)) * 10}%` }}
                    viewport={{ once: true, amount: 0.5 }}
                    transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
                    style={{
                      backgroundColor: dyeColor,
                      backgroundImage: 'url(/images/paperbar.webp)',
                      backgroundSize: '520px',
                      backgroundPosition: 'center',
                      backgroundBlendMode: 'luminosity',
                      filter: 'url(#torn-edge) brightness(0.82) contrast(1.1)',
                    }}
                  />
                </div>
                {data.result.cost.dye_type && (
                  <p className="text-[14px] font-medium text-ink mt-2">{data.result.cost.dye_type}</p>
                )}
                {data.result.cost.dye_reasoning && (
                  <p className="text-[13px] leading-[17px] text-ink-muted mt-1">{data.result.cost.dye_reasoning}</p>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-rule">
                <p className="text-[14px] leading-[19px] text-ink-muted">{data.result.cost.reasoning}</p>
                <p className="mt-2 text-[13px] text-ink-faint capitalize">Confidence: {data.result.cost.confidence}</p>
              </div>
            </Card>

            {/* ── Landfill Impact ──────────────────────────────────── */}
            {data.result.landfill_impact && (() => {
              const li = data.result.landfill_impact!;
              const items: { key: string; label: string; body: string }[] = [
                { key: 'microplastics', label: 'Microplastics', body: truncateChars(li.microplastics, 100) },
                { key: 'methane', label: 'Methane', body: truncateChars(li.methane, 100) },
                { key: 'dye_runoff', label: 'Dye Runoff', body: truncateChars(li.dye_runoff, 100) },
                { key: 'breakdown', label: 'Breakdown Time', body: truncateChars(li.breakdown_years, 100) },
              ];
              return (
                <Card>
                  <SectionLabel>What happens if you throw it in the trash</SectionLabel>
                  <p className="text-[15px] leading-[20px] text-ink mb-4">{li.summary}</p>
                  <div className="grid grid-cols-1 gap-2">
                    {items.map((item, i) => (
                      <motion.div
                        key={item.key}
                        className="px-5 py-[15px] md:py-3 bg-[url(/images/ribbon.webp)] bg-[length:auto_137.5%] bg-no-repeat bg-center md:bg-cover"
                        initial={{ opacity: 0, x: -28 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true, amount: 0.3 }}
                        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.05 + i * 0.09 }}
                      >
                        <p className="text-[14px] font-bold uppercase tracking-[0.08em] text-ink mb-0.5">{item.label}</p>
                        <p className="text-[14px] leading-[18px] text-ink">{item.body}</p>
                      </motion.div>
                    ))}
                  </div>
                </Card>
              );
            })()}

            {/* ── Next Routes ──────────────────────────────────────── */}
            <Card className="!p-0 overflow-hidden">
              <div className="px-5 pt-5 pb-2">
                <SectionLabel>Next Routes</SectionLabel>
              </div>
              <div>
                {[...data.result.routes]
                  .sort((a, b) => (ROUTE_ORDER[a.kind] ?? 99) - (ROUTE_ORDER[b.kind] ?? 99))
                  .map((route, idx, sorted) => {
                  const meta = ROUTE_META[route.kind] ?? ROUTE_META.donation;
                  const routeKey = `${route.kind}-${route.name}`;
                  const srcdoc = mapSrcdoc(route);
                  const hasLocation = route.lat != null && route.lng != null;
                  const isLast = idx === sorted.length - 1;

                  return (
                    <div key={routeKey}>
                      {srcdoc && (
                        <iframe
                          srcDoc={srcdoc}
                          sandbox="allow-scripts"
                          className="w-full h-[140px] border-0 pointer-events-none"
                          loading="lazy"
                          title={`Map showing ${route.name}`}
                        />
                      )}
                      <div className="flex items-center gap-3 px-5 py-3.5">
                        <div
                          className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: meta.bg, color: meta.iconColor }}
                        >
                          {meta.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[16px] font-semibold text-ink truncate">{route.name}</p>
                          <p className="text-[14px] text-ink-muted mt-0.5">{route.address}</p>
                          <p className="text-[14px] text-ink-faint mt-0.5">
                            {meta.label} · {(route.distance_km * 0.621371).toFixed(1)} mi
                          </p>
                        </div>
                        {hasLocation && (
                          <a
                            href={mapsUrl(route)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-shrink-0"
                          >
                            <ChevronRight />
                          </a>
                        )}
                      </div>
                      {!isLast && <div className="mx-5 h-px bg-rule" />}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* ── Outcome Selection ────────────────────────────────── */}
            {readOnly ? (
              (() => {
                const meta = savedAction ? SAVED_ACTION_META[savedAction] : null;
                return (
                  <Card>
                    <SectionLabel>Your Action</SectionLabel>
                    {meta ? (
                      <div className="flex items-center gap-3">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold"
                          style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                        >
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: meta.color }}
                          />
                          Saved Outcome · {meta.label}
                        </span>
                        <p className="text-[15px] text-ink-muted">{meta.sentence}</p>
                      </div>
                    ) : (
                      <p className="text-[15px] text-ink-muted">No action recorded.</p>
                    )}
                  </Card>
                );
              })()
            ) : (
              <OutcomeSection
                id={id}
                cost={data.result.cost}
                condition={data.result.garment.condition}
                onOutcomeRecorded={setSavedAction}
              />
            )}

            {/* ── Back / Remove from Closet ────────────────────────── */}
            {firebaseUser && savedAction && (
              <div className="pt-2">
                {!confirmingDelete ? (
                  <div className="flex items-center justify-center gap-6">
                    <Link
                      href="/profile"
                      className="text-[13px] font-semibold text-ink-muted underline underline-offset-2 hover:opacity-80"
                    >
                      Back to Closet
                    </Link>
                    {savedAction !== 'throw_away' && (
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(true)}
                        className="text-[13px] font-semibold text-danger underline underline-offset-2 hover:opacity-80 cursor-pointer"
                      >
                        Remove from Closet
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    className="rounded-2xl p-5 bg-surface"
                    style={{ boxShadow: '0 2px 16px rgba(20,22,26,0.07)' }}
                  >
                    <p className="text-[15px] font-semibold text-ink mb-1">
                      Remove this garment from your Closet?
                    </p>
                    <p className="text-[14px] text-ink-muted mb-4">
                      Your environmental credit for this item will be reversed and the scan will be deleted.
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingDelete(false);
                          setDeleteError(null);
                        }}
                        disabled={deleting}
                        className="flex-1 rounded-xl py-3 text-[15px] font-semibold text-ink-muted border border-rule transition-colors hover:bg-surface-sunk disabled:opacity-50 cursor-pointer disabled:cursor-default"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={deleting}
                        className="flex-1 rounded-xl py-3 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-default"
                        style={{ backgroundColor: '#B23A2B' }}
                      >
                        {deleting ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                    {deleteError && <p className="text-[13px] text-danger mt-3">{deleteError}</p>}
                  </div>
                )}
              </div>
            )}

            {/* ── Raw OCR Text (receipt) ───────────────────────────── */}
            <div className="flex justify-center">
            <div
              className="overflow-hidden w-64"
              style={{ backgroundImage: 'url(/images/receipt.webp)', backgroundSize: 'cover', backgroundPosition: 'center' }}
            >
              <button
                onClick={() => setOcrOpen((v) => !v)}
                className="flex w-full items-center justify-between px-5 py-4 transition-colors hover:brightness-95"
              >
                <p className="font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-ink-muted">— Care Label OCR —</p>
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className="text-ink-faint transition-transform duration-200"
                  style={{ transform: ocrOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {ocrOpen && (
                <div className="px-5 pb-6 pt-1">
                  <div className="border-t border-dashed border-ink/20 mb-4" />
                  <pre className="whitespace-pre-wrap font-mono text-[13px] leading-[20px] text-ink">
                    {data.text || 'No text detected.'}
                  </pre>
                  <div className="border-t border-dashed border-ink/20 mt-4" />
                </div>
              )}
            </div>
            </div>
          </>
        )}
      </div>

      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setLightboxSrc(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Expanded image"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxSrc}
            alt="Expanded view"
            className="max-w-full max-h-full object-contain"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxSrc(null);
            }}
            aria-label="Close expanded view"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 backdrop-blur-md text-white text-[22px] leading-none flex items-center justify-center hover:bg-white/25 cursor-pointer"
          >
            ×
          </button>
        </div>
      )}
    </main>
  );
}
