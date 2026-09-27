import { makeObservable, observable, action, runInAction } from 'mobx';
import { promiseAllLimit } from 'common/promise';
import { generateId } from '../../api/id';

interface FileForDetection {
  id: string;
  absolutePath: string;
  dateModified: Date;
}

interface DetectedFace {
  boundingBox: { x: number; y: number; width: number; height: number };
  descriptor: number[];
}

interface FaceDTO {
  id: string;
  fileId: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  descriptor: number[];
  personId: string | null;
  dateDetected: Date;
}

interface FaceDetectionDataStorage {
  fetchFileIdsWithFaces(): Promise<Set<string>>;
  fetchFacesForFile(fileId: string): Promise<FaceDTO[]>;
  saveFaces(faces: FaceDTO[]): Promise<void>;
  removeFacesForFile(fileId: string): Promise<void>;
}

const CONCURRENCY = 3;
const MAX_RETRIES_PER_FILE = 1;

/** Thrown by `detectForFile` specifically when the bundled model failed to load — distinct
 * from a per-image decode/detection failure, which is retried; a model-load failure is not
 * retried per-file since it will fail identically for every subsequent file too. */
export class ModelLoadError extends Error {}

export class FaceDetectionStore {
  @observable processedCount = 0;
  @observable totalCount = 0;
  @observable isRunning = false;
  @observable modelLoadFailed = false;

  constructor(
    private dataStorage: FaceDetectionDataStorage,
    private detectForFile: (absolutePath: string) => Promise<DetectedFace[]>,
  ) {
    makeObservable(this);
  }

  async getFacesForFile(fileId: string): Promise<FaceDTO[]> {
    return this.dataStorage.fetchFacesForFile(fileId);
  }

  @action.bound
  async runDetectionBatch(files: FileForDetection[]): Promise<void> {
    if (this.modelLoadFailed) {
      return; // don't keep retrying a batch once the model is known to be unloadable
    }

    // Set synchronously (this is still within the action's synchronous prelude, before the
    // first `await`) so callers observe `isRunning`/`totalCount` flip immediately, without
    // waiting a microtask for `fetchFileIdsWithFaces` to resolve.
    this.totalCount = files.length;
    this.processedCount = 0;
    this.isRunning = files.length > 0;

    const alreadyDetected = await this.dataStorage.fetchFileIdsWithFaces();
    const pending = files.filter((f) => !alreadyDetected.has(f.id));

    runInAction(() => {
      this.totalCount = pending.length;
      this.processedCount = 0;
      this.isRunning = pending.length > 0;
    });

    if (pending.length === 0) {
      return;
    }

    const jobs = pending.map((file) => async () => {
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const faces = await this.detectForFile(file.absolutePath);
          await this.dataStorage.saveFaces(
            faces.map((f) => ({
              id: generateId(),
              fileId: file.id,
              boundingBox: f.boundingBox,
              descriptor: f.descriptor,
              personId: null,
              dateDetected: new Date(),
            })),
          );
          break;
        } catch (err) {
          if (err instanceof ModelLoadError) {
            runInAction(() => {
              this.modelLoadFailed = true;
            });
            break; // stop retrying this file; the whole batch will short-circuit above next call
          }
          attempt += 1;
          if (attempt > MAX_RETRIES_PER_FILE) {
            console.error(`Face detection failed for ${file.absolutePath} after retry`, err);
            break; // give up on this file only, mark it processed so the batch doesn't stall
          }
          // one retry, e.g. for a transient worker crash/timeout
        }
      }
      runInAction(() => {
        this.processedCount += 1;
      });
    });

    await promiseAllLimit(jobs, CONCURRENCY);

    runInAction(() => {
      this.isRunning = false;
    });
  }
}
