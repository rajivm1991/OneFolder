import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
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

type FaceTileData = FaceWithPerson & FaceBox & { descriptor?: number[] };

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

/** Smallest box side used when cropping, so a degenerate (0-size) stored box can't produce an
 * infinite scale. */
const MIN_CROP_SIDE = 0.01;

/** CSS for an <img> inside a square, `overflow: hidden`, `position: relative` frame, scaled and
 * shifted so the frame shows exactly the normalized `box` region of the image. Width/left
 * percentages resolve against the frame's width and height/top against its height, so this works
 * at any frame size without knowing the image's pixel dimensions. A face box is roughly square in
 * pixels, so stretching it to the square frame barely distorts it. */
export function faceCropStyle(box: NormalizedBox): React.CSSProperties {
  const width = Math.max(box.width, MIN_CROP_SIDE);
  const height = Math.max(box.height, MIN_CROP_SIDE);
  return {
    position: 'absolute',
    left: `${(-box.x / width) * 100}%`,
    top: `${(-box.y / height) * 100}%`,
    width: `${100 / width}%`,
    height: `${100 / height}%`,
    maxWidth: 'none',
    maxHeight: 'none',
  };
}

/** The face a person's tile shows: the one their `representativeDescriptor` was taken from (the
 * first face ever assigned to them), if it's still among `faces`; otherwise just the first face. */
export function pickRepresentativeFace<T extends { descriptor?: number[] }>(
  faces: T[],
  representativeDescriptor: number[],
): T | undefined {
  const isRepresentative = (d: number[] | undefined) =>
    d !== undefined &&
    d.length === representativeDescriptor.length &&
    d.every((v, i) => v === representativeDescriptor[i]);
  return faces.find((f) => isRepresentative(f.descriptor)) ?? faces[0];
}

/** Whether the person gallery's name field should be (re)filled from the loaded person: only
 * the first time a given person's data arrives, NOT on the periodic refreshes while detection
 * runs — those would overwrite whatever the user is typing. */
export function shouldSyncNameDraft(
  syncedForPersonId: ID | null,
  personId: ID,
  loadedPerson: PersonDTO | undefined,
): boolean {
  return loadedPerson !== undefined && syncedForPersonId !== personId;
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
const FaceThumbnail = observer(
  ({ file, imgStyle }: { file: ClientFile; imgStyle?: React.CSSProperties }) => {
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
          style={imgStyle}
          onError={() => setLoadError(true)}
        />
      );
    }
    return <div className="face-gallery-placeholder" title={file.name} />;
  },
);

/** The default view: one tile per person. */
const formatWaited = (seconds: number): string =>
  seconds < 60 ? 'under a minute' : `${Math.floor(seconds / 60)} min`;

const formatRemaining = (seconds: number): string =>
  seconds < 60 ? 'under a minute' : `${Math.ceil(seconds / 60)} min`;

const PeopleGrid: React.FC<{ onSelectPerson: (personId: ID) => void }> = observer(
  ({ onSelectPerson }) => {
    const { fileStore, faceDetectionStore } = useStore();
    const [people, setPeople] = useState<PersonDTO[]>([]);
    const [facesByFile, setFacesByFile] = useState<Map<string, FaceTileData[]>>(new Map());

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
    const facesByPerson = groupFacesByPerson(allFaces);
    const filesById = useMemo(
      () => new Map(fileStore.fileList.map((f) => [f.id, f])),
      [fileStore.fileList],
    );
    // Most photos first; Array.sort is stable so ties keep their original order.
    const sortedPeople = [...people].sort(
      (a, b) => (facesByPerson.get(b.id)?.length ?? 0) - (facesByPerson.get(a.id)?.length ?? 0),
    );

    // Toolbar and grid are siblings: the toolbar is a non-wrapping flex row, so a grid nested
    // inside it would be squeezed in next to the status text instead of laid out below it.
    return (
      <>
        <div className="face-gallery-toolbar">
          {faceDetectionStore.libraryTotal > 0 && (
            <span className="face-detection-progress">
              Scanned for faces:{' '}
              {faceDetectionStore.libraryTotal - faceDetectionStore.unscannedCount} /{' '}
              {faceDetectionStore.libraryTotal} photos
            </span>
          )}
          {!faceDetectionStore.isRunning && faceDetectionStore.unscannedCount > 0 && (
            <button onClick={() => faceDetectionStore.startScanning()}>
              Click here to start scanning
            </button>
          )}
          {faceDetectionStore.isRunning && (
            <button onClick={() => faceDetectionStore.setPaused(!faceDetectionStore.isPaused)}>
              {faceDetectionStore.isPaused ? 'Resume' : 'Pause'}
            </button>
          )}
          {faceDetectionStore.isRunning && faceDetectionStore.isCoolingDown && (
            <span className="face-detection-progress">
              Computer reached a {faceDetectionStore.thermalState} temperature, waiting for it to
              cool down ({formatWaited(faceDetectionStore.coolingSeconds)} so far)
            </span>
          )}
          {faceDetectionStore.isRunning && faceDetectionStore.restSecondsLeft > 0 && (
            <span className="face-detection-progress">
              Temperature dropped, resting {formatRemaining(faceDetectionStore.restSecondsLeft)}{' '}
              more to cool down further
            </span>
          )}
          {faceDetectionStore.modelLoadFailed && (
            <span className="face-detection-error">
              Face detection is unavailable: the detection model failed to load.
            </span>
          )}
        </div>
        <div className="people-grid">
          {sortedPeople.map((person) => {
            const faces = facesByPerson.get(person.id) ?? [];
            const count = faces.length;
            if (count === 0) {
              return null; // no photos of this person currently loaded/matching the file list
            }
            const face = pickRepresentativeFace(faces, person.representativeDescriptor);
            const faceFile = face !== undefined ? filesById.get(face.fileId) : undefined;
            return (
              <button
                key={person.id}
                className="person-tile"
                onClick={() => onSelectPerson(person.id)}
              >
                <div className="person-tile-face">
                  {face !== undefined && faceFile !== undefined && (
                    <FaceThumbnail file={faceFile} imgStyle={faceCropStyle(face.boundingBox)} />
                  )}
                </div>
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
      </>
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
    // The person the name field was last filled for (see shouldSyncNameDraft)
    const nameDraftSyncedFor = useRef<ID | null>(null);

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
          if (shouldSyncNameDraft(nameDraftSyncedFor.current, personId, found)) {
            nameDraftSyncedFor.current = personId;
            setNameDraft(found!.name);
          }
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

    // Toolbar and grid are siblings (see PeopleGrid)
    return (
      <>
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
        </div>
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
      </>
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
