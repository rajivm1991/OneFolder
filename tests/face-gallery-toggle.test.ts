import {
  faceBoxStyle,
  groupFacesByFile,
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
