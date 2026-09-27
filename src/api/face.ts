import { ID } from './id';

/**
 * DTO for a single detected face (bounding box + descriptor), one row per face per file.
 * personId is unused in v1 (always null) — reserved for future clustering/naming.
 */
export interface FaceDTO {
  id: ID;
  fileId: ID;
  boundingBox: { x: number; y: number; width: number; height: number };
  descriptor: number[];
  personId: string | null;
  dateDetected: Date;
}
