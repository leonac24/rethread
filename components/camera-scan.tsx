'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

import type { ScanResult } from '@/types/garment';

type ScanResponse = {
  id: string;
  text: string;
  result: ScanResult;
};

type ScannedItem = {
  id: string;
  fileName: string;
};

function getCurrentCoords(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

export function CameraScan() {
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [staged, setStaged] = useState<File[]>([]);
  const [scanned, setScanned] = useState<ScannedItem[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const isLoading = progress !== null;

  function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setStaged((prev) => [...prev, ...files]);
    event.target.value = '';
  }

  function removeStaged(index: number) {
    setStaged((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleScan() {
    if (!staged.length) return;

    setErrors([]);
    setProgress({ done: 0, total: staged.length });

    const coords = await getCurrentCoords();
    console.log('[scan] geolocation result:', coords);

    let done = 0;

    const settled = await Promise.allSettled(
      staged.map(async (file) => {
        const formData = new FormData();
        formData.append('photo', file);

        if (coords) {
          formData.append('lat', String(coords.lat));
          formData.append('lng', String(coords.lng));
        }

        const response = await fetch('/api/scan', {
          method: 'POST',
          body: formData,
        });

        const payload = (await response.json()) as Partial<ScanResponse> & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? 'Scan failed.');
        }

        if (payload.id && payload.result && typeof payload.text === 'string') {
          sessionStorage.setItem(
            `scan:${payload.id}`,
            JSON.stringify({ text: payload.text, result: payload.result }),
          );
        }

        done += 1;
        setProgress({ done, total: staged.length });

        return { id: payload.id!, fileName: file.name };
      }),
    );

    const successes = settled
      .filter((r): r is PromiseFulfilledResult<ScannedItem> => r.status === 'fulfilled')
      .map((r) => r.value);

    const failures = settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason instanceof Error ? r.reason.message : 'Scan failed.'));

    setProgress(null);
    setErrors(failures);
    setStaged([]);
    setScanned((prev) => [...prev, ...successes]);
  }

  function openCamera() {
    cameraInputRef.current?.click();
  }

  function openUpload() {
    uploadInputRef.current?.click();
  }

  return (
    <main className="min-h-screen bg-bg px-4 py-6 flex items-start justify-center">
      <section className="w-full max-w-md rounded-lg border border-rule bg-surface p-4 shadow-sm sm:p-5">
        <div className="grid grid-cols-1 gap-3">
          <button
            type="button"
            onClick={openCamera}
            disabled={isLoading}
            className="rounded-md border border-rule bg-bg px-4 py-5 text-left transition-colors hover:bg-surface-sunk disabled:opacity-60"
          >
            <span className="block text-[14px] font-medium text-ink">Open camera</span>
          </button>

          <button
            type="button"
            onClick={openUpload}
            disabled={isLoading}
            className="rounded-md border border-rule bg-bg px-4 py-5 text-left transition-colors hover:bg-surface-sunk disabled:opacity-60"
          >
            <span className="block text-[14px] font-medium text-ink">Upload images</span>
          </button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFilesSelected}
          className="sr-only"
          aria-label="Capture a tag photo"
        />

        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFilesSelected}
          className="sr-only"
          aria-label="Upload tag photos"
        />

        {staged.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-[12px] uppercase tracking-[0.1em] text-ink-muted">
              Queued ({staged.length})
            </p>
            {staged.map((file, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md border border-rule bg-bg px-3 py-2"
              >
                <span className="truncate text-[14px] text-ink">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeStaged(i)}
                  disabled={isLoading}
                  className="ml-3 shrink-0 text-[13px] text-ink-muted hover:text-danger disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={handleScan}
              disabled={isLoading}
              className="mt-1 w-full inline-flex items-center justify-center h-10 rounded-md bg-ink text-bg text-[14px] font-medium disabled:opacity-60"
            >
              {isLoading
                ? `Scanning ${progress.done} of ${progress.total}...`
                : `Scan ${staged.length} tag${staged.length === 1 ? '' : 's'}`}
            </button>
          </div>
        )}

        {(scanned.length > 0 || errors.length > 0) && (
          <div className="mt-4 space-y-2">
            <p className="text-[12px] uppercase tracking-[0.1em] text-ink-muted">Results</p>
            {errors.map((e, i) => (
              <p key={i} className="text-[14px] text-danger">{e}</p>
            ))}
            {scanned.map((item) => (
              <Link
                key={item.id}
                href={`/result/${item.id}`}
                className="flex items-center justify-between rounded-md border border-rule bg-bg px-3 py-2 text-[14px] text-ink hover:bg-surface-sunk"
              >
                <span className="truncate">{item.fileName}</span>
                <span className="ml-3 shrink-0 text-ink-muted">View →</span>
              </Link>
            ))}
          </div>
        )}

        {staged.length === 0 && scanned.length === 0 && !isLoading && (
          <div className="mt-4 min-h-24 rounded-md border border-rule bg-bg p-4">
            <p className="text-[14px] text-ink-muted">Upload images to get started.</p>
          </div>
        )}
      </section>
    </main>
  );
}
