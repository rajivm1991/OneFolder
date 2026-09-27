import * as React from 'react';
import { useEffect, useState } from 'react';
import { action, when } from 'mobx';
import { observer } from 'mobx-react-lite';
import { encodeFilePath } from 'common/fs';
import { NormalizedBox } from '../../../api/face';
import { useStore } from '../../contexts/StoreContext';
import { ClientFile } from '../../entities/File';
import { usePromise } from '../../hooks/usePromise';
import { GalleryProps } from './utils';

interface FaceBox {
  boundingBox: NormalizedBox;
}

/** Faces are re-fetched after every this-many processed files (and when a run finishes), rather
 * than on every single progress tick. */
const REFRESH_EVERY_N_PROCESSED = 25;

/** Pure so it's testable without a React-rendering test library (none exists in this repo). */
export function visibleFaceBoxes(faces: FaceBox[], showBoxes: boolean): FaceBox[] {
  return showBoxes ? faces : [];
}

/** CSS for one box, as percentages of the image element the overlay is laid over. Boxes are
 * stored normalized (0–1), so this lines up at whatever size the thumbnail is rendered. */
export function faceBoxStyle(box: NormalizedBox): React.CSSProperties {
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.width * 100}%`,
    height: `${box.height * 100}%`,
  };
}

/** Groups face rows by their fileId. */
export function groupFacesByFile<T extends { fileId: string }>(faces: T[]): Map<string, T[]> {
  const byFile = new Map<string, T[]>();
  for (const face of faces) {
    const list = byFile.get(face.fileId);
    if (list) {
      list.push(face);
    } else {
      byFile.set(face.fileId, [face]);
    }
  }
  return byFile;
}

export const FaceOverlay: React.FC<{ faces: FaceBox[]; showBoxes: boolean }> = ({
  faces,
  showBoxes,
}) => {
  return (
    <>
      {visibleFaceBoxes(faces, showBoxes).map((face, i) => (
        <div
          key={i}
          data-testid={`face-box-${i}`}
          className="face-bounding-box"
          style={faceBoxStyle(face.boundingBox)}
        />
      ))}
    </>
  );
};

const getThumbnail = action((file: ClientFile) => file.thumbnailPath);

/** Shows the file's (generated-on-demand) thumbnail — never the full-resolution original, which
 * could be huge or in a format <img> can't show (HEIC, RAW...). A placeholder is shown until the
 * thumbnail exists, or if it can't be generated. */
const FaceThumbnail = observer(({ file }: { file: ClientFile }) => {
  const { imageLoader } = useStore();
  const imageSource = usePromise(file, async (file: ClientFile) => {
    const freshlyGenerated = await imageLoader.ensureThumbnail(file);
    // Once generated, the thumbnailPath gets a `?v=1` suffix (same as GalleryItem's Thumbnail)
    if (freshlyGenerated) {
      await when(() => getThumbnail(file).endsWith('?v=1'), { timeout: 10000 });
    }
    return getThumbnail(file);
  });
  const [loadError, setLoadError] = useState(false);

  if (imageSource.tag === 'ready' && 'ok' in imageSource.value && !loadError) {
    return (
      <img
        src={encodeFilePath(imageSource.value.ok)}
        alt={file.name}
        onError={() => setLoadError(true)}
      />
    );
  }
  return <div className="face-gallery-placeholder" title={file.name} />;
});

const FaceGallery: React.FC<GalleryProps> = observer(({ contentRect }) => {
  const { fileStore, faceDetectionStore } = useStore();
  const [showBoxes, setShowBoxes] = useState(true);
  const [facesByFile, setFacesByFile] = useState<Map<string, FaceBox[]>>(new Map());

  const refreshTick = faceDetectionStore.isRunning
    ? Math.floor(faceDetectionStore.processedCount / REFRESH_EVERY_N_PROCESSED)
    : -1; // also changes when a run ends, so its last few results show up

  useEffect(() => {
    let cancelled = false;
    // One batched query for the whole list instead of one query per file
    faceDetectionStore
      .getFacesForFiles(fileStore.fileList.map((f) => f.id))
      .then((faces) => {
        if (!cancelled) {
          setFacesByFile(groupFacesByFile(faces));
        }
      })
      .catch((err) => console.error('Could not load faces', err));
    return () => {
      cancelled = true;
    };
  }, [fileStore.fileList, refreshTick, faceDetectionStore]);

  // Face view shows the photos that contain at least one detected face
  const filesWithFaces = fileStore.fileList.filter((file) => facesByFile.has(file.id));

  return (
    <div className="face-gallery" style={{ width: contentRect.width, height: contentRect.height }}>
      <div className="face-gallery-toolbar">
        <button onClick={() => setShowBoxes((v) => !v)}>
          {showBoxes ? 'Hide face boxes' : 'Show face boxes'}
        </button>
        {faceDetectionStore.isRunning && (
          <span className="face-detection-progress">
            Detecting faces: {faceDetectionStore.processedCount} / {faceDetectionStore.totalCount}
          </span>
        )}
        {faceDetectionStore.modelLoadFailed && (
          <span className="face-detection-error">
            Face detection is unavailable: the detection model failed to load.
          </span>
        )}
      </div>
      <div className="face-gallery-grid">
        {filesWithFaces.map((file) => (
          <div key={file.id} className="face-gallery-item">
            <FaceThumbnail file={file} />
            <FaceOverlay faces={facesByFile.get(file.id) ?? []} showBoxes={showBoxes} />
          </div>
        ))}
        {filesWithFaces.length === 0 && !faceDetectionStore.isRunning && (
          <span className="face-gallery-empty">No faces found in these photos.</span>
        )}
      </div>
    </div>
  );
});

export default FaceGallery;
