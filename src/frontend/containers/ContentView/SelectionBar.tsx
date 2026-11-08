import { observer } from 'mobx-react-lite';
import React from 'react';

import { FileRemoval } from '../../components/RemovalAlert';
import { useStore } from '../../contexts/StoreContext';
import FocusManager from '../../FocusManager';
import { TagEditorPopover } from '../AppToolbar/FileTagEditor';

/**
 * A bar floating at the bottom of the content area while files are selected: the actions that need a selection.
 * Slide mode has its own tag button in the toolbar, so the bar is not shown there.
 */
const SelectionBar = observer(() => {
  const { uiStore, fileStore } = useStore();
  const count = uiStore.fileSelection.size;
  const showsMissing = fileStore.showsMissingContent;

  // Stays while the tag editor is open, even if the selection was emptied meanwhile, so the editor does not vanish.
  // Missing files cannot be tagged and have no editor, so the bar must not wait for one there
  const keepForTagEditor = uiStore.isToolbarTagPopoverOpen && !showsMissing;
  if (uiStore.isSlideMode || (count === 0 && !keepForTagEditor)) {
    return null;
  }

  // Missing files cannot be tagged, they can only be removed from the library
  const handleDelete = showsMissing ? uiStore.openToolbarFileRemover : uiStore.openMoveFilesToTrash;

  // The bar disappears with the selection, taking focus with it: hand focus back to the gallery
  const handleClear = () => {
    uiStore.clearFileSelection();
    FocusManager.focusGallery();
  };

  return (
    <>
      <div className="selection-bar" role="group" aria-label="Selection actions">
        <span className="selection-bar__count">{count.toLocaleString()} selected</span>

        {!showsMissing && (
          <>
            <button
              type="button"
              className="selection-bar__tag"
              aria-haspopup="dialog"
              aria-expanded={uiStore.isToolbarTagPopoverOpen}
              title="Add or remove tags from selected images (T)"
              disabled={count === 0 && !uiStore.isToolbarTagPopoverOpen}
              onClick={uiStore.toggleToolbarTagPopover}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9z" />
                <circle cx="8" cy="8" r="1.4" />
              </svg>
              Tag
            </button>
            <TagEditorPopover />
          </>
        )}

        <button
          type="button"
          className="selection-bar__icon"
          aria-label="Delete selected"
          title={
            showsMissing ? 'Remove selected missing files from the library' : 'Delete selected'
          }
          disabled={count === 0}
          onClick={handleDelete}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
          </svg>
        </button>
        <button
          type="button"
          className="selection-bar__icon"
          aria-label="Clear selection"
          title="Clear selection"
          onClick={handleClear}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <FileRemoval />
    </>
  );
});

export default SelectionBar;
