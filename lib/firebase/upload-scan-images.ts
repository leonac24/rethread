import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { clientStorage } from './client';

type UploadScanImagesParams = {
  uid: string;
  scanId: string;
  dataUrls: string[];
};

async function uploadOne(uid: string, scanId: string, dataUrl: string, index: number): Promise<string | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const path = `scans/${uid}/${scanId}/${index}.jpg`;
    const storageRef = ref(clientStorage(), path);
    const snapshot = await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
    return await getDownloadURL(snapshot.ref);
  } catch (err) {
    console.error('[upload-scan-images] upload failed', {
      uid,
      scanId,
      index,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function uploadScanImages({ uid, scanId, dataUrls }: UploadScanImagesParams): Promise<string[]> {
  const results = await Promise.all(
    dataUrls.map((dataUrl, index) => uploadOne(uid, scanId, dataUrl, index)),
  );
  const urls = results.filter((url): url is string => url !== null);
  return urls;
}
