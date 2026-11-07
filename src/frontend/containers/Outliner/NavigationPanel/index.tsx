import { observer } from 'mobx-react-lite';
import React from 'react';
import { IconSet } from 'widgets';

import { useStore } from '../../../contexts/StoreContext';

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
        icon={IconSet.VIEW_GRID}
        text="Grid"
        selected={uiStore.isMasonry}
        onClick={uiStore.setMethodMasonry}
      />
      <SidebarRow
        icon={IconSet.VIEW_LIST}
        text="List"
        selected={uiStore.isList}
        onClick={uiStore.setMethodList}
      />
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
    </SidebarGroup>
  );
});

/**
 * The Views group, and the heading of the Filters section below it. The Locations and Tags panels that follow
 * in the sidebar are the filters: choosing rows there narrows whichever view is open.
 */
const NavigationPanel = observer(() => {
  const { uiStore } = useStore();

  if (uiStore.isSlideMode) {
    return null;
  }

  return (
    <>
      <ViewsGroup />
      <div className="section sidebar-group" id="sidebar-filters">
        <header>
          <h2>Filters</h2>
        </header>
      </div>
    </>
  );
});

export default NavigationPanel;
