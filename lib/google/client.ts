// Shared Google Cloud service-account credentials.
// All server-side Google API clients initialize from here.

import { GoogleAuth } from 'google-auth-library';

type GoogleServiceAccountCredentials = {
  project_id: string;
  client_email: string;
  private_key: string;
};

export function getGoogleCredentials() {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (!raw) {
    throw new Error('Missing GOOGLE_APPLICATION_CREDENTIALS_JSON');
  }

  let parsed: Partial<GoogleServiceAccountCredentials>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS_JSON must be valid JSON (service account object).',
    );
  }

  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS_JSON is missing one of project_id, client_email, or private_key.',
    );
  }

  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key.replace(/\\n/g, '\n'),
  };
}

export async function getGoogleAccessToken(scopes: string | string[]) {
  const credentials = getGoogleCredentials();
  const auth = new GoogleAuth({
    credentials: {
      type: 'service_account',
      project_id: credentials.projectId,
      client_email: credentials.clientEmail,
      private_key: credentials.privateKey,
    },
    scopes,
  });

  const token = await auth.getAccessToken();
  if (!token) {
    throw new Error('Failed to obtain Google access token.');
  }

  return token;
}
