import { visibleFaceBoxes } from '../src/frontend/containers/ContentView/FaceGallery';

describe('visibleFaceBoxes', () => {
  const faces = [{ boundingBox: { x: 5, y: 5, width: 20, height: 20 } }];

  it('returns the faces list when showBoxes is true', () => {
    expect(visibleFaceBoxes(faces, true)).toEqual(faces);
  });

  it('returns an empty array when showBoxes is false', () => {
    expect(visibleFaceBoxes(faces, false)).toEqual([]);
  });
});
