import { ID } from './id';

/**
 * A face bounding box in NORMALIZED image coordinates: every field is a fraction (0–1) of the
 * width/height of the image detection ran on. Normalized (rather than pixel) coordinates are
 * independent of the resolution the image was decoded/downscaled to for detection and of the
 * size the thumbnail is rendered at, so the UI can position the box as a CSS percentage.
 */
export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * DTO for a single detected face (bounding box + descriptor), one row per face per file.
 * personId is unused in v1 (always null) — reserved for future clustering/naming.
 */
export interface FaceDTO {
  id: ID;
  fileId: ID;
  boundingBox: NormalizedBox;
  descriptor: number[];
  personId: string | null;
  dateDetected: Date;
}

/**
 * One record per file that face detection has been ATTEMPTED on — whether it found 0, 1 or N
 * faces, or failed (e.g. undecodable image). This, not the presence of `faces` rows, is what
 * marks a file as processed: a 0-face photo writes no `faces` rows but still has a status.
 *
 * A file needs (re)detection iff it has no status record, or `dateDetected` is older than the
 * file's `dateLastIndexed` (bumped by LocationStore when the file's content changed on disk).
 */
export interface FaceDetectionStatusDTO {
  /** Primary key: one status per file */
  fileId: ID;
  status: 'done' | 'failed';
  /** When the detection attempt STARTED — so a file re-indexed mid-detection is redone later */
  dateDetected: Date;
}
