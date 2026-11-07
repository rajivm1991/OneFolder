import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';

import { shell } from 'electron';
import { RendererMessenger } from 'src/ipc/renderer';
import { Checkbox } from 'widgets';
import { IconSet, KeyCombo } from 'widgets';
import { MenuButton, MenuItem } from 'widgets/menus';
import { MultiSplitPaneProps } from 'widgets/MultiSplit/MultiSplitPane';
import { Alert, DialogButton } from 'widgets/popovers';
import { Toolbar } from 'widgets/toolbar';
import { useStore } from '../../../contexts/StoreContext';
import { useAction } from '../../../hooks/mobx';
import { comboMatches, getKeyCombo, parseKeyCombo } from '../../../hotkeyParser';
import { clearTagFilters } from '../filter-utils';
import TagsTree from './TagsTree';

/**
 * The footer of the sidebar: one menu with settings, help, feedback, updates and re-indexing.
 * Also owns the re-index confirmation dialog and its keyboard shortcut.
 */
export const OutlinerActionBar = observer(() => {
  const rootStore = useStore();
  const { fileStore, uiStore } = rootStore;
  const [showReIndexModal, setShowReIndexModal] = useState(false);
  const [isReIndexing, setIsReIndexing] = useState(false);
  const [importMetadata, setImportMetadata] = useState(false);

  const handleReIndexClick = () => {
    if (isReIndexing) {
      return; // Prevent multiple simultaneous operations
    }
    // Initialize checkbox with user's saved preference for re-indexing
    setImportMetadata(rootStore.uiStore.importMetadataAtReIndexing);
    setShowReIndexModal(true);
  };

  // Keyboard shortcut for re-index (Ctrl+Shift+R)
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key === 'R') {
        event.preventDefault();
        if (!isReIndexing) {
          handleReIndexClick();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isReIndexing, handleReIndexClick]);

  const handleReIndexConfirm = async (button: DialogButton) => {
    setShowReIndexModal(false);
    if (button === DialogButton.PrimaryButton) {
      if (isReIndexing) {
        return; // Prevent multiple simultaneous operations
      }

      // Save the user's choice as their preference for future re-indexing operations
      rootStore.uiStore.setImportMetadataAtReIndexing(importMetadata);

      setIsReIndexing(true);
      try {
        // Clear files table while preserving locations and tags
        await rootStore.clearFilesOnly();

        // Re-index all existing locations with the chosen metadata import setting
        await fileStore.reIndexAllFiles(importMetadata);
      } catch (error) {
        console.error('Re-indexing failed:', error);
      } finally {
        setIsReIndexing(false);
      }
    } else if (button === DialogButton.SecondaryButton) {
      // Export tags to metadata first
      fileStore.writeTagsToFiles();
    }
  };

  return (
    <>
      <Toolbar id="actionbar" label="Sidebar actions" controls="content-view" isCompact>
        <MenuButton
          id="__sidebar-menu"
          icon={IconSet.SETTINGS}
          text="Settings and help"
          tooltip="Settings and help"
          menuID="__sidebar-menu-options"
        >
          <MenuItem
            icon={IconSet.SETTINGS}
            onClick={uiStore.toggleSettings}
            text="settings"
            accelerator={<KeyCombo combo={uiStore.hotkeyMap.toggleSettings} />}
          />
          <MenuItem
            icon={IconSet.RELOAD}
            onClick={handleReIndexClick}
            text={isReIndexing ? 're-indexing library…' : 're-index library…'}
            disabled={isReIndexing}
            accelerator={<KeyCombo combo="ctrl+shift+R" />}
          />
          <MenuItem
            icon={IconSet.DUPLICATE}
            onClick={uiStore.setMethodDuplicates}
            text="find duplicates"
          />
          {fileStore.numMissingFiles > 0 && (
            <MenuItem
              icon={IconSet.WARNING_FILL}
              onClick={fileStore.fetchMissingFiles}
              text={`missing files (${fileStore.numMissingFiles.toLocaleString()})`}
            />
          )}
          <MenuItem
            icon={IconSet.THUMB_BG}
            onClick={() => {
              shell.openExternal('https://onefolder.canny.io/feedback');
            }}
            text="💡ideas + 🐞bugs"
          />
          <MenuItem
            icon={IconSet.HELPCENTER}
            onClick={() => {
              shell.openExternal(
                'https://foul-channel-e2c.notion.site/Photo-Folder-71473f9595304d4fb7832237a787c56b?pvs=4',
              );
            }}
            text="help center"
          />
          <MenuItem
            icon={IconSet.RELOAD}
            onClick={RendererMessenger.checkForUpdates}
            text="check for updates"
          />
        </MenuButton>
      </Toolbar>

      <Alert
        open={showReIndexModal}
        title="Re-index Library"
        icon={IconSet.WARNING}
        type="warning"
        primaryButtonText="Re-index"
        secondaryButtonText="Export Tags First"
        defaultButton={DialogButton.SecondaryButton}
        onClick={handleReIndexConfirm}
        aria-describedby="reindex-description reindex-options"
      >
        <p id="reindex-description">
          Are you sure you want to re-index your entire library? This will refresh the database with
          current files and may take several minutes depending on your library size.
        </p>

        <div
          style={{
            fontSize: '13px',
            color: 'var(--text-secondary)',
            marginBottom: '12px',
            padding: '8px',
            backgroundColor: 'var(--bg-tertiary)',
            borderRadius: '3px',
          }}
        >
          <strong>Current library:</strong> {fileStore.numTotalFiles.toLocaleString()} files across{' '}
          {rootStore.locationStore.locationList.length} location
          {rootStore.locationStore.locationList.length !== 1 ? 's' : ''}
          {importMetadata ? (
            <div style={{ marginTop: '4px' }}>
              ⏱️{' '}
              <em>
                Estimated time: {Math.ceil(fileStore.numTotalFiles / 1000)} minute
                {Math.ceil(fileStore.numTotalFiles / 1000) !== 1 ? 's' : ''} (with metadata import)
              </em>
            </div>
          ) : (
            <div style={{ marginTop: '4px' }}>
              ⚡{' '}
              <em>
                Estimated time: {Math.ceil(fileStore.numTotalFiles / 2000)} minute
                {Math.ceil(fileStore.numTotalFiles / 2000) !== 1 ? 's' : ''} (files only)
              </em>
            </div>
          )}
        </div>
        <p>
          <strong>Important:</strong> Only tags that have been synced to image metadata will be
          preserved during re-indexing. Tags that exist only in the database may be lost.
        </p>
        <p>
          <strong>Recommendation:</strong> Export your tags first as a backup before proceeding with
          the re-index operation.
        </p>

        <div
          style={{
            marginTop: '16px',
            padding: '12px',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ marginRight: '8px', fontSize: '14px' }}>⚙️</span>
            <strong style={{ fontSize: '14px' }}>Import Options</strong>
          </div>
          <Checkbox
            checked={importMetadata}
            onChange={setImportMetadata}
            aria-label="Import metadata from files"
            aria-describedby="reindex-options"
          >
            Import metadata from files
          </Checkbox>
          <div
            id="reindex-options"
            style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              marginTop: '4px',
              marginLeft: '20px',
            }}
          >
            When enabled, existing tags in image metadata will be imported during re-indexing. This
            provides more complete tag recovery but takes longer to complete.
          </div>
        </div>
      </Alert>
    </>
  );
});

const TagsPanel = (props: Partial<MultiSplitPaneProps>) => {
  const { uiStore } = useStore();

  const handleShortcuts = useAction((e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).matches('input')) {
      return;
    }
    const combo = getKeyCombo(e.nativeEvent);
    const matches = (c: string): boolean => {
      return comboMatches(combo, parseKeyCombo(c));
    };
    const { hotkeyMap } = uiStore;
    // Selecting every tag at once would mean "has all of them", so only deselecting is offered
    if (matches(hotkeyMap.deselectAll)) {
      clearTagFilters(uiStore);
    }
  });

  return <TagsTree onKeyDown={handleShortcuts} {...props} />;
};

export default TagsPanel;
