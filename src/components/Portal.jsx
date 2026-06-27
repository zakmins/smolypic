import { createPortal } from 'react-dom';

// Renders its children into <body>, outside the app's zoom canvas. A
// position:fixed overlay is anchored to the nearest transformed ancestor, so
// when the shell is zoomed (see ZoomViewport.jsx) an inline modal/drawer would
// drift and scale with the zoom. Portaling to <body> escapes that transform so
// backdrops and dialogs always sit against the real viewport, zoomed or not.
export default function Portal({ children }) {
  return createPortal(children, document.body);
}
