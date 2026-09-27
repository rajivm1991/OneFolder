import {
  faceBoxStyle,
  filterFilesForPerson,
  groupFacesByFile,
  groupFacesByPerson,
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
