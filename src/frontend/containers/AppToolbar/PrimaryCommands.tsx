import { observer } from 'mobx-react-lite';
import React from 'react';

import { IconSet } from 'widgets';
import { ToolbarButton } from 'widgets/toolbar';
import FileTagEditor from '../../containers/AppToolbar/FileTagEditor';
import { useStore } from '../../contexts/StoreContext';
import DateFilter from './DateFilter';
import { SortCommand } from './Menus';
import { ViewCommand } from './Menus';
import Searchbar from './Searchbar';

const OutlinerToggle = observer(() => {
  const { uiStore } = useStore();

  return (
    <ToolbarButton
      id="outliner-toggle"
      text="Toggle Outliner"
      icon={uiStore.isOutlinerOpen ? IconSet.DOUBLE_CARET : IconSet.MENU_HAMBURGER}
      controls="outliner"
      pressed={uiStore.isOutlinerOpen}
      onClick={uiStore.toggleOutliner}
      tabIndex={0}
    />
  );
});

const PrimaryCommands = observer(() => {
  const { uiStore } = useStore();

  return (
    <>
      <OutlinerToggle />

      {/* Tag, Delete and the selection count are in the selection bar of the content view */}
      <Searchbar />

      <DateFilter />

      {/* <ViewCommand /> */}
      {(uiStore.isMasonry || uiStore.isCalendar) && <ViewCommand />}

      <SortCommand />
    </>
  );
});

export default PrimaryCommands;

export const SlideModeCommand = observer(() => {
  const { uiStore } = useStore();
  return (
    <>
      <ToolbarButton
        isCollapsible={false}
        icon={IconSet.ARROW_LEFT}
        onClick={uiStore.disableSlideMode}
        text="Back"
        tooltip="Back to content panel"
      />

      <div className="spacer" />

      <FileTagEditor />

      <ToolbarButton
        icon={IconSet.INFO}
        onClick={uiStore.toggleInspector}
        checked={uiStore.isInspectorOpen}
        text="Toggle the inspector panel"
        tooltip="Toggle the inspector panel"
      />
    </>
  );
});
