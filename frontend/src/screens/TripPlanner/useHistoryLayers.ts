import { useEffect, useLayoutEffect, useRef } from 'react';

export interface HistoryLayers {
  /** The full-screen trip form. */
  form: boolean;
  /** The results sheet, opened above its peek height. */
  results: boolean;
}

interface LayerEntry {
  sr: 'form' | 'results';
  results: boolean;
}

function readEntry(state: unknown): LayerEntry | null {
  const s = state as LayerEntry | null;
  return s && (s.sr === 'form' || s.sr === 'results') ? s : null;
}

/**
 * Gives each phone overlay its own history entry, so the system Back gesture
 * closes the form or lowers the sheet instead of leaving the app with the trip,
 * and Forward reopens it. Closing an overlay from the UI pops its entry, so the
 * stack never fills with dead steps.
 *
 * `onPop` receives the layers the entry being returned to had open.
 */
export function useHistoryLayers(enabled: boolean, open: HistoryLayers, onPop: (layers: HistoryLayers) => void): void {
  const pushed = useRef<HistoryLayers>({ form: false, results: false });
  const onPopRef = useRef(onPop);
  useLayoutEffect(() => {
    onPopRef.current = onPop;
  });

  useEffect(() => {
    if (!enabled) return;
    // A reload lands on whatever entry the last session left; adopt it rather than stack another.
    const current = readEntry(window.history.state);
    pushed.current = { form: false, results: current?.results ?? false };
    if (current?.sr === 'form') {
      window.history.replaceState(current.results ? { sr: 'results', results: true } : null, '');
    }

    const onPopState = (event: PopStateEvent) => {
      const entry = readEntry(event.state);
      pushed.current = { form: entry?.sr === 'form', results: entry?.results ?? false };
      onPopRef.current({ ...pushed.current });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [enabled]);

  const { form, results } = open;
  useEffect(() => {
    if (!enabled) return;
    const p = pushed.current;
    if (form) {
      if (!p.form) {
        window.history.pushState({ sr: 'form', results: p.results } satisfies LayerEntry, '');
        p.form = true;
      }
      return;
    }
    if (p.form) {
      p.form = false;
      // Submitting turns the form into results: reuse its entry instead of popping and pushing.
      if (results && !p.results) {
        window.history.replaceState({ sr: 'results', results: true } satisfies LayerEntry, '');
        p.results = true;
      } else {
        window.history.back();
      }
      return;
    }
    if (results && !p.results) {
      window.history.pushState({ sr: 'results', results: true } satisfies LayerEntry, '');
      p.results = true;
    } else if (!results && p.results) {
      p.results = false;
      window.history.back();
    }
  }, [enabled, form, results]);
}
