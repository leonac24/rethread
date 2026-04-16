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

type UploadButtonProps = {
  label?: string;
  disabled?: boolean;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  buttonClassName?: string;
  buttonStyle?: React.CSSProperties;
};

function UploadButton({ label = 'Add photo', disabled, multiple, onFiles, buttonClassName, buttonStyle }: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length) onFiles(files);
    event.target.value = '';
  }

  return (
    <div className="relative z-30">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className={`w-full rounded-md bg-ink text-bg transition-opacity hover:opacity-80 disabled:opacity-50 cursor-pointer disabled:cursor-default ${buttonClassName ?? 'h-11 text-[14px] font-medium'}`}
        style={buttonStyle}
      >
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        onChange={handleChange}
        className="sr-only"
      />
    </div>
  );
}

export function CameraScan() {
  const router = useRouter();
  const [garmentPhoto, setGarmentPhoto] = useState<File | null>(null);
  const [staged, setStaged] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [stagedListOpen, setStagedListOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);

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

  const hasAll = garmentPhoto !== null && staged.length > 0;
  const totalQueued = staged.length + (garmentPhoto ? 1 : 0);

  const uploadError =
    garmentPhoto && !staged.length
      ? 'Please upload at least one tag photo.'
      : !garmentPhoto && staged.length > 0
        ? 'Please upload a photo of the garment.'
        : null;

  return (
    <main className="min-h-[calc(100svh-120px)] bg-bg py-6 flex items-center justify-center">
      <div className="w-[88%] max-w-[480px] mx-auto space-y-6 -translate-y-[5%]">

        {/* ── Cards + buttons row ── */}
        <div className="grid grid-cols-2 gap-x-[32px] items-start">

          {/* Garment */}
          <div className="flex flex-col items-center w-full">
            <div className="relative w-[130%] -mx-[15%]">
              <div className="absolute inset-0 flex items-center justify-center" style={{ paddingTop: '0%', paddingBottom: '16%', paddingLeft: '2%', paddingRight: '2%', transform: 'scale(1.3)', transformOrigin: 'center center' }}>
                <Image src="/images/garment.webp" alt="Garment" width={200} height={200} className="w-full h-full object-contain" />
              </div>
              <Image src="/images/frame.webp" alt="" width={600} height={700} className="relative z-10 w-full h-auto" />
              <div className="absolute z-20" style={{ bottom: '6%', left: '16%', right: '16%' }}>
                <UploadButton
                  label="Upload Garment"
                  disabled={isLoading}
                  multiple={false}
                  onFiles={(files) => setGarmentPhoto(files[0])}
                  buttonClassName="h-[7vw] sm:h-9 text-[2vw] sm:text-[13px]"
                  buttonStyle={{ fontFamily: 'var(--font-handwriting)' }}
                />
              </div>
            </div>
            <div className="relative z-30 w-full mt-2 min-h-[36px]">
              {garmentPhoto && (
                <div className="flex w-full items-center justify-between rounded-md border border-rule bg-bg px-3 py-2">
                  <span className="truncate text-[12px] text-ink">{garmentPhoto.name}</span>
                  <button type="button" onClick={() => setGarmentPhoto(null)} disabled={isLoading} className="ml-2 shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-[14px] text-ink-muted hover:text-danger hover:bg-danger/10 disabled:opacity-40 cursor-pointer">&times;</button>
                </div>
              )}
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-col items-center w-full">
            <div className="relative w-[130%] -mx-[15%]">
              <div className="absolute inset-0 flex items-center justify-center" style={{ paddingTop: '0%', paddingBottom: '16%', paddingLeft: '2%', paddingRight: '2%', transform: 'scale(1.3) translateY(20px)', transformOrigin: 'center center' }}>
                <Image src="/images/tag.webp" alt="Tag" width={200} height={200} className="w-full h-full object-contain" />
              </div>
              <Image src="/images/frame.webp" alt="" width={600} height={700} className="relative z-10 w-full h-auto" />
              <div className="absolute z-20" style={{ bottom: '6%', left: '16%', right: '16%' }}>
                <UploadButton
                  label={staged.length >= 3 ? 'Tags Full (3/3)' : 'Upload Tags'}
                  disabled={isLoading || staged.length >= 3}
                  multiple
                  onFiles={(files) =>
                    setStaged((prev) => [...prev, ...files].slice(0, 3))
                  }
                  buttonClassName="h-[7vw] sm:h-9 text-[2vw] sm:text-[13px]"
                  buttonStyle={{ fontFamily: 'var(--font-handwriting)' }}
                />
              </div>
            </div>
            <div className="relative z-30 w-full mt-2 min-h-[36px]">
              {staged.length === 1 && (
                <div className="flex items-center justify-between rounded-md border border-rule bg-bg px-3 py-2">
                  <span className="truncate text-[12px] text-ink">{staged[0].name}</span>
                  <button type="button" onClick={() => removeStaged(0)} disabled={isLoading} className="ml-2 shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-[14px] text-ink-muted hover:text-danger hover:bg-danger/10 disabled:opacity-40 cursor-pointer">&times;</button>
                </div>
              )}
              {staged.length > 1 && (
                <div className="w-full">
                  <button
                    type="button"
                    onClick={() => setStagedListOpen((v) => !v)}
                    className="flex w-full items-center justify-between rounded-md border border-rule bg-bg px-3 py-2 text-[12px] text-ink cursor-pointer"
                  >
                    <span>{staged.length} tags uploaded</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-ink-muted transition-transform ${stagedListOpen ? 'rotate-180' : ''}`}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {stagedListOpen && (
                    <div className="mt-1 rounded-md border border-rule bg-bg overflow-hidden">
                      {staged.map((file, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2 border-b border-rule last:border-b-0">
                          <span className="truncate text-[12px] text-ink">{file.name}</span>
                          <button type="button" onClick={() => removeStaged(i)} disabled={isLoading} className="ml-2 shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-[14px] text-ink-muted hover:text-danger hover:bg-danger/10 disabled:opacity-40 cursor-pointer">&times;</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {isLoading ? (
            <button
              type="button"
              disabled
              className="w-full inline-flex items-center justify-center h-10 rounded-md bg-ink text-bg text-[14px] font-medium opacity-50 cursor-default"
            >
              Scanning...
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { setAttempted(true); if (hasAll) handleScan(); }}
              disabled={isLoading}
              className="w-full inline-flex items-center justify-center h-10 rounded-md bg-ink text-bg text-[14px] font-medium transition-opacity disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              style={{ opacity: hasAll ? 1 : 0.4 }}
            >
              {hasAll ? `Scan ${totalQueued} image${totalQueued === 1 ? '' : 's'}` : 'Scan'}
            </button>
          )}
          {attempted && uploadError && <p className="text-[13px] text-danger text-center">{uploadError}</p>}
          {error && <p className="text-[13px] text-danger text-center">{error}</p>}
        </div>
      </div>
    </main>
  );
}
