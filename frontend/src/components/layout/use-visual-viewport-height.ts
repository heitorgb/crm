import { useEffect } from 'react';

const VIEWPORT_HEIGHT_PROPERTY = '--app-viewport-height';

export function useVisualViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    const root = document.documentElement;
    // Multiplying by the scale ignores pinch-zoom, so only the on-screen keyboard
    // and browser chrome shrink the layout.
    const update = (): void => {
      root.style.setProperty(VIEWPORT_HEIGHT_PROPERTY, `${Math.round(viewport.height * viewport.scale)}px`);
    };

    update();
    viewport.addEventListener('resize', update);
    return () => {
      viewport.removeEventListener('resize', update);
      root.style.removeProperty(VIEWPORT_HEIGHT_PROPERTY);
    };
  }, []);
}
