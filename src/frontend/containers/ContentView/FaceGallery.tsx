import * as React from 'react';
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '../../contexts/StoreContext';
import { GalleryProps } from './utils';

interface FaceBox {
  boundingBox: { x: number; y: number; width: number; height: number };
}

/** Pure so it's testable without a React-rendering test library (none exists in this repo). */
export function visibleFaceBoxes(faces: FaceBox[], showBoxes: boolean): FaceBox[] {
  return showBoxes ? faces : [];
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
          style={{
            left: face.boundingBox.x,
            top: face.boundingBox.y,
            width: face.boundingBox.width,
            height: face.boundingBox.height,
          }}
        />
      ))}
    </>
  );
};

const FaceGallery: React.FC<GalleryProps> = observer(({ contentRect }) => {
  const { fileStore, faceDetectionStore } = useStore();
  const [showBoxes, setShowBoxes] = useState(true);
  const [facesByFile, setFacesByFile] = useState<Map<string, FaceBox[]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    async function loadFaces() {
      const entries = await Promise.all(
        fileStore.fileList.map(async (file) => {
          const faces = await faceDetectionStore.getFacesForFile(file.id);
          return [file.id, faces] as const;
        }),
      );
      if (!cancelled) {
        setFacesByFile(new Map(entries));
      }
    }
    loadFaces();
    return () => {
      cancelled = true;
    };
  }, [fileStore.fileList, faceDetectionStore.processedCount]);

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
        {fileStore.fileList.map((file) => (
          <div key={file.id} className="face-gallery-item">
            <img src={file.thumbnailPath || file.absolutePath} alt={file.name} />
            <FaceOverlay faces={facesByFile.get(file.id) ?? []} showBoxes={showBoxes} />
          </div>
        ))}
      </div>
    </div>
  );
});

export default FaceGallery;
