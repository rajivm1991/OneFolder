import { observer } from 'mobx-react-lite';
import React from 'react';

import { IconSet } from 'widgets';
import { ToolbarButton } from 'widgets/toolbar';
import { useStore } from '../../contexts/StoreContext';

/** Shows or hides the sidebar. Lives in the sidebar header; the toolbar shows it only while the sidebar is collapsed. */
const OutlinerToggle = observer(() => {
  const { uiStore } = useStore();

  // This button is replaced by the other toggle when the sidebar shows or hides, which drops focus to the body.
  // Only done for clicks: hotkeys should not move focus.
  const handleClick = () => {
    uiStore.toggleOutliner();
    requestAnimationFrame(() => document.getElementById('outliner-toggle')?.focus());
  };

  return (
    <ToolbarButton
      id="outliner-toggle"
      text="Toggle Outliner"
      icon={uiStore.isOutlinerOpen ? IconSet.DOUBLE_CARET : IconSet.MENU_HAMBURGER}
      controls="outliner"
      pressed={uiStore.isOutlinerOpen}
      onClick={handleClick}
      tabIndex={0}
    />
  );
});

export default OutlinerToggle;
