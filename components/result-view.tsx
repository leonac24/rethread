'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
} from 'recharts';
import type { RouteOption, ScanResult } from '@/types/garment';

function truncate(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '...';
}

const COUNTRY_COORDS: Record<string, [number, number]> = {
  'usa': [38, -97], 'united states': [38, -97], 'us': [38, -97], 'america': [38, -97],
  'china': [35, 105], 'bangladesh': [23.7, 90.4], 'india': [20, 77],
  'vietnam': [14, 108], 'cambodia': [12.5, 104.9], 'indonesia': [-0.8, 113.9],
  'pakistan': [30, 70], 'turkey': [38.9, 35.2], 'mexico': [23.6, -102.5],
  'sri lanka': [7.9, 80.8], 'ethiopia': [9.1, 40.5], 'portugal': [39.4, -8.2],
  'italy': [41.9, 12.6], 'france': [46.2, 2.2], 'germany': [51.2, 10.4],
  'uk': [51.5, -0.1], 'united kingdom': [51.5, -0.1], 'japan': [36.2, 138.3],
  'south korea': [35.9, 127.8], 'korea': [35.9, 127.8], 'taiwan': [23.7, 121],
  'thailand': [15.9, 100.9], 'malaysia': [4.2, 108], 'myanmar': [19.2, 96.7],
  'morocco': [31.8, -7.1], 'peru': [-9.2, -75], 'brazil': [-14.2, -51.9],
  'colombia': [4.6, -74.1], 'honduras': [15.2, -86.2], 'guatemala': [15.8, -90.2],
  'el salvador': [13.8, -88.9], 'haiti': [18.9, -72.3], 'egypt': [26, 30],
  'philippines': [12.9, 121.8], 'nepal': [28.4, 84.1],
};

function countryMapSrcdoc(country: string): string | null {
  const coords = COUNTRY_COORDS[country.toLowerCase().trim()];
  if (!coords) return null;
  const [lat, lng] = coords;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>html,body{margin:0;height:100%}#m{height:100%}.leaflet-control-attribution,.leaflet-control-zoom{display:none!important}</style>
</head><body><div id="m"></div><script>
var m=L.map('m',{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,tap:false,touchZoom:false}).setView([${lat},${lng}],2);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',{subdomains:'abcd'}).addTo(m);
var icon=L.icon({iconUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',iconRetinaUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[18,30],iconAnchor:[9,30],shadowSize:[30,30]});
L.marker([${lat},${lng}],{icon:icon}).addTo(m);
<\/script></body></html>`;
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

const ROUTE_META: Record<string, { bg: string; label: string; icon: React.ReactNode }> = {
  repair: {
    bg: '#ECE8DF',
    label: 'Repair',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5C6470" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
      </svg>
    ),
  },
  resale: {
    bg: '#EAF4FB',
    label: 'Resale',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5C6470" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>
      </svg>
    ),
  },
  donation: {
    bg: '#F5EEF8',
    label: 'Donation',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5C6470" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    ),
  },
};

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
};

export function ResultView({ id }: ResultViewProps) {
  const [data, setData] = useState<{
    text: string;
    result: ScanResult;
    previews?: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocrOpen, setOcrOpen] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function load() {
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

    void load();
    return () => { isActive = false; };
  }, [id]);

  const dyeScore = data?.result.cost.dye_pollution_score ?? 0;
  const dyeColor = dyeScore <= 3 ? '#5E8B6C' : dyeScore <= 6 ? '#C8A24A' : '#B23A2B';
  const fiberData = data?.result.garment.fibers.map((f) => ({ name: f.material, value: f.percentage })) ?? [];

  return (
    <main className="min-h-screen bg-bg md:pt-[80px]">
      <div className="pb-10 pt-2 space-y-3 content-width">

        {/* Loading / Error */}
        {!data && !error && (
          <p className="text-center text-[16px] text-ink-muted py-5">Loading result...</p>
        )}
        {error && (
          <p className="text-center text-[16px] text-danger py-5">{error}</p>
        )}

        {data && (
          <>
            {/* ── Garment Hero ─────────────────────────────────────── */}
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

              <div className="flex flex-wrap sm:flex-nowrap gap-4 items-start relative z-10">
                {/* Polaroid frame with photo */}
                {data.previews?.length ? (
                  <div className="flex-shrink-0 relative w-[200px]" style={{ transform: 'rotate(-3deg)' }}>
                    <div className="absolute inset-0 flex items-center justify-center" style={{ paddingTop: '8%', paddingBottom: '28%', paddingLeft: '10%', paddingRight: '10%' }}>
                      <img src={data.previews[0]} alt="Garment" className="w-full h-full object-cover" />
                    </div>
                    <Image src="/images/frame.png" alt="" width={300} height={350} className="relative z-10 w-full h-auto" />
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
                    <>
                      <div className="flex items-center gap-2 mt-2">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-faint flex-shrink-0">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                        </svg>
                        <p className="text-[15px] text-ink-muted">Made in <span className="text-ink font-medium">{data.result.garment.origin}</span></p>
                      </div>
                      {countryMapSrcdoc(data.result.garment.origin) && (
                        <iframe
                          srcDoc={countryMapSrcdoc(data.result.garment.origin)!}
                          sandbox="allow-scripts"
                          className="w-full mt-3 rounded-lg border-0 pointer-events-none"
                          style={{ height: 100 }}
                          loading="lazy"
                          title={`Map of ${data.result.garment.origin}`}
                        />
                      )}
                    </>
                  )}

                  {/* Secondary images — mobile: under details */}
                  {data.previews && data.previews.length > 1 && (
                    <div className="grid grid-cols-2 gap-2 mt-3 w-fit sm:hidden">
                      {data.previews.slice(1).map((src, i) => (
                        <img key={i} src={src} alt={`Tag ${i + 1}`} className="w-[56px] h-[56px] rounded-lg object-cover border border-rule" />
                      ))}
                    </div>
                  )}
                </div>

                {/* Secondary images — desktop: far right stacked */}
                {data.previews && data.previews.length > 1 && (
                  <div className="hidden sm:flex flex-col gap-2 flex-shrink-0">
                    {data.previews.slice(1).map((src, i) => (
                      <img key={i} src={src} alt={`Tag ${i + 1}`} className="w-[56px] h-[56px] rounded-lg object-cover border border-rule" />
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {/* ── Fiber Composition ───────────────────────────────── */}
            {fiberData.length > 0 && (
              <Card style={{ backgroundImage: 'url(/images/burlap.jpg)', backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: 'none', backgroundColor: 'transparent' }}>
                <SectionLabel><span className="text-ink bg-white px-1">Fiber Composition</span></SectionLabel>
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
                          <Cell key={`cell-${index}`} fill={FIBER_COLORS[index % FIBER_COLORS.length]} />
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
            )}

            {/* ── Environmental Impact ─────────────────────────────── */}
            <Card>
              <SectionLabel>Environmental Impact</SectionLabel>

              {/* Water + CO2 ripped paper cards */}
              <div className="grid grid-cols-2 gap-[34px] mb-4">
                <div
                  className="p-6 text-center"
                  style={{ backgroundImage: 'url(/images/tape.png)', backgroundSize: 'cover', backgroundPosition: 'center', transform: 'rotate(-1.5deg)' }}
                >
                  <p className="text-[10px] uppercase tracking-[0.08em] text-ink font-semibold mb-1">Water</p>
                  <p className="text-[26px] font-bold text-ink leading-none">
                    {Math.round(data.result.cost.water_liters * 0.264172).toLocaleString()}
                  </p>
                  <p className="text-[10px] text-ink font-medium mt-1">gallons</p>
                  <p className="text-[9px] text-ink-muted mt-2 leading-tight">
                    est. based on <a href="https://waterfootprint.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-ink">WaterFootprint.org</a><br/>per-fiber LCA data
                  </p>
                </div>
                <div
                  className="p-6 text-center"
                  style={{ backgroundImage: 'url(/images/tape.png)', backgroundSize: 'cover', backgroundPosition: 'center', transform: 'rotate(1.2deg)' }}
                >
                  <p className="text-[10px] uppercase tracking-[0.08em] text-ink font-semibold mb-1">CO₂</p>
                  <p className="text-[26px] font-bold text-ink leading-none">
                    {(data.result.cost.co2_kg * 2.20462).toFixed(1)}
                  </p>
                  <p className="text-[10px] text-ink font-medium mt-1">pounds</p>
                  <p className="text-[9px] text-ink-muted mt-2 leading-tight">
                    est. based on <a href="https://textileexchange.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-ink">Textile Exchange</a><br/>per-fiber LCA data
                  </p>
                </div>
              </div>

              {/* Dye risk bar chart */}
              <div className="rounded-xl bg-bg p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[14px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Dye Risk</p>
                  <span className="text-[15px] font-bold" style={{ color: dyeColor }}>{dyeScore}/10</span>
                </div>
                <ResponsiveContainer width="100%" height={52}>
                  <BarChart data={[{ value: dyeScore }]} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <XAxis type="number" domain={[0, 10]} hide />
                    <YAxis type="category" dataKey="value" hide />
                    <Bar dataKey="value" fill={dyeColor} radius={4} background={{ fill: 'rgba(20,22,26,0.07)', radius: 4 }} />
                  </BarChart>
                </ResponsiveContainer>
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
                { key: 'microplastics', label: 'Microplastics', body: li.microplastics },
                { key: 'methane', label: 'Methane', body: li.methane },
                { key: 'dye_runoff', label: 'Dye Runoff', body: li.dye_runoff },
                { key: 'breakdown', label: 'Breakdown Time', body: li.breakdown_years },
              ];
              return (
                <Card>
                  <SectionLabel>What happens if you throw it in the trash</SectionLabel>
                  <p className="text-[15px] leading-[20px] text-ink mb-4">{li.summary}</p>
                  <div className="grid grid-cols-1 gap-2">
                    {items.map((item) => (
                      <div
                        key={item.key}
                        className="px-5 py-3"
                        style={{
                          backgroundImage: 'url(/images/ribbon.png)',
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        }}
                      >
                        <p className="text-[14px] font-bold uppercase tracking-[0.08em] text-ink mb-0.5">{item.label}</p>
                        <p className="text-[14px] leading-[18px] text-ink">{item.body}</p>
                      </div>
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
                {data.result.routes.map((route, idx) => {
                  const meta = ROUTE_META[route.kind] ?? ROUTE_META.donation;
                  const routeKey = `${route.kind}-${route.name}`;
                  const srcdoc = mapSrcdoc(route);
                  const hasLocation = route.lat != null && route.lng != null;
                  const isLast = idx === data.result.routes.length - 1;

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
                          style={{ backgroundColor: meta.bg }}
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

            {/* ── Raw OCR Text (receipt) ───────────────────────────── */}
            <div className="flex justify-center">
            <div
              className="overflow-hidden w-64"
              style={{ backgroundImage: 'url(/images/receipt.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}
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
    </main>
  );
}
