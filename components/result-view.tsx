'use client';

import { useEffect, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from 'recharts';
import type { RouteOption, ScanResult } from '@/types/garment';

function truncate(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '...';
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
    <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted mb-4">
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
    <main className="min-h-screen bg-bg">
      {/* Header */}
      <div className="px-4 pt-8 pb-2 flex items-center gap-3">
        <a href="/" className="flex items-center justify-center w-9 h-9 rounded-full bg-surface" style={{ boxShadow: '0 1px 6px rgba(20,22,26,0.09)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </a>
        <h1 className="font-semibold text-[17px] text-ink">Scan Result</h1>
      </div>

      <div className="px-4 pb-10 pt-4 space-y-3 max-w-lg mx-auto">

        {/* Loading / Error */}
        {!data && !error && (
          <p className="text-center text-[14px] text-ink-muted py-16">Loading result...</p>
        )}
        {error && (
          <p className="text-center text-[14px] text-danger py-16">{error}</p>
        )}

        {data && (
          <>
            {/* Image previews */}
            {data.previews?.length ? (
              <div className="flex gap-3 overflow-x-auto pb-1">
                {data.previews.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt={`Upload ${i + 1}`}
                    className="h-[120px] w-auto rounded-xl border border-rule object-contain flex-shrink-0"
                  />
                ))}
              </div>
            ) : null}

            {/* ── Garment ─────────────────────────────────────────── */}
            <Card>
              <SectionLabel>Garment</SectionLabel>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-[22px] font-bold text-ink leading-tight">
                    {data.result.garment.category ?? 'Unknown'}
                  </p>
                  <p className="text-[14px] text-ink-muted mt-0.5">{data.result.garment.brand ?? 'Unknown brand'}</p>
                </div>
                {data.result.garment.color && (
                  <span className="inline-flex items-center rounded-full bg-surface-sunk px-3 py-1 text-[12px] text-ink-muted font-medium flex-shrink-0">
                    {data.result.garment.color}
                  </span>
                )}
              </div>
              {data.result.garment.origin && (
                <div className="flex items-center gap-2 pt-3 border-t border-rule">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-faint">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                  <p className="text-[13px] text-ink-muted">Made in <span className="text-ink font-medium">{data.result.garment.origin}</span></p>
                </div>
              )}
            </Card>

            {/* ── Fiber Composition ───────────────────────────────── */}
            {fiberData.length > 0 && (
              <Card>
                <SectionLabel>Fiber Composition</SectionLabel>
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
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium text-ink"
                      style={{ backgroundColor: FIBER_COLORS[i % FIBER_COLORS.length] }}
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

              {/* Water + CO2 */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-xl bg-bg p-4">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint mb-2">Water</p>
                  <p className="text-[26px] font-bold text-ink leading-none">
                    {Math.round(data.result.cost.water_liters * 0.264172).toLocaleString()}
                  </p>
                  <p className="text-[12px] text-ink-muted mt-1">gallons</p>
                </div>
                <div className="rounded-xl bg-bg p-4">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint mb-2">CO₂</p>
                  <p className="text-[26px] font-bold text-ink leading-none">
                    {(data.result.cost.co2_kg * 2.20462).toFixed(1)}
                  </p>
                  <p className="text-[12px] text-ink-muted mt-1">pounds</p>
                </div>
              </div>

              {/* Dye Risk */}
              <div className="rounded-xl bg-bg p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">Dye Risk</p>
                  <span className="text-[20px] font-bold text-ink leading-none">
                    {dyeScore}<span className="text-[13px] font-normal text-ink-muted"> / 10</span>
                  </span>
                </div>
                <div style={{ height: 24 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[{ filled: dyeScore, empty: 10 - dyeScore }]}
                      layout="vertical"
                      margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
                      barSize={18}
                    >
                      <XAxis type="number" domain={[0, 10]} hide />
                      <YAxis type="category" hide />
                      <Bar dataKey="filled" stackId="a" fill={dyeColor} radius={dyeScore === 10 ? [6, 6, 6, 6] : [6, 0, 0, 6]} isAnimationActive={false} />
                      <Bar dataKey="empty" stackId="a" fill="#ECE8DF" radius={dyeScore === 0 ? [6, 6, 6, 6] : [0, 6, 6, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Dye type */}
              {data.result.cost.dye_type && (
                <div className="mt-3 pt-3 border-t border-rule">
                  <p className="text-[12px] font-medium text-ink">{data.result.cost.dye_type}</p>
                  {data.result.cost.dye_reasoning && (
                    <p className="text-[12px] leading-[18px] text-ink-muted mt-1">{data.result.cost.dye_reasoning}</p>
                  )}
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-rule">
                <p className="text-[12px] leading-[19px] text-ink-muted">{truncate(data.result.cost.reasoning, 50)}</p>
                <p className="mt-2 text-[11px] text-ink-faint capitalize">Confidence: {data.result.cost.confidence}</p>
              </div>
            </Card>

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
                          <p className="text-[14px] font-semibold text-ink truncate">{route.name}</p>
                          <p className="text-[12px] text-ink-muted mt-0.5">{route.address}</p>
                          <p className="text-[12px] text-ink-faint mt-0.5">
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

            {/* ── Raw OCR Text (collapsible) ────────────────────────── */}
            <Card className="!p-0 overflow-hidden">
              <button
                onClick={() => setOcrOpen((v) => !v)}
                className="flex w-full items-center justify-between px-5 py-4 hover:bg-surface-sunk transition-colors"
              >
                <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Raw OCR Text</p>
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
                <div className="border-t border-rule px-5 pb-5 pt-4">
                  <pre className="whitespace-pre-wrap font-mono text-[12px] leading-[20px] text-ink-muted">
                    {data.text || 'No text detected.'}
                  </pre>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
