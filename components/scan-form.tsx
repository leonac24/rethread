'use client';

import { useActionState } from 'react';

import { scanFromForm } from '@/app/actions/scan';

export function ScanForm() {
  const [result, formAction, isPending] = useActionState(scanFromForm, null);

  return (
    <section className="w-full max-w-2xl border border-rule bg-surface p-6 md:p-8">
      <h1
        className="font-display text-[32px] leading-[36px] text-ink"
        style={{ fontWeight: 500 }}
      >
        Tag Ingestion
      </h1>

      <p className="mt-3 text-[14px] leading-[20px] text-ink-muted">
        Upload one clothing tag photo to run OCR with Cloud Vision.
      </p>

      <form action={formAction} className="mt-6 space-y-4">
        <label className="block text-[12px] uppercase tracking-[0.12em] text-ink-muted">
          Tag photo
        </label>

        <input
          type="file"
          name="photo"
          accept="image/*"
          required
          className="block w-full text-[14px] text-ink file:mr-4 file:rounded-md file:border file:border-rule file:bg-bg file:px-3 file:py-2"
        />

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center h-10 px-5 rounded-md bg-ink text-bg text-[14px] font-medium disabled:opacity-60"
        >
          {isPending ? 'Scanning...' : 'Scan tag'}
        </button>
      </form>

      {result ? (
        <pre className="mt-6 overflow-x-auto rounded-md border border-rule bg-bg p-4 text-[12px] leading-[18px] text-ink">
          {JSON.stringify(result.garment, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}
