'use client';

import { useEffect, useState } from 'react';

import type { RouteOption, ScanResult } from '@/types/garment';

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

type ResultViewProps = {
  id: string;
};

export function ResultView({ id }: ResultViewProps) {
  const [data, setData] = useState<{
    text: string;
    result: ScanResult;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function load() {
      const cached = sessionStorage.getItem(`scan:${id}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as {
            text?: string;
            result?: ScanResult;
          };

          if (parsed.result && typeof parsed.text === 'string') {
            if (isActive) {
              setData({ text: parsed.text, result: parsed.result });
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

  return (
    <main className="min-h-screen bg-bg px-4 py-6 flex items-start justify-center">
      <section className="w-full max-w-2xl rounded-lg border border-rule bg-surface p-4 shadow-sm sm:p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">
          Scan Result
        </p>

        {!data && !error ? (
          <p className="mt-3 text-[14px] text-ink-muted">Loading result...</p>
        ) : null}

        {error ? (
          <p className="mt-3 text-[14px] text-danger">{error}</p>
        ) : null}

        {data ? (
          <div className="mt-4 space-y-4">
            <section className="rounded-md border border-rule bg-bg p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">Garment</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[12px] uppercase tracking-[0.08em] text-ink-faint">Category</p>
                  <p className="mt-1 text-[15px] text-ink">{data.result.garment.category ?? 'Unknown'}</p>
                </div>
                <div>
                  <p className="text-[12px] uppercase tracking-[0.08em] text-ink-faint">Origin</p>
                  <p className="mt-1 text-[15px] text-ink">{data.result.garment.origin ?? 'Unknown'}</p>
                </div>
                <div>
                  <p className="text-[12px] uppercase tracking-[0.08em] text-ink-faint">Brand</p>
                  <p className="mt-1 text-[15px] text-ink">{data.result.garment.brand ?? 'Unknown'}</p>
                </div>
                {data.result.garment.color ? (
                  <div>
                    <p className="text-[12px] uppercase tracking-[0.08em] text-ink-faint">Color</p>
                    <p className="mt-1 text-[15px] text-ink">{data.result.garment.color}</p>
                  </div>
                ) : null}
              </div>

              <div className="mt-3">
                <p className="text-[12px] uppercase tracking-[0.08em] text-ink-faint">Fibers</p>
                {data.result.garment.fibers.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.result.garment.fibers.map((fiber) => (
                      <span
                        key={`${fiber.material}-${fiber.percentage}`}
                        className="inline-flex items-center rounded-full border border-rule px-3 py-1 text-[13px] text-ink"
                      >
                        {fiber.percentage}% {fiber.material}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[14px] text-ink-muted">No fibers detected.</p>
                )}
              </div>
            </section>

            <section className="rounded-md border border-rule bg-bg p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">Environmental Cost</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-rule bg-surface p-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">Water</p>
                  <p className="mt-1 text-[18px] text-ink">{Math.round(data.result.cost.water_liters * 0.264172).toLocaleString()} gal</p>
                </div>
                <div className="rounded-md border border-rule bg-surface p-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">CO2</p>
                  <p className="mt-1 text-[18px] text-ink">{(data.result.cost.co2_kg * 2.20462).toFixed(1)} lb</p>
                </div>
                <div className="rounded-md border border-rule bg-surface p-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">Dye Risk</p>
                  <p className="mt-1 text-[18px] text-ink">{data.result.cost.dye_pollution_score}/10</p>
                </div>
              </div>
              <p className="mt-3 text-[13px] text-ink-muted">
                Confidence: {data.result.cost.confidence}
              </p>
              <p className="mt-2 text-[14px] leading-[22px] text-ink">{data.result.cost.reasoning}</p>
              {data.result.cost.dye_type ? (
                <div className="mt-4 rounded-md border border-rule bg-surface p-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">Dye Type</p>
                  <p className="mt-1 text-[15px] text-ink">{data.result.cost.dye_type}</p>
                  {data.result.cost.dye_reasoning ? (
                    <p className="mt-2 text-[13px] leading-[20px] text-ink-muted">
                      {data.result.cost.dye_reasoning}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="rounded-md border border-rule bg-bg p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">Next Routes</p>
              <div className="mt-3 space-y-2">
                {data.result.routes.map((route) => {
                  const srcdoc = mapSrcdoc(route);
                  const hasLocation = route.lat != null && route.lng != null;
                  return (
                    <article
                      key={`${route.kind}-${route.name}`}
                      className="rounded-md border border-rule bg-surface overflow-hidden"
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
                        <p className="text-[12px] uppercase tracking-[0.08em] text-ink-faint">{route.kind}</p>
                        <p className="mt-1 text-[15px] text-ink">{route.name}</p>
                        <p className="mt-1 text-[13px] text-ink-muted">{route.address}</p>
                        <div className="mt-1 flex items-center justify-between">
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
            </section>

            <section className="rounded-md border border-rule bg-bg p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">Raw OCR Text</p>
              <pre className="mt-2 whitespace-pre-wrap text-[13px] leading-[20px] text-ink">
                {data.text || 'No text detected.'}
              </pre>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
