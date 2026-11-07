import { observer } from 'mobx-react-lite';
import React, { useCallback } from 'react';
import { IconSet } from 'widgets';

import { useStore } from '../../../contexts/StoreContext';
import { ClientTagSearchCriteria } from '../../../entities/SearchCriteria';

type SidebarRowProps = {
  icon: JSX.Element;
  text: string;
  /** Muted number on the right, e.g. the number of files */
  count?: number;
  selected: boolean;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  tooltip?: string;
};

/** One labelled, clickable entry in a sidebar group */
const SidebarRow = ({ icon, text, count, selected, onClick, tooltip }: SidebarRowProps) => (
  <button
    className="sidebar-row"
    title={tooltip}
    aria-current={selected ? 'true' : undefined}
    onClick={onClick}
  >
    <span className="sidebar-row__icon" aria-hidden>
      {icon}
    </span>
    <span className="sidebar-row__label">{text}</span>
    {count !== undefined && <span className="sidebar-row__count">{count.toLocaleString()}</span>}
  </button>
);

/** A titled group of sidebar rows. Not collapsible, unlike the Locations and Tags panels. */
const SidebarGroup = ({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="section sidebar-group" id={id}>
    <header>
      <h2>{title}</h2>
    </header>
    <div role="group" aria-label={title} className="sidebar-rows">
      {children}
    </div>
  </div>
);

const ViewsGroup = observer(() => {
  const { uiStore } = useStore();

  return (
    <SidebarGroup id="sidebar-views" title="Views">
      <SidebarRow
        icon={IconSet.WORLD}
        text="Map"
        selected={uiStore.isMap}
        onClick={uiStore.setMethodMap}
      />
      <SidebarRow
        icon={IconSet.FACE_SMILING}
        text="People"
        selected={uiStore.isFaces}
        onClick={uiStore.setMethodFaces}
      />
      <SidebarRow
        icon={IconSet.DUPLICATE}
        text="Duplicates"
        selected={uiStore.isDuplicates}
        onClick={uiStore.setMethodDuplicates}
      />
      {/* TODO: temporary. Remove together with the Calendar view; a year/month date filter replaces it. */}
      <SidebarRow
        icon={IconSet.FILTER_DATE}
        text="Calendar"
        selected={uiStore.isCalendar}
        onClick={uiStore.setMethodCalendar}
      />
    </SidebarGroup>
  );
});

const LibraryGroup = observer(() => {
  const { uiStore, fileStore, tagStore } = useStore();

  // These rows only change which files are loaded, so also leave Map, People, Duplicates or Calendar
  const handleAllClick = useCallback(() => {
    uiStore.showGallery();
    fileStore.fetchAllFiles();
  }, [uiStore, fileStore]);

  const handleMissingClick = useCallback(() => {
    uiStore.showGallery();
    fileStore.fetchMissingFiles();
  }, [uiStore, fileStore]);

  const handleUntaggedClick = useCallback(
    (e: React.MouseEvent) => {
      uiStore.showGallery();
      if (!e.ctrlKey) {
        fileStore.fetchUntaggedFiles();
        return;
      }
      // With ctrl key pressed, either add/remove a Untagged criteria based on whether it's already there
      const maybeUntaggedCrit = uiStore.searchCriteriaList.find(
        (crit) => crit instanceof ClientTagSearchCriteria && !crit.value,
      );

      if (maybeUntaggedCrit) {
        uiStore.removeSearchCriteria(maybeUntaggedCrit);
      } else {
        uiStore.addSearchCriteria(new ClientTagSearchCriteria('tags'));
      }
    },
    [fileStore, uiStore],
  );

  return (
    <SidebarGroup id="sidebar-library" title="Library">
      <SidebarRow
        icon={IconSet.MEDIA}
        text="All images"
        count={fileStore.numTotalFiles}
        selected={fileStore.showsAllContent}
        onClick={handleAllClick}
        tooltip="View all images in library"
      />
      {/* Not shown when there are no tags at all: everything would be untagged, same as "All images" */}
      {tagStore.root.subTags.length > 0 && (
        <SidebarRow
          icon={IconSet.TAG_BLANCO}
          text="Untagged"
          count={fileStore.numUntaggedFiles}
          selected={fileStore.showsUntaggedContent}
          onClick={handleUntaggedClick}
          tooltip="View all untagged images"
        />
      )}
      {fileStore.numMissingFiles > 0 && (
        <SidebarRow
          icon={IconSet.WARNING_FILL}
          text="Missing"
          count={fileStore.numMissingFiles}
          selected={fileStore.showsMissingContent}
          onClick={handleMissingClick}
          tooltip="View missing images on your system"
        />
      )}
    </SidebarGroup>
  );
});

/** The labelled Views and Library groups at the top of the sidebar */
const NavigationPanel = observer(() => {
  const { uiStore } = useStore();

  if (uiStore.isSlideMode) {
    return null;
  }

  return (
    <>
      <ViewsGroup />
      <LibraryGroup />
    </>
  );
});

export default NavigationPanel;
