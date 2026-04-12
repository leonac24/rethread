import { readClothingLabelText } from '@/lib/google/vision';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('photo');

  if (!(file instanceof File)) {
    return Response.json({ error: 'Missing image file in field "photo".' }, { status: 400 });
  }

  if (!file.type.startsWith('image/')) {
    return Response.json({ error: 'Uploaded file must be an image.' }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const text = await readClothingLabelText(Buffer.from(bytes));

  return Response.json({ text });
}