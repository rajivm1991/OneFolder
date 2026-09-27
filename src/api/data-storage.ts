import { IndexableType } from 'dexie';
import { ConditionDTO, OrderBy, OrderDirection } from './data-storage-search';
import { DismissedDuplicateGroupDTO } from './dismissed-duplicate-group';
import { FaceDetectionStatusDTO, FaceDTO } from './face';
import { FileDTO } from './file';
import { FileSearchDTO } from './file-search';
import { ID } from './id';
import { LocationDTO } from './location';
import { TagDTO } from './tag';
import { VisualHashDTO } from './visual-hash';

/**
 * The user generated persisted data edited or viewed by one or multiple actors (users, multiple devices etc.).
 *
 * The document contains data about
 * * files (index map),
 * * tags (tree),
 * * locations (list) and
 * * searches (list).
 */
export interface DataStorage {
  fetchTags(): Promise<TagDTO[]>;
  fetchFiles(order: OrderBy<FileDTO>, fileOrder: OrderDirection): Promise<FileDTO[]>;
  fetchFilesByID(ids: ID[]): Promise<FileDTO[]>;
  fetchFilesByKey(key: keyof FileDTO, value: IndexableType): Promise<FileDTO[]>;
  fetchLocations(): Promise<LocationDTO[]>;
  fetchSearches(): Promise<FileSearchDTO[]>;
  searchFiles(
    criteria: ConditionDTO<FileDTO> | [ConditionDTO<FileDTO>, ...ConditionDTO<FileDTO>[]],
    order: OrderBy<FileDTO>,
    fileOrder: OrderDirection,
    matchAny?: boolean,
  ): Promise<FileDTO[]>;
  createTag(tag: TagDTO): Promise<void>;
  createFilesFromPath(path: string, files: FileDTO[]): Promise<void>;
  createLocation(location: LocationDTO): Promise<void>;
  createSearch(search: FileSearchDTO): Promise<void>;
  saveTag(tag: TagDTO): Promise<void>;
  saveFiles(files: FileDTO[]): Promise<void>;
  saveLocation(location: LocationDTO): Promise<void>;
  saveSearch(search: FileSearchDTO): Promise<void>;
  removeTags(tags: ID[]): Promise<void>;
  mergeTags(tagToBeRemoved: ID, tagToMergeWith: ID): Promise<void>;
  removeFiles(files: ID[]): Promise<void>;
  removeLocation(location: ID): Promise<void>;
  removeSearch(search: ID): Promise<void>;
  countFiles(): Promise<[fileCount: number, untaggedFileCount: number]>;
  clear(): Promise<void>;
  clearFilesOnly(): Promise<void>;

  // Dismissed Duplicate Groups
  fetchDismissedDuplicateGroups(): Promise<DismissedDuplicateGroupDTO[]>;
  createDismissedDuplicateGroup(dismissedGroup: DismissedDuplicateGroupDTO): Promise<void>;
  removeDismissedDuplicateGroup(groupHash: string): Promise<void>;

  // Visual Hash Cache
  fetchVisualHashes(absolutePaths: string[]): Promise<VisualHashDTO[]>;
  saveVisualHashes(hashes: VisualHashDTO[]): Promise<void>;
  removeVisualHashes(absolutePaths: string[]): Promise<void>;
  clearVisualHashCache(): Promise<void>;

  // Face Detection
  fetchFacesForFile(fileId: ID): Promise<FaceDTO[]>;
  /** Batched variant of fetchFacesForFile: all faces belonging to any of the given files */
  fetchFacesForFiles(fileIds: ID[]): Promise<FaceDTO[]>;
  /** Detection status records for the given files; files never attempted have no record */
  fetchFaceDetectionStatuses(fileIds: ID[]): Promise<FaceDetectionStatusDTO[]>;
  /**
   * Atomically records the outcome of one detection attempt for `status.fileId`: removes that
   * file's previous (possibly stale) faces, stores `faces` (may be empty), and upserts `status`.
   */
  saveFaceDetectionResult(status: FaceDetectionStatusDTO, faces: FaceDTO[]): Promise<void>;
  // Note: faces + detection statuses of removed files are cleaned up by removeFiles/removeLocation.
}
