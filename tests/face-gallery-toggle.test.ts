import {
  faceBoxStyle,
  faceCropStyle,
  filterFilesForPerson,
  groupFacesByFile,
  groupFacesByPerson,
  pickRepresentativeFace,
  shouldSyncNameDraft,
  visibleFaceBoxes,
} from '../src/frontend/containers/ContentView/FaceGallery';

describe('visibleFaceBoxes', () => {
  const faces = [{ boundingBox: { x: 0.05, y: 0.05, width: 0.2, height: 0.2 } }];

  it('returns the faces list when showBoxes is true', () => {
    expect(visibleFaceBoxes(faces, true)).toEqual(faces);
  });

  it('returns an empty array when showBoxes is false', () => {
    expect(visibleFaceBoxes(faces, false)).toEqual([]);
  });
});

describe('faceBoxStyle', () => {
  it('positions a normalized box as percentages of the rendered image', () => {
    expect(faceBoxStyle({ x: 0.25, y: 0.5, width: 0.125, height: 0.2 })).toEqual({
      left: '25%',
      top: '50%',
      width: '12.5%',
      height: '20%',
    });
  });
});

describe('groupFacesByFile', () => {
  it('groups face rows by fileId', () => {
    const grouped = groupFacesByFile([
      { fileId: 'a', id: '1' },
      { fileId: 'b', id: '2' },
      { fileId: 'a', id: '3' },
    ]);
    expect(grouped.get('a')!.map((f) => f.id)).toEqual(['1', '3']);
    expect(grouped.get('b')!.map((f) => f.id)).toEqual(['2']);
  });
});

describe('groupFacesByPerson', () => {
  it('groups face rows by personId, ignoring faces with personId null', () => {
    const faces = [
      { personId: 'p1', fileId: 'f1' },
      { personId: 'p1', fileId: 'f2' },
      { personId: 'p2', fileId: 'f3' },
      { personId: null, fileId: 'f4' },
    ];
    const grouped = groupFacesByPerson(faces);
    expect(grouped.get('p1')).toHaveLength(2);
    expect(grouped.get('p2')).toHaveLength(1);
    expect(grouped.has('null' as any)).toBe(false);
  });

  it("keeps two different people who appear in the SAME group photo as separate entries, so only the right person is boxed in each person's gallery", () => {
    // A group photo (fileId 'group.jpg') containing both p1 and p2.
    const faces = [
      { personId: 'p1', fileId: 'group.jpg' },
      { personId: 'p2', fileId: 'group.jpg' },
    ];
    const grouped = groupFacesByPerson(faces);
    // p1's gallery for this file must contain ONLY p1's face row, not p2's
    expect(grouped.get('p1')).toEqual([{ personId: 'p1', fileId: 'group.jpg' }]);
    expect(grouped.get('p2')).toEqual([{ personId: 'p2', fileId: 'group.jpg' }]);
  });
});

describe('filterFilesForPerson', () => {
  it('returns only the files that have a face belonging to the given person', () => {
    const files = [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }] as any[];
    const facesForPerson = [
      { fileId: 'f1', personId: 'p1' },
      { fileId: 'f3', personId: 'p1' },
    ];
    const result = filterFilesForPerson(files, facesForPerson);
    expect(result.map((f) => f.id)).toEqual(['f1', 'f3']);
  });
});

describe('faceCropStyle', () => {
  it('scales and shifts the image so the frame shows exactly the face box', () => {
    // Box covering the middle quarter-width, 0.2..0.7 height of the image
    const style = faceCropStyle({ x: 0.25, y: 0.2, width: 0.25, height: 0.5 });
    expect(style).toMatchObject({
      position: 'absolute',
      left: '-100%', // box.x / box.width = 1 frame-width to the left
      top: '-40%', // box.y / box.height = 0.4 frame-heights up
      width: '400%', // 1 / 0.25
      height: '200%', // 1 / 0.5
    });
  });

  it('shows the whole image for a full-image box', () => {
    expect(faceCropStyle({ x: 0, y: 0, width: 1, height: 1 })).toMatchObject({
      left: '0%',
      top: '0%',
      width: '100%',
      height: '100%',
    });
  });

  it('never produces an infinite scale for a degenerate 0-size box', () => {
    const style = faceCropStyle({ x: 0.5, y: 0.5, width: 0, height: 0 });
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      expect(Number.isFinite(parseFloat(String(style[key])))).toBe(true);
    }
  });
});

describe('pickRepresentativeFace', () => {
  const rep = [0.1, 0.2, 0.3];
  it('picks the face whose descriptor is the person representative descriptor', () => {
    const faces = [
      { id: 'a', descriptor: [0.1, 0.2, 0.31] },
      { id: 'b', descriptor: [0.1, 0.2, 0.3] },
    ];
    expect(pickRepresentativeFace(faces, rep)?.id).toBe('b');
  });
  it('falls back to the first face if the representative one is gone', () => {
    const faces = [
      { id: 'a', descriptor: [0.9, 0.9, 0.9] },
      { id: 'b', descriptor: [0.8, 0.8, 0.8] },
    ];
    expect(pickRepresentativeFace(faces, rep)?.id).toBe('a');
  });
  it('returns undefined for no faces', () => {
    expect(pickRepresentativeFace([], rep)).toBeUndefined();
  });
});

describe('shouldSyncNameDraft', () => {
  const person = { id: 'p1', name: 'Mom', representativeDescriptor: [], dateCreated: new Date() };
  it('syncs the first time the person loads', () => {
    expect(shouldSyncNameDraft(null, 'p1', person)).toBe(true);
  });
  it('does not sync again on a refresh for the same person (would wipe what the user is typing)', () => {
    expect(shouldSyncNameDraft('p1', 'p1', person)).toBe(false);
  });
  it('syncs when switching to a different person', () => {
    expect(shouldSyncNameDraft('p0', 'p1', person)).toBe(true);
  });
  it('does not sync (or mark synced) when the person was not found', () => {
    expect(shouldSyncNameDraft(null, 'p1', undefined)).toBe(false);
  });
});
