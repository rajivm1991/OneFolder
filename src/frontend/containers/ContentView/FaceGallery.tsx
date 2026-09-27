import * as React from 'react';
import { useEffect, useState } from 'react';
import { action, when } from 'mobx';
import { observer } from 'mobx-react-lite';
import { encodeFilePath } from 'common/fs';
import { NormalizedBox } from '../../../api/face';
import { PersonDTO } from '../../../api/person';
import { ID } from '../../../api/id';
import { useStore } from '../../contexts/StoreContext';
import { ClientFile } from '../../entities/File';
import { usePromise } from '../../hooks/usePromise';
import { GalleryProps } from './utils';

interface FaceBox {
  boundingBox: NormalizedBox;
}

interface FaceWithPerson {
  personId: ID | null;
  fileId: ID;
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

/** Groups face rows by personId, dropping faces with no assigned person (personId === null) —
 * those never appear on the People grid since there's no person tile to group them under. */
export function groupFacesByPerson<T extends FaceWithPerson>(faces: T[]): Map<ID, T[]> {
  const byPerson = new Map<ID, T[]>();
  for (const face of faces) {
    if (face.personId === null) {
      continue;
    }
    const list = byPerson.get(face.personId);
    if (list) {
      list.push(face);
    } else {
      byPerson.set(face.personId, [face]);
    }
  }
  return byPerson;
}

/** Files that have at least one face in `facesForPerson`, in the same order as `files`. */
export function filterFilesForPerson<F extends { id: ID }, T extends { fileId: ID }>(
  files: F[],
  facesForPerson: T[],
): F[] {
  const fileIds = new Set(facesForPerson.map((f) => f.fileId));
  return files.filter((f) => fileIds.has(f.id));
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

/** The default view: one tile per person. */
const PeopleGrid: React.FC<{ onSelectPerson: (personId: ID) => void }> = observer(
  ({ onSelectPerson }) => {
    const { fileStore, faceDetectionStore } = useStore();
    const [people, setPeople] = useState<PersonDTO[]>([]);
    const [facesByFile, setFacesByFile] = useState<Map<string, FaceWithPerson[]>>(new Map());

    const refreshTick = faceDetectionStore.isRunning
      ? Math.floor(faceDetectionStore.processedCount / REFRESH_EVERY_N_PROCESSED)
      : -1; // also changes when a run ends, so its last few results show up

    useEffect(() => {
      let cancelled = false;
      Promise.all([
        faceDetectionStore.getAllPeople(),
        faceDetectionStore.getFacesForFiles(fileStore.fileList.map((f) => f.id)),
      ])
        .then(([people, faces]) => {
          if (!cancelled) {
            setPeople(people);
            setFacesByFile(groupFacesByFile(faces));
          }
        })
        .catch((err) => console.error('Could not load people', err));
      return () => {
        cancelled = true;
      };
    }, [fileStore.fileList, refreshTick, faceDetectionStore]);

    // Representative face + its file, per person — for the tile thumbnail + box crop.
    const allFaces = Array.from(facesByFile.values()).flat();
    const facesByPerson = groupFacesByPerson(allFaces as (FaceWithPerson & FaceBox)[]);

    return (
      <div className="face-gallery-toolbar">
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
        <div className="people-grid">
          {people.map((person) => {
            const count = facesByPerson.get(person.id)?.length ?? 0;
            if (count === 0) {
              return null; // no photos of this person currently loaded/matching the file list
            }
            return (
              <button
                key={person.id}
                className="person-tile"
                onClick={() => onSelectPerson(person.id)}
              >
                <span className="person-tile-name">{person.name || 'Unnamed'}</span>
                <span className="person-tile-count">
                  {count} photo{count === 1 ? '' : 's'}
                </span>
              </button>
            );
          })}
          {people.length === 0 && !faceDetectionStore.isRunning && (
            <span className="face-gallery-empty">No people found yet.</span>
          )}
        </div>
      </div>
    );
  },
);

/** Shown after clicking a person: every photo of them, boxed on THEIR face only. */
const PersonGallery: React.FC<{ personId: ID; onBack: () => void }> = observer(
  ({ personId, onBack }) => {
    const { fileStore, faceDetectionStore } = useStore();
    const [person, setPerson] = useState<PersonDTO | undefined>(undefined);
    const [facesForPerson, setFacesForPerson] = useState<(FaceWithPerson & FaceBox)[]>([]);
    const [showBoxes, setShowBoxes] = useState(true);
    const [nameDraft, setNameDraft] = useState('');

    const refreshTick = faceDetectionStore.isRunning
      ? Math.floor(faceDetectionStore.processedCount / REFRESH_EVERY_N_PROCESSED)
      : -1;

    useEffect(() => {
      let cancelled = false;
      Promise.all([
        faceDetectionStore.getAllPeople(),
        faceDetectionStore.getFacesForFiles(fileStore.fileList.map((f) => f.id)),
      ])
        .then(([people, faces]) => {
          if (cancelled) {
            return;
          }
          const found = people.find((p) => p.id === personId);
          setPerson(found);
          setNameDraft(found?.name ?? '');
          setFacesForPerson(
            (faces as (FaceWithPerson & FaceBox)[]).filter((f) => f.personId === personId),
          );
        })
        .catch((err) => console.error('Could not load person', err));
      return () => {
        cancelled = true;
      };
    }, [personId, fileStore.fileList, refreshTick, faceDetectionStore]);

    const facesByFile = groupFacesByFile(facesForPerson);
    const filesForPerson = filterFilesForPerson(fileStore.fileList, facesForPerson);

    const commitName = () => {
      faceDetectionStore
        .renamePerson(personId, nameDraft.trim())
        .catch((err) => console.error('Could not rename person', err));
    };

    return (
      <div className="face-gallery-toolbar">
        <button onClick={onBack}>Back to people</button>
        <input
          className="person-name-input"
          value={nameDraft}
          placeholder="Unnamed"
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
          }}
        />
        <button onClick={() => setShowBoxes((v) => !v)}>
          {showBoxes ? 'Hide face box' : 'Show face box'}
        </button>
        {faceDetectionStore.isRunning && (
          <span className="face-detection-progress">
            Detecting faces: {faceDetectionStore.processedCount} / {faceDetectionStore.totalCount}
          </span>
        )}
        <div className="face-gallery-grid">
          {filesForPerson.map((file) => (
            <div key={file.id} className="face-gallery-item">
              <FaceThumbnail file={file} />
              <FaceOverlay faces={facesByFile.get(file.id) ?? []} showBoxes={showBoxes} />
            </div>
          ))}
          {filesForPerson.length === 0 && (
            <span className="face-gallery-empty">No photos found for this person.</span>
          )}
        </div>
        {person === undefined && (
          <span className="face-gallery-empty">This person could not be found.</span>
        )}
      </div>
    );
  },
);

const FaceGallery: React.FC<GalleryProps> = observer(({ contentRect }) => {
  const [selectedPersonId, setSelectedPersonId] = useState<ID | null>(null);

  return (
    <div className="face-gallery" style={{ width: contentRect.width, height: contentRect.height }}>
      {selectedPersonId === null ? (
        <PeopleGrid onSelectPerson={setSelectedPersonId} />
      ) : (
        <PersonGallery personId={selectedPersonId} onBack={() => setSelectedPersonId(null)} />
      )}
    </div>
  );
});

export default FaceGallery;
