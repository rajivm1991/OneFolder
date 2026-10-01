import { ID } from './id';

/**
 * One row per distinct person, created the first time a face doesn't match any existing
 * person closely enough. `representativeDescriptor` is fixed at creation (the first face ever
 * assigned to this person) — not a running average — so it never silently drifts as more faces
 * join, and stays cheap to compare against for every subsequent face.
 */
export interface PersonDTO {
  id: ID;
  /** '' = unnamed, displayed as "Unnamed" in the UI. */
  name: string;
  representativeDescriptor: number[];
  dateCreated: Date;
}
