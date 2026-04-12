'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { ScanResult } from '@/types/garment';

type ScanResponse = {
  id: string;
  text: string;
  result: ScanResult;
};

export function CameraScan() {
  const router = useRouter();
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setError('');
    setText('');
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append('photo', file);

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

      setText(payload.text ?? '');

      if (payload.id && payload.result && typeof payload.text === 'string') {
        sessionStorage.setItem(
          `scan:${payload.id}`,
          JSON.stringify({ text: payload.text, result: payload.result }),
        );
        router.push(`/result/${payload.id}`);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Scan failed.');
    } finally {
      setIsLoading(false);
      event.target.value = '';
    }
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
            <span className="block text-[14px] font-medium text-ink">
              {isLoading ? 'Scanning...' : 'Open camera'}
            </span>
          </button>

          <button
            type="button"
            onClick={openUpload}
            disabled={isLoading}
            className="rounded-md border border-rule bg-bg px-4 py-5 text-left transition-colors hover:bg-surface-sunk disabled:opacity-60"
          >
            <span className="block text-[14px] font-medium text-ink">
              {isLoading ? 'Scanning...' : 'Upload image'}
            </span>
          </button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleChange}
          className="sr-only"
          aria-label="Capture a tag photo"
        />

        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          onChange={handleChange}
          className="sr-only"
          aria-label="Upload a tag photo"
        />

        <div className="mt-4 min-h-24 rounded-md border border-rule bg-bg p-4">
          {isLoading ? (
            <p className="text-[14px] text-ink-muted">Uploading and reading text...</p>
          ) : error ? (
            <p className="text-[14px] text-danger">{error}</p>
          ) : text ? (
            <pre className="whitespace-pre-wrap text-[14px] leading-[22px] text-ink">
              {text}
            </pre>
          ) : (
            <p className="text-[14px] text-ink-muted">Your OCR result will appear here.</p>
          )}
        </div>
      </section>
    </main>
  );
}