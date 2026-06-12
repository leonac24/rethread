// Next.js instrumentation hook — initializes dd-trace before any other imports.
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { default: tracer } = await import('dd-trace');
    tracer.init({
      service: 'rethread-api',
      env: process.env.NODE_ENV ?? 'development',
      version: process.env.npm_package_version ?? '0.1.0',
      logInjection: true,
      runtimeMetrics: true,
      profiling: process.env.DD_PROFILING_ENABLED === 'true',
    });
  }
}
