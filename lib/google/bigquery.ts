// BigQuery — brand-level sustainability grounding
// (Good On You, Fashion Transparency Index, etc.).

import { getGoogleAccessToken, getGoogleCredentials } from '@/lib/google/client';

type BigQueryQueryResponse = {
  rows?: Array<{
    f: Array<{ v: string }>;
  }>;
  errors?: Array<{ message: string }>;
};

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
  if (!brand?.trim()) {
    return null;
  }

  const credentials = getGoogleCredentials();
  const tableInput = process.env.BIGQUERY_DATASET;

  if (!tableInput) {
    return null;
  }

  const brandColumn = process.env.BIGQUERY_BRAND_COLUMN?.trim() || 'brand';
  const { projectId, datasetId, tableId } = resolveTableRef(
    tableInput,
    credentials.projectId,
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

  const response = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`,
    {
      method: 'POST',
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
    throw new Error(`BigQuery request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as BigQueryQueryResponse;
  if (data.errors?.length) {
    throw new Error(`BigQuery error: ${data.errors[0]?.message || 'Unknown error'}`);
  }

  const rowJson = data.rows?.[0]?.f?.[0]?.v;
  if (!rowJson) {
    return null;
  }

  return `Brand sustainability context for "${brand.trim()}": ${rowJson}`;
}
