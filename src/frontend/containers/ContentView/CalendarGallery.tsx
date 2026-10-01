import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { createPortal } from 'react-dom';
import { GroupedVirtuoso, GroupedVirtuosoHandle } from 'react-virtuoso';
import { GalleryProps } from './utils';
import { getThumbnailSize } from './utils';
import { useStore } from '../../contexts/StoreContext';
import { ClientFile } from '../../entities/File';
import { Thumbnail, ThumbnailTags } from './GalleryItem';
import { CommandDispatcher } from './Commands';
import { IconButton, IconSet } from 'widgets';
import { OrderDirection } from 'src/api/data-storage-search';
import { comboMatches, getKeyCombo, parseKeyCombo } from '../../hotkeyParser';
import {
  calendarSortFixes,
  chunkIntoRows,
  computeColumns,
  getGridArrowTarget,
  groupIndexAt,
  rowStartIndex,
} from './calendar-utils';
// Using HTML select elements for better compatibility

// Helper function to create month/year key from date
const getMonthYearKey = (date: Date): string => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

// Helper function to format month/year for display
const formatMonthYear = (key: string): string => {
  const [year, month] = key.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
};

// Group files by creation date (month/year)
const groupFilesByMonth = (files: ClientFile[]) => {
  const groupMap = new Map<string, ClientFile[]>();

  for (const file of files) {
    const monthYearKey = getMonthYearKey(file.dateCreated);
    if (!groupMap.has(monthYearKey)) {
      groupMap.set(monthYearKey, []);
    }
    groupMap.get(monthYearKey)!.push(file);
  }

  // Sort groups by date (newest first)
  const sortedGroups = Array.from(groupMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));

  // Extract years and months for dropdowns
  const yearMap = new Map<number, Set<number>>();
  sortedGroups.forEach(([key]) => {
    const [year, month] = key.split('-').map(Number);
    if (!yearMap.has(year)) {
      yearMap.set(year, new Set());
    }
    yearMap.get(year)!.add(month);
  });

  const availableYears = Array.from(yearMap.keys()).sort((a, b) => b - a);
  const availableMonths = (year: number) =>
    Array.from(yearMap.get(year) || []).sort((a, b) => b - a);

  // Calculate photo counts for years and months
  const getYearPhotoCount = (year: number) => {
    return sortedGroups
      .filter(([key]) => key.startsWith(`${year}-`))
      .reduce((total, [, files]) => total + files.length, 0);
  };

  const getMonthPhotoCount = (year: number, month: number) => {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const group = sortedGroups.find(([groupKey]) => groupKey === key);
    return group ? group[1].length : 0;
  };

  return {
    groups: sortedGroups.map(([key, files], index) => ({
      key,
      name: formatMonthYear(key),
      files: files,
      groupIndex: index, // For scrolling
    })),
    groupCounts: sortedGroups.map(([, files]) => files.length),
    allFiles: sortedGroups.flatMap(([, files]) => files),
    availableYears,
    availableMonths,
    getYearPhotoCount,
    getMonthPhotoCount,
    findGroupIndex: (year: number, month: number) => {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      return sortedGroups.findIndex(([groupKey]) => groupKey === key);
    },
    findItemIndex: (year: number, month: number) => {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      const groupIndex = sortedGroups.findIndex(([groupKey]) => groupKey === key);
      if (groupIndex === -1) {
        return -1;
      }

      // Calculate the starting item index for this group
      // Sum all files in previous groups
      let itemIndex = 0;
      for (let i = 0; i < groupIndex; i++) {
        itemIndex += sortedGroups[i][1].length;
      }
      return itemIndex;
    },
  };
};

// Portal-based dropdown component to avoid z-index stacking issues
const PortalDropdown = ({
  isOpen,
  buttonRef,
  onClose,
  children,
}: {
  isOpen: boolean;
  buttonRef: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
  children: React.ReactNode;
}) => {
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
  }, [isOpen, buttonRef]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // Check if click is outside both button AND dropdown
      const isOutsideButton = buttonRef.current && !buttonRef.current.contains(target);
      const isOutsideDropdown = dropdownRef.current && !dropdownRef.current.contains(target);

      if (isOutsideButton && isOutsideDropdown) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    // Use a small delay to allow click events to process first
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose, buttonRef]);

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div
      ref={dropdownRef}
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        minWidth: position.width,
        maxHeight: '300px',
        backgroundColor: 'white',
        border: '1px solid #ccc',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 9999,
        overflow: 'auto',
      }}
    >
      {children}
    </div>,
    document.body,
  );
};

const arrowButtonStyle = (disabled: boolean, color: string): React.CSSProperties => ({
  border: 'none',
  background: 'transparent',
  fontSize: '20px',
  lineHeight: 1,
  fontWeight: 600,
  width: '28px',
  height: '28px',
  borderRadius: '4px',
  color,
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.3 : 1,
});

// Navigation header component with year/month buttons that toggle dropdowns
const NavigationHeader = observer(
  ({
    groupIndex,
    groups,
    groupCounts,
    availableYears,
    availableMonths,
    getYearPhotoCount,
    getMonthPhotoCount,
    onYearChange,
    onMonthChange,
    onGroupJump,
  }: {
    groupIndex: number;
    groups: Array<{ key: string; name: string; files: ClientFile[]; groupIndex: number }>;
    groupCounts: number[];
    availableYears: number[];
    availableMonths: (year: number) => number[];
    getYearPhotoCount: (year: number) => number;
    getMonthPhotoCount: (year: number, month: number) => number;
    onYearChange: (year: number) => void;
    onMonthChange: (year: number, month: number) => void;
    /** Scroll to the start of the month group with this index (groups are ordered newest first) */
    onGroupJump: (groupIndex: number) => void;
  }) => {
    const { uiStore } = useStore();
    const group = groups[groupIndex];
    const [year, month] = group.key.split('-').map(Number);

    // All hooks must be called before any early returns
    const [showYearDropdown, setShowYearDropdown] = useState(false);
    const [showMonthDropdown, setShowMonthDropdown] = useState(false);

    const yearButtonRef = useRef<HTMLButtonElement>(null);
    const monthButtonRef = useRef<HTMLButtonElement>(null);

    // Safety checks to prevent empty arrays
    const yearOptions = availableYears.length > 0 ? availableYears : [year];
    const monthOptions = availableMonths(year);
    const safeMonthOptions = monthOptions.length > 0 ? monthOptions : [month];

    const monthName = new Date(2000, month - 1).toLocaleDateString('en-US', { month: 'long' });

    // Always read observables to satisfy MobX (prevent derivation warnings)
    const isSlideMode = uiStore.isSlideMode;
    const isPreviewOpen = uiStore.isPreviewOpen;
    const isTagPopoverOpen = uiStore.isToolbarTagPopoverOpen;
    const isOverlayActive = isSlideMode || isPreviewOpen || isTagPopoverOpen;

    // Use app's design system CSS variables for consistency
    const headerStyles = {
      backgroundColor: 'var(--background-color-alt)',
      color: 'var(--text-color-strong)',
      borderColor: 'var(--border-color)',
      buttonColor: 'var(--text-color)',
      iconColor: 'var(--text-color-muted)',
      fileCountColor: 'var(--text-color-muted)',
    };

    // Return invisible placeholder when overlay is active to prevent content jumping
    if (isOverlayActive) {
      return (
        <div
          style={{
            padding: '8px 16px', // Same padding as normal header
            backgroundColor: 'transparent', // Invisible
            fontWeight: '600',
            fontSize: '18px',
            borderBottom: '1px solid transparent', // Same border but transparent
            position: 'sticky',
            top: 0,
            zIndex: -1,
            visibility: 'hidden', // Completely invisible but takes space
            pointerEvents: 'none', // Don't interfere with interactions
          }}
        >
          {/* Invisible content with same structure to maintain height */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '16px', fontWeight: '600' }}>Placeholder ▼</div>
            <div style={{ fontSize: '16px', fontWeight: '600' }}>Placeholder ▼</div>
            <span style={{ fontWeight: '400', color: 'transparent', fontSize: '14px' }}>
              0 files
            </span>
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          padding: '8px 16px',
          backgroundColor: headerStyles.backgroundColor,
          fontWeight: '600',
          fontSize: '18px',
          borderBottom: `1px solid ${headerStyles.borderColor}`,
          position: 'sticky',
          top: 0,
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        {/* Year Button with Portal Dropdown */}
        <div>
          <button
            ref={yearButtonRef}
            onClick={() => setShowYearDropdown(!showYearDropdown)}
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              outline: 'none',
              color: headerStyles.buttonColor,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px',
            }}
          >
            {year}
            <span style={{ fontSize: '12px', color: headerStyles.iconColor }}>▼</span>
          </button>

          <PortalDropdown
            isOpen={showYearDropdown}
            buttonRef={yearButtonRef}
            onClose={() => setShowYearDropdown(false)}
          >
            <select
              value={year}
              onChange={(e) => {
                onYearChange(Number(e.target.value));
                setShowYearDropdown(false);
              }}
              style={{
                width: '100%',
                padding: '8px',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontSize: '16px',
                cursor: 'pointer',
              }}
              size={Math.min(yearOptions.length, 8)}
              autoFocus
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y} ({getYearPhotoCount(y)} files)
                </option>
              ))}
            </select>
          </PortalDropdown>
        </div>

        {/* Month Button with Portal Dropdown */}
        <div>
          <button
            ref={monthButtonRef}
            onClick={() => setShowMonthDropdown(!showMonthDropdown)}
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              outline: 'none',
              color: headerStyles.buttonColor,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px',
            }}
          >
            {monthName}
            <span style={{ fontSize: '12px', color: headerStyles.iconColor }}>▼</span>
          </button>

          <PortalDropdown
            isOpen={showMonthDropdown}
            buttonRef={monthButtonRef}
            onClose={() => setShowMonthDropdown(false)}
          >
            <select
              value={month}
              onChange={(e) => {
                onMonthChange(year, Number(e.target.value));
                setShowMonthDropdown(false);
              }}
              style={{
                width: '100%',
                padding: '8px',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontSize: '16px',
                cursor: 'pointer',
              }}
              size={Math.min(safeMonthOptions.length, 8)}
              autoFocus
            >
              {safeMonthOptions.map((m) => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1).toLocaleDateString('en-US', { month: 'long' })} (
                  {getMonthPhotoCount(year, m)} files)
                </option>
              ))}
            </select>
          </PortalDropdown>
        </div>

        <span
          style={{
            fontWeight: '400',
            color: headerStyles.fileCountColor,
            marginLeft: '8px',
            fontSize: '14px',
          }}
        >
          {groupCounts[groupIndex]} files
        </span>

        {/* Groups are ordered newest first, top to bottom: up is the newer group, down the older one */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
          <button
            onClick={() => onGroupJump(groupIndex - 1)}
            disabled={groupIndex - 1 < 0}
            title="Next month (above)"
            aria-label="Next month"
            style={arrowButtonStyle(groupIndex - 1 < 0, headerStyles.buttonColor)}
          >
            ↑
          </button>
          <button
            onClick={() => onGroupJump(groupIndex + 1)}
            disabled={groupIndex + 1 >= groups.length}
            title="Previous month (below)"
            aria-label="Previous month"
            style={arrowButtonStyle(groupIndex + 1 >= groups.length, headerStyles.buttonColor)}
          >
            ↓
          </button>
        </div>
      </div>
    );
  },
);

// Individual file row component with thumbnail
const FileRow = observer(
  ({
    file,
    thumbnailSize,
    onSelect,
  }: {
    file: ClientFile;
    thumbnailSize: number;
    onSelect: (file: ClientFile, additive: boolean, range: boolean) => void;
  }) => {
    const { uiStore, fileStore } = useStore();
    const [isMounted, setIsMounted] = useState(false);
    const eventManager = useMemo(() => new CommandDispatcher(file), [file]);

    useEffect(() => {
      // Mount the thumbnail after a small delay to improve performance
      const timeout = setTimeout(() => setIsMounted(true), 50);
      return () => clearTimeout(timeout);
    }, []);

    // Scale down the thumbnail size for calendar view (use about 1/4 of the grid size)
    const calendarThumbnailSize = Math.max(32, Math.min(thumbnailSize * 0.25, 80));
    const isSelected = uiStore.fileSelection.has(file);

    // Use design system colors for dark mode compatibility
    const rowStyles = {
      borderColor: 'var(--border-color)',
      backgroundColor: isSelected ? 'var(--background-color-selected)' : 'transparent',
      filenameColor: 'var(--text-color-strong)',
      extensionColor: 'var(--text-color-muted)',
      metadataColor: 'var(--text-color)',
    };

    return (
      <div
        aria-selected={isSelected}
        className={`calendar-file-row ${isSelected ? 'selected' : ''}`}
        style={{
          padding: '4px 8px',
          borderBottom: `1px solid ${rowStyles.borderColor}`,
          backgroundColor: rowStyles.backgroundColor,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onSelect(file, e.ctrlKey || e.metaKey, e.shiftKey);
        }}
        onDoubleClick={() => {
          if (!file.isBroken) {
            uiStore.selectFile(file, true);
            uiStore.enableSlideMode();
          }
        }}
        onContextMenu={eventManager.showContextMenu}
      >
        <div
          className={`calendar-thumbnail-container${file.isBroken ? ' thumbnail-broken' : ''}`}
          style={{
            width: `${calendarThumbnailSize}px`,
            height: `${calendarThumbnailSize}px`,
            flexShrink: 0,
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Thumbnail mounted={isMounted} file={file} />
          {file.isBroken === true && !fileStore.showsMissingContent && (
            <IconButton
              className="thumbnail-broken-overlay"
              icon={IconSet.WARNING_BROKEN_LINK}
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                await fileStore.fetchMissingFiles();
              }}
              text="This image could not be found. Open the recovery view."
            />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '14px', color: rowStyles.filenameColor, fontWeight: '500' }}>
            <span>{file.name.replace(/\.[^/.]+$/, '')}</span>
            <span style={{ fontSize: '11px', color: rowStyles.extensionColor, fontWeight: '400' }}>
              .{file.extension}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: rowStyles.metadataColor, marginTop: '2px' }}>
            {file.dateCreated.toLocaleDateString()} • {file.width} × {file.height}
          </div>
          {file.tags.size > 0 && (
            <div style={{ marginTop: '4px' }}>
              <ThumbnailTags file={file} eventManager={eventManager} />
            </div>
          )}
        </div>
      </div>
    );
  },
);

const GRID_CELL_PADDING = 8;
const SCROLL_BAR_WIDTH = 8;

// One square thumbnail in grid mode. Mirrors the handlers of MasonryCell/FileRow.
const GridCell = observer(({ file, size }: { file: ClientFile; size: number }) => {
  const { uiStore, fileStore } = useStore();
  const [isMounted, setIsMounted] = useState(false);
  const eventManager = useMemo(() => new CommandDispatcher(file), [file]);

  useEffect(() => {
    const timeout = setTimeout(() => setIsMounted(true), 50);
    return () => clearTimeout(timeout);
  }, []);

  const isSelected = uiStore.fileSelection.has(file);

  return (
    <div
      className="calendar-grid-cell"
      aria-selected={isSelected}
      style={{ width: size, height: size }}
    >
      <div
        className={`thumbnail${file.isBroken ? ' thumbnail-broken' : ''}`}
        onClick={eventManager.select}
        onDoubleClick={eventManager.preview}
        onContextMenu={eventManager.showContextMenu}
        onDragStart={eventManager.dragStart}
        onDragEnter={eventManager.dragEnter}
        onDragOver={eventManager.dragOver}
        onDragLeave={eventManager.dragLeave}
        onDrop={eventManager.drop}
        onDragEnd={eventManager.dragEnd}
      >
        <Thumbnail mounted={isMounted} file={file} />
      </div>
      {file.isBroken === true && !fileStore.showsMissingContent && (
        <IconButton
          className="thumbnail-broken-overlay"
          icon={IconSet.WARNING_BROKEN_LINK}
          onClick={async (e) => {
            e.stopPropagation();
            e.preventDefault();
            await fileStore.fetchMissingFiles();
          }}
          text="This image could not be found. Open the recovery view."
        />
      )}
      {(uiStore.isThumbnailTagOverlayEnabled || isSelected) && file.tags.size > 0 && (
        <ThumbnailTags file={file} eventManager={eventManager} />
      )}
    </div>
  );
});

const CalendarGallery = observer(({ contentRect, select, lastSelectionIndex }: GalleryProps) => {
  const { fileStore, uiStore } = useStore();
  const virtuosoRef = useRef<GroupedVirtuosoHandle>(null);
  /** Index of the first item (file in list mode, row in grid mode) currently in view */
  const topItemIndex = useRef(0);

  // Navigation state no longer needed - each header shows its own month/year

  // Note: no useCommandHandler here. LayoutSwitcher already registers it on window for every view, and registering it
  // twice runs each select command twice, so cmd+click toggled a file on and straight back off.

  const {
    groups,
    groupCounts,
    allFiles,
    availableYears,
    availableMonths,
    getYearPhotoCount,
    getMonthPhotoCount,
    findItemIndex,
  } = useMemo(() => {
    return groupFilesByMonth(fileStore.fileList);
  }, [fileStore.fileList, fileStore.fileListLastModified]);

  const isGrid = uiStore.calendarLayout === 'grid';
  const thumbnailSize = getThumbnailSize(uiStore.thumbnailSize);
  const cellSize = thumbnailSize + GRID_CELL_PADDING;
  const columns = isGrid ? computeColumns(contentRect.width - SCROLL_BAR_WIDTH, cellSize) : 1;

  // Rows per month (grid) or files per month (list), plus the flat list of rows for itemContent
  const { gridRows, virtuosoGroupCounts } = useMemo(() => {
    if (!isGrid) {
      return { gridRows: [] as ClientFile[][], virtuosoGroupCounts: groupCounts };
    }
    const rows: ClientFile[][] = [];
    const counts: number[] = [];
    let offset = 0;
    for (const size of groupCounts) {
      const monthRows = chunkIntoRows(allFiles.slice(offset, offset + size), columns);
      rows.push(...monthRows);
      counts.push(monthRows.length);
      offset += size;
    }
    return { gridRows: rows, virtuosoGroupCounts: counts };
  }, [isGrid, allFiles, groupCounts, columns]);

  // Index to scroll to for a month: a file index in list mode, a row index in grid mode
  const findScrollIndex = useCallback(
    (year: number, month: number) => {
      if (!isGrid) {
        return findItemIndex(year, month);
      }
      const key = `${year}-${String(month).padStart(2, '0')}`;
      const groupIndex = groups.findIndex((g) => g.key === key);
      return groupIndex === -1 ? -1 : rowStartIndex(groupCounts, groupIndex, columns);
    },
    [isGrid, findItemIndex, groups, groupCounts, columns],
  );

  // Navigation handlers - now just handle scrolling to selected year/month
  const handleYearChange = useCallback(
    (year: number) => {
      const firstMonthOfYear = availableMonths(year)[0];
      const itemIndex = findScrollIndex(year, firstMonthOfYear);
      if (itemIndex >= 0 && virtuosoRef.current) {
        // Try scrolling to the item index with specific alignment
        virtuosoRef.current.scrollToIndex({
          index: itemIndex,
          align: 'start',
          behavior: 'smooth',
        });
      }
    },
    [availableMonths, findScrollIndex],
  );

  const handleMonthChange = useCallback(
    (year: number, month: number) => {
      const itemIndex = findScrollIndex(year, month);
      if (itemIndex >= 0 && virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({
          index: itemIndex,
          align: 'start',
          behavior: 'smooth',
        });
      }
    },
    [findScrollIndex],
  );

  // Scroll to the start of a month group: a file index in list mode (columns = 1), a row index in grid mode
  const handleGroupJump = useCallback(
    (groupIndex: number) => {
      if (groupIndex < 0 || groupIndex >= groupCounts.length || !virtuosoRef.current) {
        return;
      }
      virtuosoRef.current.scrollToIndex({
        index: rowStartIndex(groupCounts, groupIndex, columns),
        align: 'start',
        behavior: 'smooth',
      });
    },
    [groupCounts, columns],
  );

  // Month grouping and keyboard/range selection only line up with the file list when it is sorted by date created,
  // newest first. setMethodCalendar sorts that way, but a restored session or the context menu can change it.
  const { orderBy, orderDirection } = fileStore;
  useEffect(() => {
    for (const fix of calendarSortFixes(orderBy, orderDirection === OrderDirection.Desc)) {
      if (fix === 'orderByDateCreated') {
        fileStore.orderFilesBy('dateCreated');
      } else {
        fileStore.switchOrderDirection();
      }
    }
  }, [fileStore, orderBy, orderDirection]);

  // Add keyboard navigation support like other gallery components.
  // Navigates over the on-screen (month grouped) order, moving by one row of cells in grid mode.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Month jump shortcuts (configurable in Settings > Shortcuts), relative to the month at the top of the view
      const combo = getKeyCombo(e);
      const isNewer = comboMatches(combo, parseKeyCombo(uiStore.hotkeyMap.calendarNewerMonth));
      const isOlder = comboMatches(combo, parseKeyCombo(uiStore.hotkeyMap.calendarOlderMonth));
      if (isNewer || isOlder) {
        if (
          uiStore.isSlideMode ||
          (e.target as HTMLElement | null)?.matches('input, select, textarea')
        ) {
          return;
        }
        e.preventDefault();
        const current = groupIndexAt(virtuosoGroupCounts, topItemIndex.current);
        handleGroupJump(isNewer ? current - 1 : current + 1);
        return;
      }

      const index = lastSelectionIndex.current;
      if (index === undefined) {
        return;
      }
      const position = allFiles.indexOf(fileStore.fileList[index]);
      if (position === -1) {
        return;
      }
      const target = getGridArrowTarget(groupCounts, position, e.key, columns);
      if (target === undefined) {
        return;
      }
      e.preventDefault();
      select(allFiles[target], e.ctrlKey || e.metaKey, e.shiftKey);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    fileStore,
    uiStore,
    select,
    lastSelectionIndex,
    allFiles,
    groupCounts,
    virtuosoGroupCounts,
    columns,
    handleGroupJump,
  ]);

  if (fileStore.fileList.length === 0) {
    return (
      <div
        className="calendar-gallery"
        style={{ height: contentRect.height, width: contentRect.width }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#666',
            fontSize: '16px',
          }}
        >
          No files to display
        </div>
      </div>
    );
  }

  return (
    <div
      className="calendar-gallery"
      style={{ height: contentRect.height, width: contentRect.width }}
    >
      <GroupedVirtuoso
        ref={virtuosoRef}
        style={{ height: '100%', width: '100%' }}
        groupCounts={virtuosoGroupCounts}
        rangeChanged={({ startIndex }) => {
          topItemIndex.current = startIndex;
        }}
        groupContent={(index) => (
          <NavigationHeader
            groupIndex={index}
            groups={groups}
            groupCounts={groupCounts}
            availableYears={availableYears}
            availableMonths={availableMonths}
            getYearPhotoCount={getYearPhotoCount}
            getMonthPhotoCount={getMonthPhotoCount}
            onYearChange={handleYearChange}
            onMonthChange={handleMonthChange}
            onGroupJump={handleGroupJump}
          />
        )}
        itemContent={(index) => {
          if (!isGrid) {
            const file = allFiles[index];
            return <FileRow file={file} thumbnailSize={thumbnailSize} onSelect={select} />;
          }
          return (
            <div className="calendar-grid-row">
              {gridRows[index].map((file) => (
                <GridCell key={file.id} file={file} size={thumbnailSize} />
              ))}
            </div>
          );
        }}
      />
    </div>
  );
});

export default CalendarGallery;
