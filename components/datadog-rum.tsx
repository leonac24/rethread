'use client';

import { useEffect } from 'react';

export default function DatadogRum() {
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_DD_RUM_APPLICATION_ID;
    const clientToken = process.env.NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN;

    if (!appId || !clientToken) return;

    import('@datadog/browser-rum').then(({ datadogRum }) => {
      if (datadogRum.getInitConfiguration()) return; // already initialized

      datadogRum.init({
        applicationId: appId,
        clientToken,
        site: process.env.NEXT_PUBLIC_DD_RUM_SITE ?? 'datadoghq.com',
        service: 'rethread-web',
        env: process.env.NODE_ENV ?? 'development',
        version: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0',
        sessionSampleRate: 100,
        sessionReplaySampleRate: 20,
        trackUserInteractions: true,
        trackResources: true,
        trackLongTasks: true,
        defaultPrivacyLevel: 'mask-user-input',
        allowedTracingUrls: [
          { match: window.location.origin, propagatorTypes: ['datadog'] },
        ],
      });
    });
  }, []);

  return null;
}
