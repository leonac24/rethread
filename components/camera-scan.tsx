'use client';

import Image from 'next/image';
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
        className="w-full h-11 rounded-md bg-ink text-bg text-[14px] font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
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

  useEffect(() => {
    router.prefetch('/scanning');
    const saved = sessionStorage.getItem('scan:error');
    if (saved) {
      setError(saved);
      sessionStorage.removeItem('scan:error');
    }
  }, [router]);

  function removeStaged(index: number) {
    setStaged((prev) => prev.filter((_, i) => i !== index));
  }

  function compressImage(file: File, maxPx = 800, quality = 0.5): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new window.Image();
        img.onload = () => {
          const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  function handleScan() {
    if (!staged.length && !garmentPhoto) return;

    setError('');
    setIsLoading(true);

    const allFiles = [...(garmentPhoto ? [garmentPhoto] : []), ...staged];

    router.push('/scanning');

    Promise.all(allFiles.map((f) => compressImage(f))).then((dataUrls) => {
      sessionStorage.setItem(
        'scan:pending',
        JSON.stringify({
          files: dataUrls,
          hasGarmentPhoto: garmentPhoto !== null,
        }),
      );
    });
  }

  const canScan = (staged.length > 0 || garmentPhoto !== null) && !isLoading;
  const totalQueued = staged.length + (garmentPhoto ? 1 : 0);

  return (
    <main className="min-h-screen bg-bg py-2 flex items-start justify-center pt-[15vh]">
      <div className="content-width space-y-4">

        <div className="grid grid-cols-2 items-start gap-x-[40px] gap-y-3 max-w-[49%] mx-auto">

          {/* Garment */}
          <div className="flex flex-col items-center gap-3">
            {/* Frame with garment inside */}
            <div className="relative w-[130%] -mx-[15%] mb-[10px]">
              {/* Garment image inside frame opening */}
              <div className="absolute inset-0 flex items-center justify-center" style={{ paddingTop: '0%', paddingBottom: '16%', paddingLeft: '2%', paddingRight: '2%', transform: 'scale(1.3)', transformOrigin: 'center center' }}>
                <Image src="/images/garment.png" alt="Garment" width={200} height={200} className="w-full h-full object-contain" />
              </div>
              {/* Frame overlay */}
              <Image src="/images/frame.png" alt="" width={600} height={700} className="relative z-10 w-full h-auto" />
              {/* Label at bottom of frame */}
              <div className="absolute bottom-0 left-0 right-0 z-20 pb-3 text-center" style={{ paddingLeft: '5%', paddingRight: '5%', bottom: '10px' }}>
                <p style={{ fontFamily: 'var(--font-handwriting)' }} className="text-[12px] leading-[17px] sm:text-[18px] sm:leading-[24px] text-ink-muted">Upload Garment</p>
              </div>
            </div>
            {/* Upload button separate */}
            <div className="w-full">
              {garmentPhoto ? (
                <div className="flex w-full items-center justify-between rounded-md border border-rule bg-bg px-3 py-2 h-11">
                  <span className="truncate text-[13px] text-ink">{garmentPhoto.name}</span>
                  <button type="button" onClick={() => setGarmentPhoto(null)} disabled={isLoading} className="ml-3 shrink-0 text-[12px] text-ink-muted hover:text-danger disabled:opacity-40">Remove</button>
                </div>
              ) : (
                <UploadDropdown disabled={isLoading} multiple={false} onFiles={(files) => setGarmentPhoto(files[0])} />
              )}
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-col items-center gap-3">
            {/* Frame with tag inside */}
            <div className="relative w-[130%] -mx-[15%] mb-[10px]">
              {/* Tag image inside frame opening */}
              <div className="absolute inset-0 flex items-center justify-center" style={{ paddingTop: '0%', paddingBottom: '16%', paddingLeft: '2%', paddingRight: '2%', transform: 'scale(1.3) translateY(20px)', transformOrigin: 'center center' }}>
                <Image src="/images/tag.png" alt="Tag" width={200} height={200} className="w-full h-full object-contain" />
              </div>
              {/* Frame overlay */}
              <Image src="/images/frame.png" alt="" width={600} height={700} className="relative z-10 w-full h-auto" />
              {/* Label at bottom of frame */}
              <div className="absolute bottom-0 left-0 right-0 z-20 pb-3 text-center" style={{ paddingLeft: '5%', paddingRight: '5%', bottom: '10px' }}>
                <p style={{ fontFamily: 'var(--font-handwriting)' }} className="text-[12px] leading-[17px] sm:text-[18px] sm:leading-[24px] text-ink-muted">Upload Tags</p>
              </div>
            </div>
            {/* Upload button separate */}
            <div className="w-full space-y-2">
              <div className="w-full">
                <UploadDropdown disabled={isLoading} multiple onFiles={(files) => setStaged((prev) => [...prev, ...files])} />
              </div>
              {staged.map((file, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-rule bg-bg px-3 py-2">
                  <span className="truncate text-[13px] text-ink">{file.name}</span>
                  <button type="button" onClick={() => removeStaged(i)} disabled={isLoading} className="ml-3 shrink-0 text-[12px] text-ink-muted hover:text-danger disabled:opacity-40">Remove</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="max-w-[49%] mx-auto">
            <button
              type="button"
              disabled
              className="w-full inline-flex items-center justify-center h-10 rounded-md bg-ink text-bg text-[14px] font-medium opacity-60"
            >
              Scanning...
            </button>
          </div>
        ) : canScan ? (
          <div className="max-w-[49%] mx-auto">
            <button
              type="button"
              onClick={handleScan}
              className="w-full inline-flex items-center justify-center h-10 rounded-md bg-ink text-bg text-[14px] font-medium"
            >
              Scan {totalQueued} image{totalQueued === 1 ? '' : 's'}
            </button>
          </div>
        ) : null}

        {error && <p className="text-[14px] text-danger">{error}</p>}
      </div>
    </main>
  );
}
