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


const FIBER_COLORS = ['#6FA8CE', '#8B9E6E', '#C8A24A', '#B8739D', '#C4956A', '#8E6BAD', '#6AADA8', '#A6ADB6'];

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
            if (isActive) {
              setData({ text: parsed.text, result: parsed.result, previews: parsed.previews });
            }
            return;
          }
        } catch {
          // Ignore malformed cache and continue to API fetch.
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

        if (isActive) {
          setData({ text: payload.text, result: payload.result });
        }
      } catch (caughtError) {
        if (isActive) {
          setError(caughtError instanceof Error ? caughtError.message : 'Result not found.');
        }
      }
    }

    void load();

    return () => {
      isActive = false;
    };
  }, [id]);

  const dyeScore = data?.result.cost.dye_pollution_score ?? 0;
  const dyeColor = dyeScore <= 3 ? '#5E8B6C' : dyeScore <= 6 ? '#C8A24A' : '#B23A2B';
  const fiberData = data?.result.garment.fibers.map((f) => ({ name: f.material, value: f.percentage })) ?? [];

  return (
    <main className="min-h-screen bg-bg px-4 py-6 flex items-start justify-center">
      <section className="w-full max-w-2xl">
        <h1 className="font-mono text-[22px] font-semibold uppercase tracking-[0.16em] text-ink text-center pb-5">
          Scan Result
        </h1>

        {data?.previews?.length ? (
          <div className="flex justify-center gap-3 pb-4">
            {data.previews.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`Upload ${i + 1}`}
                className="h-[140px] w-auto rounded-md border border-rule object-contain"
              />
            ))}
          </div>
        ) : null}

        {!data && !error ? (
          <p className="text-center text-[14px] text-ink-muted py-8">Loading result...</p>
        ) : null}

        {error ? (
          <p className="text-center text-[14px] text-danger py-8">{error}</p>
        ) : null}

        {data ? (
          <div className="space-y-4">

            {/* ── Garment Info ─────────────────────────────────────── */}
            <div className="rounded-lg border border-rule bg-surface p-4 shadow-sm">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted mb-3">Garment</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">Category</p>
                  <p className="mt-1 text-[15px] text-ink">{data.result.garment.category ?? 'Unknown'}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">Brand</p>
                  <p className="mt-1 text-[15px] text-ink">{data.result.garment.brand ?? 'Unknown'}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">Origin</p>
                  <p className="mt-1 text-[15px] text-ink">{data.result.garment.origin ?? 'Unknown'}</p>
                </div>
                {data.result.garment.color ? (
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">Color</p>
                    <p className="mt-1 text-[15px] text-ink">{data.result.garment.color}</p>
                  </div>
                ) : null}
              </div>
            </div>

            {/* ── Fiber Composition ─────────────────────────────────── */}
            {fiberData.length > 0 ? (
              <div className="rounded-lg border border-rule bg-surface p-4 shadow-sm">
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted mb-2">Fiber Composition</p>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={fiberData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={82}
                        paddingAngle={2}
                        dataKey="value"
                        startAngle={90}
                        endAngle={-270}
                      >
                        {fiberData.map((_, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={FIBER_COLORS[index % FIBER_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => [`${value ?? 0}%`, '']}
                        contentStyle={{
                          background: '#FBF9F4',
                          border: '1px solid rgba(20,22,26,0.10)',
                          borderRadius: 6,
                          fontSize: 12,
                          color: '#14161A',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                        }}
                        itemStyle={{ color: '#14161A' }}
                        labelStyle={{ display: 'none' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-2 justify-center mt-1">
                  {fiberData.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-1.5">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: FIBER_COLORS[i % FIBER_COLORS.length] }}
                      />
                      <span className="text-[12px] text-ink-muted">{d.name} · {d.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* ── Environmental Impact ──────────────────────────────── */}
            <div className="rounded-lg border border-rule bg-surface p-4 shadow-sm">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted mb-3">Environmental Impact</p>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="rounded-md bg-bg border border-rule p-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">Water Usage</p>
                  <p className="mt-2 text-[24px] font-semibold text-ink leading-none">
                    {Math.round(data.result.cost.water_liters * 0.264172).toLocaleString()}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-muted">gallons</p>
                </div>
                <div className="rounded-md bg-bg border border-rule p-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">CO₂ Emitted</p>
                  <p className="mt-2 text-[24px] font-semibold text-ink leading-none">
                    {(data.result.cost.co2_kg * 2.20462).toFixed(1)}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-muted">pounds</p>
                </div>
              </div>

              {/* Dye Risk Bar */}
              <div className="rounded-md bg-bg border border-rule p-3">
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">Dye Risk</p>
                  <span className="text-[22px] font-semibold text-ink leading-none">
                    {dyeScore}
                    <span className="text-[13px] font-normal text-ink-muted">&thinsp;/&thinsp;10</span>
                  </span>
                </div>
                <div style={{ height: 28 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[{ filled: dyeScore, empty: 10 - dyeScore }]}
                      layout="vertical"
                      margin={{ top: 4, right: 0, bottom: 4, left: 0 }}
                      barSize={20}
                    >
                      <XAxis type="number" domain={[0, 10]} hide />
                      <YAxis type="category" hide />
                      <Bar
                        dataKey="filled"
                        stackId="a"
                        fill={dyeColor}
                        radius={dyeScore === 10 ? [4, 4, 4, 4] : [4, 0, 0, 4]}
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="empty"
                        stackId="a"
                        fill="#ECE8DF"
                        radius={dyeScore === 0 ? [4, 4, 4, 4] : [0, 4, 4, 0]}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {data.result.cost.dye_type ? (
                <div className="mt-3 rounded-md bg-bg border border-rule p-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">Dye Type</p>
                  <p className="mt-1 text-[14px] text-ink">{data.result.cost.dye_type}</p>
                  {data.result.cost.dye_reasoning ? (
                    <p className="mt-2 text-[12px] leading-[18px] text-ink-muted">{data.result.cost.dye_reasoning}</p>
                  ) : null}
                </div>
              ) : null}

              <p className="mt-3 text-[11px] text-ink-faint">
                Confidence: <span className="capitalize">{data.result.cost.confidence}</span>
              </p>
              <p className="mt-1.5 text-[13px] leading-[20px] text-ink-muted">
                {truncate(data.result.cost.reasoning, 60)}
              </p>
            </div>

            {/* ── Next Routes ───────────────────────────────────────── */}
            <div className="rounded-lg border border-rule bg-surface p-4 shadow-sm">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted mb-3">Next Routes</p>
              <div className="space-y-2">
                {data.result.routes.map((route) => {
                  const srcdoc = mapSrcdoc(route);
                  const hasLocation = route.lat != null && route.lng != null;
                  return (
                    <article
                      key={`${route.kind}-${route.name}`}
                      className="rounded-md border border-rule bg-bg overflow-hidden"
                    >
                      {srcdoc ? (
                        <iframe
                          srcDoc={srcdoc}
                          sandbox="allow-scripts"
                          className="w-full h-[120px] border-0 pointer-events-none"
                          loading="lazy"
                          title={`Map showing ${route.name}`}
                        />
                      ) : null}
                      <div className="p-3">
                        <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">{route.kind}</p>
                        <p className="mt-1 text-[15px] text-ink">{route.name}</p>
                        <p className="mt-0.5 text-[13px] text-ink-muted">{route.address}</p>
                        <div className="mt-1.5 flex items-center justify-between">
                          <p className="text-[13px] text-ink-muted">{(route.distance_km * 0.621371).toFixed(1)} mi away</p>
                          {hasLocation ? (
                            <a
                              href={mapsUrl(route)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[13px] text-ink-muted transition-colors hover:text-ink"
                            >
                              Open in Maps ›
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            {/* ── Raw OCR Text (collapsible) ────────────────────────── */}
            <div className="rounded-lg border border-rule bg-surface shadow-sm">
              <button
                onClick={() => setOcrOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 cursor-pointer"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">Raw OCR Text</p>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-ink-faint transition-transform duration-200"
                  style={{ transform: ocrOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {ocrOpen ? (
                <div className="border-t border-rule px-4 pb-4 pt-3">
                  <pre className="whitespace-pre-wrap font-mono text-[12px] leading-[20px] text-ink-muted">
                    {data.text || 'No text detected.'}
                  </pre>
                </div>
              ) : null}
            </div>

          </div>
        ) : null}
      </section>
    </main>
  );
}
