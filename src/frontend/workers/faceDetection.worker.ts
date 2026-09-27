import fse from 'fs-extra';
import { detectFacesInImageBitmap } from './faceDetectionCore';

const ctx: Worker = self as any;

interface DetectRequest {
  type: 'detect';
  fileId: string;
  imagePath: string;
}

ctx.addEventListener('message', async (e: MessageEvent<DetectRequest>) => {
  const { type, fileId, imagePath } = e.data;
  if (type !== 'detect') {
    return;
  }
  try {
    const inputBuffer = await fse.readFile(imagePath);
    const bitmap = await createImageBitmap(new Blob([inputBuffer]));
    const faces = await detectFacesInImageBitmap(bitmap);
    ctx.postMessage({ type: 'result', fileId, faces });
  } catch (err) {
    const isModelLoadError = Boolean((err as { isModelLoadError?: boolean }).isModelLoadError);
    ctx.postMessage({ type: 'error', fileId, message: (err as Error).message, isModelLoadError });
  }
});
