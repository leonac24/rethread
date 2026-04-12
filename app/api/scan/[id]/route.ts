import { getScanById } from '@/lib/scan-store';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scan = getScanById(id);

  if (!scan) {
    return Response.json({ error: 'Scan result not found.' }, { status: 404 });
  }

  return Response.json({
    id: scan.id,
    text: scan.text,
    result: scan.result,
    createdAt: scan.createdAt,
  });
}
