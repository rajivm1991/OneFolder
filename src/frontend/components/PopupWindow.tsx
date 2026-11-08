import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import Overlay from '../Overlay';

const PLATFORM = process.platform;
type PopupWindowProps = {
  children: React.ReactNode;
  onClose: () => void;
  windowName: string;
  closeOnEscape?: boolean;
  additionalCloseKey?: string;
};

/**
 * Creates a new external browser window, that renders whatever you pass as children
 */
const PopupWindow: React.FC<PopupWindowProps> = (props) => {
  const [containerEl] = useState(document.createElement('div'));
  const [win, setWin] = useState<Window>();

  useEffect(() => {
    const externalWindow = window.open('', props.windowName);
    if (!externalWindow) {
      throw new Error('External window not supported!');
    }
    setWin(externalWindow);

    externalWindow.document.body.appendChild(containerEl);

    // Copy style sheets from main window
    copyStyles(document, externalWindow.document);
    copyAccentColor(document, externalWindow.document);
    containerEl.setAttribute('data-os', PLATFORM);

    // Hacky func for re-applying CSS to settings when changing that of the main window
    (window as any).reapplyPopupStyles = () => {
      copyStyles(document, externalWindow.document);
      copyAccentColor(document, externalWindow.document);
    };
    // Called when the system accent colour changes
    const reapplyAccent = () => copyAccentColor(document, externalWindow.document);
    popupAccentCallbacks.add(reapplyAccent);

    externalWindow.addEventListener('beforeunload', props.onClose);

    if (props.closeOnEscape) {
      externalWindow.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.key === props.additionalCloseKey) {
          props.onClose();
        }
      });
    }

    return function cleanup() {
      popupAccentCallbacks.delete(reapplyAccent);
      externalWindow.close();
      setWin(undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (win) {
    return ReactDOM.createPortal(
      <>
        {props.children}
        <Overlay document={win.document} />
      </>,
      containerEl,
    );
  }
  return null;
};

export default PopupWindow;

/** One entry per open popup window */
const popupAccentCallbacks = new Set<() => void>();

/** Copies the system accent colour from the main window to every open popup window */
export function reapplyPopupAccents() {
  popupAccentCallbacks.forEach((reapply) => reapply());
}

/** The system accent colour is an inline style on the root element, which is not part of the style sheets */
function copyAccentColor(sourceDoc: Document, targetDoc: Document) {
  for (const property of [
    '--system-accent',
    '--system-accent-text',
    '--system-accent-fg-light',
    '--system-accent-fg-dark',
  ]) {
    const value = sourceDoc.documentElement.style.getPropertyValue(property);
    if (value) {
      targetDoc.documentElement.style.setProperty(property, value);
    } else {
      targetDoc.documentElement.style.removeProperty(property);
    }
  }
}

function copyStyles(sourceDoc: Document, targetDoc: Document) {
  // First clear any existing styles
  ['style', 'link'].forEach((t) =>
    Array.from(targetDoc.getElementsByTagName(t)).forEach((i) => i.parentElement?.removeChild(i)),
  );

  for (let i = 0; i < sourceDoc.styleSheets.length; i++) {
    const styleSheet = sourceDoc.styleSheets[i];
    // production mode bundles CSS in one file
    if (styleSheet.href) {
      const linkElement = targetDoc.createElement('link');
      linkElement.rel = 'stylesheet';
      linkElement.href = styleSheet.href;
      targetDoc.head.appendChild(linkElement);
      // development mode injects style elements for CSS
    } else if (styleSheet.cssRules.length > 0) {
      const styleElement = targetDoc.createElement('style');
      for (let i = 0; i < styleSheet.cssRules.length; i++) {
        const cssRule = styleSheet.cssRules[i];
        styleElement.appendChild(targetDoc.createTextNode(cssRule.cssText));
      }
      targetDoc.head.appendChild(styleElement);
    }
  }
}
