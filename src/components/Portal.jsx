import { createPortal } from 'react-dom';

// Renders its children into .zoom-canvas (see ZoomViewport.jsx), falling back
// to <body> if the canvas isn't mounted yet (e.g. the login screen). Portaling
// still escapes whatever scrollable/overflow-hidden container the trigger
// lives in, but staying inside the canvas means backdrops and dialogs zoom and
// pan along with the rest of the app instead of sitting fixed against the real
// viewport.
export default function Portal({ children }) {
  const target = document.querySelector('.zoom-canvas') || document.body;
  return createPortal(children, target);
}
