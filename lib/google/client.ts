// Shared Google Cloud service-account credentials.
// All server-side Google API clients initialize from here.

import { readFileSync } from 'node:fs';

type GoogleCredentials = {
  projectId?: string;
  clientEmail: string;
  privateKey: string;
};

function parseCredentials(json: string): GoogleCredentials {
  let parsed: { project_id?: string; client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    throw new Error('Google credentials JSON is not valid JSON. Check the environment variable.');
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      'Invalid Google credentials JSON: missing client_email or private_key',
    );
  }

  return {
    projectId: process.env.GOOGLE_CLOUD_PROJECT ?? parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

let cachedCredentials: GoogleCredentials | null = null;

export function getGoogleCredentials() {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  const filePath = process.env.GOOGLE_APPLICATION_CREDENTIALS_FILE;
  if (filePath) {
    // readFileSync is acceptable here — called at most once due to caching above
    const contents = readFileSync(filePath, 'utf8');
    cachedCredentials = parseCredentials(contents);
    return cachedCredentials;
  }

  const inlineJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (inlineJson) {
    cachedCredentials = parseCredentials(inlineJson);
    return cachedCredentials;
  }

  const base64Json = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
  if (base64Json) {
    let decoded: string;
    try {
      decoded = Buffer.from(base64Json, 'base64').toString('utf8');
    } catch {
      throw new Error('Failed to decode GOOGLE_APPLICATION_CREDENTIALS_BASE64: invalid base64');
    }
    cachedCredentials = parseCredentials(decoded);
    return cachedCredentials;
  }

  throw new Error(
    'Missing Google credentials. Set GOOGLE_APPLICATION_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS_BASE64.',
  );
}
