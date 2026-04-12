import { getScanById } from '@/lib/scan-store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return Response.json({ error: 'Invalid scan ID format.' }, { status: 400 });
  }

  try {
    const scan = await getScanById(id);

    if (!scan) {
      return Response.json({ error: 'Scan result not found.' }, { status: 404 });
    }

    return Response.json({
      id: scan.id,
      text: scan.text,
      result: scan.result,
      createdAt: scan.createdAt,
    });
  } catch {
    return Response.json({ error: 'Failed to retrieve scan result.' }, { status: 500 });
  }
}
