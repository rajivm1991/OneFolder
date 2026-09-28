import { makeObservable, observable, runInAction } from 'mobx';
import { FaceDetectionStatusDTO, FaceDTO, NormalizedBox } from '../../api/face';
import { FileDTO } from '../../api/file';
import { generateId, ID } from '../../api/id';
import { PersonDTO } from '../../api/person';

/** `dateLastIndexed` (not `dateModified`!) is the content-change signal: LocationStore bumps it
 * when a file changed on disk, while FileDTO.dateModified means "edited in OneFolder" (e.g. tags)
 * and is NOT updated on a disk change. */
export type FileForDetection = Pick<FileDTO, 'id' | 'absolutePath' | 'dateLastIndexed'>;

interface DetectedFace {
  boundingBox: NormalizedBox;
  descriptor: number[];
}

interface FaceDetectionDataStorage {
  fetchFacesForFiles(fileIds: ID[]): Promise<FaceDTO[]>;
  fetchFaceDetectionStatuses(fileIds: ID[]): Promise<FaceDetectionStatusDTO[]>;
  fetchAllPeople(): Promise<PersonDTO[]>;
  renamePerson(personId: ID, name: string): Promise<void>;
  saveFaceDetectionResult(
    status: FaceDetectionStatusDTO,
    faces: FaceDTO[],
    people: PersonDTO[],
  ): Promise<void>;
}

const CONCURRENCY = 3;
const MAX_RETRIES_PER_FILE = 1;

/** Euclidean distance below which two face descriptors are considered the same person. 0.6 is
 * face-api.js's documented upper bound for "same person" but merges distinct people too often in
 * practice; 0.5 trades that for occasionally splitting one person into two clusters, which a
 * future merge feature can fix — a false merge has no such recovery path today. Not user-facing/
 * tunable in this pass. */
const PERSON_MATCH_THRESHOLD = 0.5;

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/** The bundled model failed to load — permanent for the whole session, never retried per-file. */
export class ModelLoadError extends Error {}

/** A timeout or worker crash — the only kind of failure worth retrying. Any other per-image error
 * (e.g. an undecodable/corrupt file) fails identically on retry, so it's recorded as 'failed'. */
export class TransientDetectionError extends Error {}

/** Whether a file needs (re)detection given its status record (if any). */
export function needsDetection(
  file: FileForDetection,
  status: FaceDetectionStatusDTO | undefined,
): boolean {
  return status === undefined || status.dateDetected.getTime() < file.dateLastIndexed.getTime();
}

/**
 * Owns ONE pending queue (deduplicated by file id) and at most ONE drain loop. All callers feed
 * files in via `enqueueFiles`; concurrent calls just add to the same queue, so a file is never
 * processed by two overlapping batches and progress counters aren't reset under a running drain.
 */
export class FaceDetectionStore {
  @observable processedCount = 0;
  @observable totalCount = 0;
  @observable isRunning = false;
  @observable modelLoadFailed = false;

  private readonly queue = new Map<ID, FileForDetection>();
  private readonly inFlight = new Set<ID>();
  private drainPromise: Promise<void> | undefined;
  private peopleCache: PersonDTO[] | undefined;
  private peopleCachePromise: Promise<PersonDTO[]> | undefined;

  constructor(
    private dataStorage: FaceDetectionDataStorage,
    private detectForFile: (absolutePath: string) => Promise<DetectedFace[]>,
  ) {
    makeObservable(this);
  }

  async getFacesForFiles(fileIds: ID[]): Promise<FaceDTO[]> {
    return this.dataStorage.fetchFacesForFiles(fileIds);
  }

  async getAllPeople(): Promise<PersonDTO[]> {
    return this.dataStorage.fetchAllPeople();
  }

  async renamePerson(personId: ID, name: string): Promise<void> {
    await this.dataStorage.renamePerson(personId, name);
    // Keep the in-memory cache used for clustering consistent with the rename, so a
    // newly-detected face's person still shows its latest name without a full reload.
    const cached = this.peopleCache?.find((p) => p.id === personId);
    if (cached !== undefined) {
      cached.name = name;
    }
  }

  /**
   * Adds the files that still need (re)detection to the queue and makes sure the drain loop is
   * running. Safe to call with the whole library: files already detected (status record newer than
   * their `dateLastIndexed`), already queued, or currently being processed are skipped.
   * Resolves when the queue has been fully drained (including files enqueued by other callers).
   */
  async enqueueFiles(files: FileForDetection[]): Promise<void> {
    if (this.modelLoadFailed) {
      return; // don't keep retrying once the model is known to be unloadable
    }
    const candidates = files.filter((f) => !this.inFlight.has(f.id));
    if (candidates.length > 0) {
      const statuses = await this.dataStorage.fetchFaceDetectionStatuses(
        candidates.map((f) => f.id),
      );
      const statusById = new Map(statuses.map((s) => [s.fileId, s]));

      let added = 0;
      for (const file of candidates) {
        // Re-check after the await: another enqueue/drain may have picked this file up meanwhile
        if (this.inFlight.has(file.id) || !needsDetection(file, statusById.get(file.id))) {
          continue;
        }
        if (!this.queue.has(file.id)) {
          added += 1;
        }
        this.queue.set(file.id, file); // latest info wins if it was already queued
      }
      if (added > 0) {
        runInAction(() => {
          if (!this.isRunning) {
            // A fresh run: progress restarts from 0 / N
            this.processedCount = 0;
            this.totalCount = 0;
            this.isRunning = true;
          }
          this.totalCount += added;
        });
      }
    }
    if (this.queue.size > 0 && !this.drainPromise && !this.modelLoadFailed) {
      this.drainPromise = this.drain();
    }
    return this.drainPromise;
  }

  /** Loads the cache once; safe to call every drain start, cheap after the first call within a
   * session since it's just a field check. Memoizes the in-flight PROMISE (not just the resolved
   * value): if this were `if (this.peopleCache === undefined) { this.peopleCache = await ... }`,
   * two concurrent runners could both pass the `undefined` check before either's fetch resolves,
   * each kick off their own `fetchAllPeople()`, and whichever resolves last would unconditionally
   * overwrite `this.peopleCache`, discarding any Person(s) the other runner's `assignPerson` call
   * pushed into it in the meantime — the same race `assignPerson` guards against, one level up.
   * Assigning `this.peopleCachePromise` happens synchronously (no `await` before it), so all
   * concurrent callers end up awaiting the identical promise instead of racing independent fetches.
   * On rejection (e.g. a transient DB error), the promise is reset back to `undefined` so a future
   * call retries instead of every subsequent call for the rest of this instance's lifetime
   * `await`-ing the same already-rejected promise and throwing immediately with no way to recover. */
  private async ensurePeopleCacheLoaded(): Promise<void> {
    if (this.peopleCachePromise === undefined) {
      this.peopleCachePromise = this.dataStorage.fetchAllPeople();
    }
    try {
      this.peopleCache = await this.peopleCachePromise;
    } catch (err) {
      this.peopleCachePromise = undefined; // allow a future call to retry
      throw err;
    }
  }

  /**
   * Synchronous and `await`-free by design: this is the ONLY place a new Person can be created,
   * and it must run to completion without yielding to another concurrent runner's call, or two
   * files processed in the same batch could both decide "no match" for the same new person and
   * each create their own — this function's synchronous push onto `this.peopleCache` closes that
   * window, since JS never interleaves between two synchronous statements.
   *
   * This alone is NOT sufficient for end-to-end race safety: it assumes `this.peopleCache` is
   * already a single shared array that every concurrent caller reads and pushes into. That
   * invariant depends on `ensurePeopleCacheLoaded` memoizing the in-flight fetch promise (not just
   * the resolved value) so concurrent runners don't each populate their own independent cache
   * snapshot — see its doc comment for that half of the fix.
   */
  private assignPerson(descriptor: number[]): PersonDTO {
    const cache = this.peopleCache;
    if (cache === undefined) {
      throw new Error('assignPerson called before ensurePeopleCacheLoaded');
    }
    let best: { person: PersonDTO; distance: number } | undefined;
    for (const person of cache) {
      const distance = euclideanDistance(descriptor, person.representativeDescriptor);
      if (best === undefined || distance < best.distance) {
        best = { person, distance };
      }
    }
    if (best !== undefined && best.distance < PERSON_MATCH_THRESHOLD) {
      return best.person;
    }
    const newPerson: PersonDTO = {
      id: generateId(),
      name: '',
      representativeDescriptor: descriptor,
      dateCreated: new Date(),
    };
    cache.push(newPerson); // synchronous — visible to the next assignPerson call immediately
    return newPerson;
  }

  private takeNext(): FileForDetection | undefined {
    const next = this.queue.values().next();
    if (next.done) {
      return undefined;
    }
    this.queue.delete(next.value.id);
    this.inFlight.add(next.value.id);
    return next.value;
  }

  private async drain(): Promise<void> {
    const runner = async () => {
      for (let file = this.takeNext(); file !== undefined; file = this.takeNext()) {
        try {
          await this.processFile(file);
        } finally {
          this.inFlight.delete(file.id);
        }
      }
    };
    // Keep going until the queue is empty. Files enqueued while runners are active are picked up
    // by them; the loop condition covers files enqueued in between the last runner finishing and
    // this check (both run synchronously relative to enqueueFiles' post-await section).
    do {
      await Promise.all(Array.from({ length: CONCURRENCY }, runner));
    } while (this.queue.size > 0 && !this.modelLoadFailed);

    this.drainPromise = undefined;
    runInAction(() => {
      this.isRunning = false;
    });
  }

  private async processFile(file: FileForDetection): Promise<void> {
    // Recorded as the detection time, taken BEFORE reading the file: if it's re-indexed while
    // we're detecting, its new dateLastIndexed will be newer and it gets redone next time.
    const startedAt = new Date();
    let faces: DetectedFace[] = [];
    let status: FaceDetectionStatusDTO['status'] = 'done';

    for (let attempt = 0; ; attempt++) {
      try {
        faces = await this.detectForFile(file.absolutePath);
        break;
      } catch (err) {
        if (err instanceof ModelLoadError) {
          console.error('Face detection model failed to load', err);
          runInAction(() => {
            this.modelLoadFailed = true;
          });
          this.queue.clear();
          // No status is written: the file wasn't really attempted, so it's picked up again in a
          // later session once the model loads.
          return;
        }
        if (err instanceof TransientDetectionError && attempt < MAX_RETRIES_PER_FILE) {
          continue; // e.g. a worker crash/timeout: worth one more try
        }
        console.error(`Face detection failed for ${file.absolutePath}`, err);
        faces = [];
        status = 'failed';
        break;
      }
    }

    try {
      await this.ensurePeopleCacheLoaded();
      // EVERY person the faces reference, not just the ones created just now: the backend
      // inserts whichever of them it no longer has (and leaves existing rows untouched). The cache
      // is never refreshed mid-session, so it can hold people the backend has since pruned
      // (their last photo removed/re-detected elsewhere), or a person created for an earlier file
      // whose save then failed. Re-sending them makes each save self-healing — the person row is
      // recreated alongside the face that references it — instead of the face silently pointing
      // at a person that doesn't exist (invisible in the People view, never re-clustered).
      const referencedPeople = new Map<ID, PersonDTO>();
      const faceDTOs: FaceDTO[] = faces.map((f) => {
        const person = this.assignPerson(f.descriptor);
        referencedPeople.set(person.id, person);
        return {
          id: generateId(),
          fileId: file.id,
          boundingBox: f.boundingBox,
          descriptor: f.descriptor,
          personId: person.id,
          dateDetected: startedAt,
        };
      });
      await this.dataStorage.saveFaceDetectionResult(
        { fileId: file.id, status, dateDetected: startedAt },
        faceDTOs,
        Array.from(referencedPeople.values()),
      );
    } catch (err) {
      // e.g. the file was removed from the DB meanwhile; don't let it stall the queue
      console.error(`Could not save face detection result for ${file.absolutePath}`, err);
    }
    runInAction(() => {
      this.processedCount += 1;
    });
  }
}
