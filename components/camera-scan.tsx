'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { ScanResult } from '@/types/garment';

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

type UploadDropdownProps = {
  disabled?: boolean;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
};

function UploadDropdown({ disabled, multiple, onFiles }: UploadDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length) onFiles(files);
    event.target.value = '';
    setOpen(false);
  }

  function pick(ref: React.RefObject<HTMLInputElement | null>) {
    ref.current?.click();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="w-full rounded-md border border-dashed border-rule bg-bg px-4 py-4 text-[14px] text-ink-muted transition-colors hover:bg-surface-sunk disabled:opacity-60"
      >
        Add photo
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl bg-[#1c1c1e] shadow-xl">
          <button
            type="button"
            onClick={() => pick(libraryRef)}
            className="flex w-full items-center justify-between px-4 py-3.5 text-[15px] text-white transition-colors hover:bg-white/10"
          >
            <span>Photo Library</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
          </button>
          <div className="mx-4 h-px bg-white/10" />
          <button
            type="button"
            onClick={() => pick(cameraRef)}
            className="flex w-full items-center justify-between px-4 py-3.5 text-[15px] text-white transition-colors hover:bg-white/10"
          >
            <span>Take Photo</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
            </svg>
          </button>
          <div className="mx-4 h-px bg-white/10" />
          <button
            type="button"
            onClick={() => pick(fileRef)}
            className="flex w-full items-center justify-between px-4 py-3.5 text-[15px] text-white transition-colors hover:bg-white/10"
          >
            <span>Choose File</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        </div>
      )}

      <input ref={libraryRef} type="file" accept="image/*" multiple={multiple} onChange={handleChange} className="sr-only" />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleChange} className="sr-only" />
      <input ref={fileRef} type="file" multiple={multiple} onChange={handleChange} className="sr-only" />
    </div>
  );
}

export function CameraScan() {
  const router = useRouter();
  const [garmentPhoto, setGarmentPhoto] = useState<File | null>(null);
  const [staged, setStaged] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  function removeStaged(index: number) {
    setStaged((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleScan() {
    if (!staged.length && !garmentPhoto) return;

    setError('');
    setIsLoading(true);

    try {
      const coords = await getCurrentCoords();
      console.log('[scan] geolocation result:', coords);

      const formData = new FormData();
      if (garmentPhoto) {
        formData.append('garment_photo', garmentPhoto);
      }
      for (const file of staged) {
        formData.append('photo', file);
      }
      if (coords) {
        formData.append('lat', String(coords.lat));
        formData.append('lng', String(coords.lng));
      }

      const response = await fetch('/api/scan', {
        method: 'POST',
        body: formData,
      });

      const text = await response.text();
      let payload: Partial<ScanResponse> & { error?: string } = {};
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`Server error (${response.status}): ${text.slice(0, 200) || 'empty response'}`);
      }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Scan failed.');
      }

      if (payload.id && payload.result && typeof payload.text === 'string') {
        const allFiles = [...(garmentPhoto ? [garmentPhoto] : []), ...staged];
        const previews = await Promise.all(
          allFiles.map(
            (f) =>
              new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(f);
              }),
          ),
        );
        sessionStorage.setItem(
          `scan:${payload.id}`,
          JSON.stringify({ text: payload.text, result: payload.result, previews }),
        );
        router.push(`/result/${payload.id}`);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Scan failed.');
    } finally {
      setIsLoading(false);
      setStaged([]);
      setGarmentPhoto(null);
    }
  }

  const canScan = (staged.length > 0 || garmentPhoto !== null) && !isLoading;
  const totalQueued = staged.length + (garmentPhoto ? 1 : 0);

  return (
    <main className="min-h-screen bg-bg px-4 py-6 flex items-start justify-center">
      <div className="w-full max-w-2xl space-y-4">

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

          {/* Garment image */}
          <section className="rounded-lg border border-rule bg-surface p-4">
            <p className="text-[12px] uppercase tracking-[0.1em] text-ink-muted">Garment</p>
            <p className="mt-2 text-[13px] leading-[19px] text-ink-muted">
              Upload a photo of the clothing item itself. We'll detect the garment type and color to identify the likely dye and its environmental impact.
            </p>
            <div className="mt-4">
              {garmentPhoto ? (
                <div className="flex items-center justify-between rounded-md border border-rule bg-bg px-3 py-2">
                  <span className="truncate text-[14px] text-ink">{garmentPhoto.name}</span>
                  <button
                    type="button"
                    onClick={() => setGarmentPhoto(null)}
                    disabled={isLoading}
                    className="ml-3 shrink-0 text-[13px] text-ink-muted hover:text-danger disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <UploadDropdown
                  disabled={isLoading}
                  multiple={false}
                  onFiles={(files) => setGarmentPhoto(files[0])}
                />
              )}
            </div>
          </section>

          {/* Tag images */}
          <section className="rounded-lg border border-rule bg-surface p-4">
            <p className="text-[12px] uppercase tracking-[0.1em] text-ink-muted">Tags</p>
            <p className="mt-2 text-[13px] leading-[19px] text-ink-muted">
              Upload every tag on the item — brand, size, and care labels. The more tags, the more accurate the fiber and origin analysis.
            </p>
            <div className="mt-4 space-y-2">
              <UploadDropdown
                disabled={isLoading}
                multiple
                onFiles={(files) => setStaged((prev) => [...prev, ...files])}
              />
              {staged.map((file, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md border border-rule bg-bg px-3 py-2"
                >
                  <span className="truncate text-[13px] text-ink">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeStaged(i)}
                    disabled={isLoading}
                    className="ml-3 shrink-0 text-[12px] text-ink-muted hover:text-danger disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        {isLoading ? (
          <button
            type="button"
            disabled
            className="w-full inline-flex items-center justify-center h-10 rounded-md bg-ink text-bg text-[14px] font-medium opacity-60"
          >
            Scanning...
          </button>
        ) : canScan ? (
          <button
            type="button"
            onClick={handleScan}
            className="w-full inline-flex items-center justify-center h-10 rounded-md bg-ink text-bg text-[14px] font-medium"
          >
            Scan {totalQueued} image{totalQueued === 1 ? '' : 's'}
          </button>
        ) : null}

        {error && <p className="text-[14px] text-danger">{error}</p>}
      </div>
    </main>
  );
}
