import { observer } from 'mobx-react-lite';
import React from 'react';

import { IconSet } from 'widgets';
import { ToolbarButton } from 'widgets/toolbar';
import FileTagEditor from '../../containers/AppToolbar/FileTagEditor';
import { useStore } from '../../contexts/StoreContext';
import OutlinerToggle from '../Outliner/OutlinerToggle';
import DateFilter from './DateFilter';
import { SortCommand } from './Menus';
import { ViewCommand } from './Menus';
import Searchbar from './Searchbar';
import { itemCountLabel, summarizeFilters, ToolbarView, toolbarTitle } from './toolbar-title';

/** What is shown, and how many items there are */
const ToolbarTitle = observer(() => {
  const { uiStore, fileStore, tagStore } = useStore();

  let view: ToolbarView = 'files';
  if (uiStore.isMap) {
    view = 'map';
  } else if (uiStore.isFaces) {
    view = 'people';
  } else if (uiStore.isDuplicates) {
    view = 'duplicates';
  }
  const summary = summarizeFilters(uiStore.searchCriteriaList, (id) => tagStore.get(id)?.name);
  const title = toolbarTitle(view, fileStore.showsMissingContent, summary);

  return (
    <div className="toolbar-title" role="status">
      <span className="toolbar-title__name" title={title}>
        {title}
      </span>
      {/* fileList counts files: it is not the number of persons, duplicate groups or located files */}
      {view === 'files' && <span>{itemCountLabel(fileStore.fileList.length)}</span>}
    </div>
  );
});

const InspectorToggle = observer(() => {
  const { uiStore } = useStore();

  return (
    <ToolbarButton
      id="inspector-toggle"
      text="Toggle Inspector"
      tooltip="Show or hide the inspector"
      icon={
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
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M15 4v16" />
        </svg>
      }
      pressed={uiStore.isInspectorOpen}
      onClick={uiStore.toggleInspector}
    />
  );
});

const PrimaryCommands = observer(() => {
  const { uiStore } = useStore();

  return (
    <>
      <div className="toolbar-side toolbar-side--start">
        {/* While the sidebar is open its toggle is in the sidebar header */}
        {!uiStore.isOutlinerOpen && <OutlinerToggle />}

        <ToolbarTitle />
      </div>

      {/* Tag, Delete and the selection count are in the selection bar of the content view */}
      <Searchbar />

      <div className="toolbar-side toolbar-side--end">
        <DateFilter />

        {uiStore.isMasonry && <ViewCommand />}

        <SortCommand />

        <InspectorToggle />
      </div>
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
