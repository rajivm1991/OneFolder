import UiStore from '../src/frontend/stores/UiStore';

// Location.ts uses import.meta, which the jest TypeScript setup cannot compile, and is not needed here
jest.mock('../src/frontend/entities/Location', () => ({}));

// Only the view method is exercised, so the root store is not needed
const createStore = () => new UiStore({} as any);

describe('UiStore.showGallery', () => {
  it.each([
    ['Map', (ui: UiStore) => ui.setMethodMap()],
    ['People', (ui: UiStore) => ui.setMethodFaces()],
    ['Duplicates', (ui: UiStore) => ui.setMethodDuplicates()],
  ])('leaves %s for the last used layout', (_name, open) => {
    const ui = createStore();
    ui.setMethodList();
    open(ui);
    expect(ui.isGalleryLayout).toBe(false);

    ui.showGallery();

    expect(ui.isList).toBe(true);
  });

  it('returns to the grid after the grid was last used', () => {
    const ui = createStore();
    ui.setMethodGrid();
    ui.setMethodMap();

    ui.showGallery();

    expect(ui.isGrid).toBe(true);
  });

  it('does not change a layout that is already open', () => {
    const ui = createStore();
    ui.setMethodGrid();
    ui.setMethodList();

    ui.showGallery();

    expect(ui.isList).toBe(true);
  });
});
