'use client';

import { use } from 'react';
import { ResultView } from '@/components/result-view';

export default function ClosetDetailPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = use(params);
  return <ResultView id={scanId} readOnly />;
}
