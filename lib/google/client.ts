// Shared Google Cloud service-account credentials.
// All server-side Google API clients initialize from here.

import { readFile } from 'node:fs/promises';

type GoogleCredentials = {
  projectId?: string;
  clientEmail: string;
  privateKey: string;
};

function parseCredentials(json: string): GoogleCredentials {
  const parsed = JSON.parse(json) as {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };

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

  const inlineJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (inlineJson) {
    cachedCredentials = parseCredentials(inlineJson);
    return cachedCredentials;
  }

  const base64Json = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
  if (base64Json) {
    const decoded = Buffer.from(base64Json, 'base64').toString('utf8');
    cachedCredentials = parseCredentials(decoded);
    return cachedCredentials;
  }

  throw new Error(
    'Missing Google credentials. Set GOOGLE_APPLICATION_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS_BASE64.',
  );
}

export async function getGoogleCredentialsFromFile(
  filePath: string,
): Promise<GoogleCredentials> {
  const contents = await readFile(filePath, 'utf8');
  return parseCredentials(contents);
}
