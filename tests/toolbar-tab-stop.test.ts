import { ensureToolbarTabStop } from '../widgets/toolbar-tab-stop';

/** A toolbar stub that answers only the selectors the helper uses */
const fakeToolbar = (items: Record<string, { tabIndex: number } | null>) => ({
  querySelector: (selector: string) => items[selector] ?? null,
});

const TAB_STOP = '[tabindex="0"]';
const BUTTON = 'button.toolbar-button[tabindex="-1"]';

describe('ensureToolbarTabStop', () => {
  it('leaves the toolbar alone when an item is already in the tab order', () => {
    const button = { tabIndex: -1 };
    ensureToolbarTabStop(fakeToolbar({ [TAB_STOP]: { tabIndex: 0 }, [BUTTON]: button }));
    expect(button.tabIndex).toBe(-1);
  });

  it('promotes the first toolbar button when no item is in the tab order', () => {
    const button = { tabIndex: -1 };
    ensureToolbarTabStop(fakeToolbar({ [BUTTON]: button }));
    expect(button.tabIndex).toBe(0);
  });

  it('does not promote other tabindex -1 elements, such as the date filter wrapper', () => {
    const wrapper = { tabIndex: -1 };
    // Any selector other than the toolbar button one would also match the wrapper
    const toolbar = {
      querySelector: (selector: string) => (selector === BUTTON || selector === TAB_STOP ? null : wrapper),
    };
    ensureToolbarTabStop(toolbar);
    expect(wrapper.tabIndex).toBe(-1);
  });

  it('does nothing for a toolbar without candidates', () => {
    expect(() => ensureToolbarTabStop(fakeToolbar({}))).not.toThrow();
  });
});
