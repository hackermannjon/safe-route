import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  const vv = window.visualViewport;
  window.addEventListener('resize', onChange);
  vv?.addEventListener('resize', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    vv?.removeEventListener('resize', onChange);
  };
}

// Layout viewport, not visualViewport: the on-screen keyboard shrinks the latter
// and would make the map refit every time an input gains focus.
const getSnapshot = () => window.innerHeight;

export function useViewportHeight(): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => 800);
}
