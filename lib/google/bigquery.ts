// BigQuery — brand-level sustainability grounding
// (Good On You, Fashion Transparency Index, etc.).

import { getGoogleAccessToken, getGoogleCredentials } from '@/lib/google/client';
import { log } from '@/lib/logger';
import { BRAND_CACHE_TTL_MS, BIGQUERY_TIMEOUT_MS } from '@/lib/config';
import { withRetry, HttpError } from '@/lib/retry';

type BigQueryQueryResponse = {
  rows?: Array<{
    f: Array<{ v: string }>;
  }>;
  errors?: Array<{ message: string }>;
};

// Column names must match ^[a-zA-Z_][a-zA-Z0-9_]{0,127}$ to prevent SQL injection
const COLUMN_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;

// In-memory brand context cache — avoids redundant BigQuery calls for the same brand
const brandCache = new Map<string, { result: string | null; cachedAt: number }>();

function resolveTableRef(tableInput: string, defaultProject: string) {
  const parts = tableInput.split('.').filter(Boolean);

  if (parts.length === 2) {
    return {
      projectId: defaultProject,
      datasetId: parts[0],
      tableId: parts[1],
    };
  }

  if (parts.length === 3) {
    return {
      projectId: parts[0],
      datasetId: parts[1],
      tableId: parts[2],
    };
  }

  throw new Error(
    'BIGQUERY_DATASET must be either "dataset.table" or "project.dataset.table".',
  );
}

export async function getBrandContext(
  brand: string,
): Promise<string | null> {
  if (!brand?.trim()) return null;
  if (brand.length > 256) {
    log.warn('Brand string too long, skipping BigQuery lookup', { stage: 'cost', length: brand.length });
    return null;
  }

  const brandKey = brand.trim().toLowerCase();

  // Return from cache if still fresh
  const cached = brandCache.get(brandKey);
  if (cached && Date.now() - cached.cachedAt < BRAND_CACHE_TTL_MS) {
    return cached.result;
  }

  const credentials = getGoogleCredentials();
  const tableInput = process.env.BIGQUERY_DATASET;

  if (!tableInput) {
    return null;
  }

  const defaultProject = credentials.projectId;
  if (!defaultProject) {
    throw new Error(
      'Missing Google project id. Set GOOGLE_CLOUD_PROJECT or include project_id in service account credentials.',
    );
  }

  const brandColumn = process.env.BIGQUERY_BRAND_COLUMN?.trim() || 'brand';

  // Validate column name to prevent SQL injection via env var
  if (!COLUMN_NAME_RE.test(brandColumn)) {
    throw new Error(
      `Invalid BIGQUERY_BRAND_COLUMN value: "${brandColumn}". Must be a valid SQL identifier.`,
    );
  }

  const { projectId, datasetId, tableId } = resolveTableRef(
    tableInput,
    defaultProject,
  );

  const token = await getGoogleAccessToken([
    'https://www.googleapis.com/auth/bigquery.readonly',
  ]);

  const query = `
    SELECT TO_JSON_STRING(t) AS row_json
    FROM \`${projectId}.${datasetId}.${tableId}\` AS t
    WHERE LOWER(CAST(t.${brandColumn} AS STRING)) = LOWER(@brand)
    LIMIT 1
  `;

  const data = await withRetry(async () => {
    const response = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(BIGQUERY_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          useLegacySql: false,
          maxResults: 1,
          parameterMode: 'NAMED',
          queryParameters: [
            {
              name: 'brand',
              parameterType: { type: 'STRING' },
              parameterValue: { value: brand.trim() },
            },
          ],
        }),
      },
    );
    if (!response.ok) {
      const text = await response.text();
      throw new HttpError(response.status, `BigQuery request failed (${response.status}): ${text}`);
    }
    return response.json() as Promise<BigQueryQueryResponse>;
  }, { retries: 2, label: 'BigQuery' });
  if (data.errors?.length) {
    throw new Error(`BigQuery error: ${data.errors[0]?.message || 'Unknown error'}`);
  }

  const rowJson = data.rows?.[0]?.f?.[0]?.v;
  const result = rowJson ? `Brand sustainability context for "${brand.trim()}": ${rowJson}` : null;

  brandCache.set(brandKey, { result, cachedAt: Date.now() });
  log.info('BigQuery brand context fetched', { stage: 'cost', brand: brandKey, found: !!result });

  return result;
}
