import fse from 'fs-extra';
import { detectFacesInImageBitmap } from './faceDetectionCore';

const ctx: Worker = self as any;

interface DetectRequest {
  type: 'detect';
  /** Unique per request (not per file) — the dispatcher routes the response back by this id */
  requestId: number;
  imagePath: string;
}

ctx.addEventListener('message', async (e: MessageEvent<DetectRequest>) => {
  const { type, requestId, imagePath } = e.data;
  if (type !== 'detect') {
    return;
  }
  let bitmap: ImageBitmap | undefined;
  try {
    const inputBuffer = await fse.readFile(imagePath);
    bitmap = await createImageBitmap(new Blob([inputBuffer]));
    const faces = await detectFacesInImageBitmap(bitmap, fse.readFile);
    ctx.postMessage({ type: 'result', requestId, faces });
  } catch (err) {
    const isModelLoadError = Boolean((err as { isModelLoadError?: boolean }).isModelLoadError);
    ctx.postMessage({ type: 'error', requestId, message: (err as Error).message, isModelLoadError });
  } finally {
    // Release the decoded pixels right away rather than waiting for GC
    bitmap?.close();
  }
});
