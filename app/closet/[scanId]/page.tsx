'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/firebase/auth-context';
import { ResultView } from '@/components/result-view';

export default function ClosetDetailPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = use(params);
  const { firebaseUser } = useAuth();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!firebaseUser) return;
    setDeleting(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/user/scans/${scanId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Failed to delete.');
      }
      router.push('/profile');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.');
      setDeleting(false);
    }
  }

  return (
    <>
      <ResultView id={scanId} readOnly />
      {firebaseUser && (
      <div className="content-width pb-10 -mt-3">
        {!confirming ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-[13px] font-semibold text-danger underline underline-offset-2 hover:opacity-80 cursor-pointer"
            >
              Remove from closet
            </button>
          </div>
        ) : (
          <div
            className="rounded-2xl p-5 bg-surface"
            style={{ boxShadow: '0 2px 16px rgba(20,22,26,0.07)' }}
          >
            <p className="text-[15px] font-semibold text-ink mb-1">
              Remove this garment from your closet?
            </p>
            <p className="text-[14px] text-ink-muted mb-4">
              Your environmental credit for this item will be reversed and the scan will be deleted.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setError(null);
                }}
                disabled={deleting}
                className="flex-1 rounded-xl py-3 text-[15px] font-semibold text-ink-muted border border-rule transition-colors hover:bg-surface-sunk disabled:opacity-50 cursor-pointer disabled:cursor-default"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 rounded-xl py-3 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-default"
                style={{ backgroundColor: '#B23A2B' }}
              >
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
            {error && <p className="text-[13px] text-danger mt-3">{error}</p>}
          </div>
        )}
      </div>
      )}
    </>
  );
}
