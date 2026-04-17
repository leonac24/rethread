'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

import type { ScanResult } from '@/types/garment';
import { LoadingScreen } from '@/components/loading-screen';

const SCAN_BLURBS = [
  'Reading garment label',
  'Analyzing fabric makeup',
  'Researching climate impact',
  'Tracing supply chain origins',
  'Calculating water footprint',
  'Estimating carbon emissions',
  'Evaluating dye toxicity',
  'Finding nearby drop-off points',
  'Checking brand sustainability',
  'Compiling your results',
];

type PendingData = {
  files: string[];
  hasGarmentPhoto: boolean;
};

type ScanResponse = {
  id: string;
  text: string;
  result: ScanResult;
};

function getCurrentCoords(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

function waitForPending(maxWait = 3000): Promise<PendingData | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    function check() {
      const raw = sessionStorage.getItem('scan:pending');
      if (raw) {
        sessionStorage.removeItem('scan:pending');
        resolve(JSON.parse(raw));
        return;
      }
      if (Date.now() - start > maxWait) {
        resolve(null);
        return;
      }
      setTimeout(check, 50);
    }
    check();
  });
}

function dataUrlToFile(dataUrl: string, name: string): File {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new File([arr], name, { type: mime });
}

export function ScanningView() {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function run() {
      const [pending, coords] = await Promise.all([
        waitForPending(),
        getCurrentCoords(),
      ]);

      if (!pending) {
        router.replace('/scan');
        return;
      }

      const formData = new FormData();

      let fileIndex = 0;
      if (pending.hasGarmentPhoto) {
        formData.append('garment_photo', dataUrlToFile(pending.files[0], 'garment.jpg'));
        fileIndex = 1;
      }
      for (let i = fileIndex; i < pending.files.length; i++) {
        formData.append('photo', dataUrlToFile(pending.files[i], `tag-${i}.jpg`));
      }
      if (coords) {
        formData.append('lat', String(coords.lat));
        formData.append('lng', String(coords.lng));
      }

      try {
        const response = await fetch('/api/scan', {
          method: 'POST',
          body: formData,
        });

        const text = await response.text();
        let payload: Partial<ScanResponse> & { error?: string } = {};
        try {
          payload = JSON.parse(text);
        } catch {
          throw new Error(
            `Server error (${response.status}): ${text.slice(0, 200) || 'empty response'}`,
          );
        }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Scan failed.');
        }

        if (payload.id && payload.result && typeof payload.text === 'string') {
          sessionStorage.setItem(
            `scan:${payload.id}`,
            JSON.stringify({
              text: payload.text,
              result: payload.result,
              previews: pending.files,
            }),
          );
          router.replace(`/result/${payload.id}`);
        }
      } catch (err) {
        console.error('[scanning] failed:', err);
        sessionStorage.setItem(
          'scan:error',
          err instanceof Error ? err.message : 'Scan failed.',
        );
        router.replace('/scan');
      }
    }

    void run();
  }, [router]);

  return <LoadingScreen blurbs={SCAN_BLURBS} fullscreen={false} />;
}
