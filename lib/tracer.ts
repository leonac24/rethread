// Thin wrapper around dd-trace for creating spans across the scan pipeline.
// Centralizes span creation so every external call gets consistent tagging.

import tracer from 'dd-trace';

export { tracer };

/**
 * Run an async function inside a Datadog span.
 * Tags are attached to the span for filtering in Datadog APM.
 */
export async function traced<T>(
  name: string,
  tags: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.trace(name, { tags }, async (span) => {
    try {
      const result = await fn();
      return result;
    } catch (err) {
      if (span && err instanceof Error) {
        span.setTag('error', true);
        span.setTag('error.message', err.message);
      }
      throw err;
    }
  });
}
