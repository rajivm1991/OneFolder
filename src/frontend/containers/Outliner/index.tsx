import { observer } from 'mobx-react-lite';
import React from 'react';
import useLocalStorage from 'src/frontend/hooks/useLocalStorage';
import MultiSplit from 'widgets/MultiSplit';
import { Toolbar } from 'widgets/toolbar';
import OutlinerToggle from './OutlinerToggle';
import { useStore } from '../../contexts/StoreContext';
import LocationsPanel from './LocationsPanel';
import SavedSearchesPanel from './SavedSearchesPanel';
import TagsPanel, { OutlinerActionBar } from './TagsPanel';
import NavigationPanel from './NavigationPanel';
import GenericButtonNavigation from './GenericButtonNavigation';
import { shell } from 'electron';

const Outliner = () => {
  const { uiStore } = useStore();

  // Would be more consistent to store these in the UIStore,
  // but that would only be needed when the values need to be changed from other places
  const [expansion, setExpansion] = useLocalStorage('outliner-expansion', [true, true, true]);
  const [heights, setHeights] = useLocalStorage('outliner-heights', [0, 0, 0]);

  return (
    <nav id="outliner" aria-expanded={uiStore.isOutlinerOpen}>
      {/* Same height as the toolbar; on macOS the traffic lights sit at its left */}
      {uiStore.isOutlinerOpen && (
        <Toolbar id="outliner-header" label="Sidebar header" controls="content-view" isCompact>
          <OutlinerToggle />
        </Toolbar>
      )}
      <div id="outliner-content">
        <MultiSplit
          onUpdateExpansion={setExpansion}
          expansion={expansion}
          heights={heights}
          setHeights={setHeights}
        >
          <NavigationPanel />
          <LocationsPanel />
          <TagsPanel />
          {/* Hidden on purpose since 2023 (commit f681c26c). Re-enable here as the last group if wanted. */}
          {/* <SavedSearchesPanel /> */}
          {/* <GenericButtonNavigation
            text="Give Feedback!"
            onClick={() => {
              shell.openExternal('https://forms.gle/UjkHgSa8a7335icQ7');
            }}
          /> */}
        </MultiSplit>
      </div>
      <OutlinerActionBar />
    </nav>
  );
};

export default observer(Outliner);
