/** The part of a DOM element that the toolbar needs, so that the logic can be tested without a DOM */
interface TabStopRoot {
  querySelector(selectors: string): { tabIndex: number } | null;
}

/**
 * Makes sure one toolbar button is part of the tab order: the last focused one (tabindex 0), or else the first
 * button that was left out of it (tabindex -1).
 * Only toolbar buttons are promoted. Other elements with tabindex -1, such as a wrapper that forwards focus to an inner
 * button, must stay out of the tab order.
 */
export function ensureToolbarTabStop(toolbar: TabStopRoot): void {
  if (toolbar.querySelector('[tabindex="0"]') !== null) {
    return;
  }
  const firstToolbarButton = toolbar.querySelector('button.toolbar-button[tabindex="-1"]');
  if (firstToolbarButton !== null) {
    firstToolbarButton.tabIndex = 0;
  }
}
