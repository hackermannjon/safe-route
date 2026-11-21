import { useEffect, useRef } from 'react';
import { EmptyState } from '../../components/EmptyState';
import type { MapTheme } from '../../components/MapView/MapView';
import { ThemeToggle } from '../../components/ThemeToggle';
import { TripPill } from '../../components/TripPill';
import { EMPTY_STATE } from './copy';
import { LazyMapView } from './LazyMapView';
import { ResultsContent } from './ResultsContent';
import { resultsProps } from './resultsProps';
import { TripForm } from './TripForm';
import type { TripPlannerViewModel } from './useTripPlannerViewModel';
import styles from './DesktopView.module.css';

interface ViewProps {
  vm: TripPlannerViewModel;
  theme: MapTheme;
  onToggleTheme: () => void;
}

export function DesktopView({ vm, theme, onToggleTheme }: ViewProps) {
  const panelRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const wasExpanded = useRef(vm.formExpanded);

  // Keep keyboard focus on what replaced the control it was on: the trip line after the form
  // collapses, the first field after it opens again.
  useEffect(() => {
    if (wasExpanded.current === vm.formExpanded) return;
    wasExpanded.current = vm.formExpanded;
    const active = document.activeElement;
    const panel = panelRef.current;
    if (!panel || (active && active !== document.body && !panel.contains(active))) return;
    const target = vm.formExpanded
      ? formRef.current?.querySelector<HTMLElement>('input')
      : formRef.current?.querySelector<HTMLElement>('button');
    target?.focus();
  }, [vm.formExpanded]);

  return (
    <div className={styles.root}>
      <aside ref={panelRef} className={styles.panel} aria-label="Trip planner">
        <header className={styles.brand}>
          <div className={styles.name}>
            <h1 className={styles.wordmark}>Safe Route</h1>
            <p className={styles.tagline}>Weather-aware truck routing</p>
          </div>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </header>

        <div ref={formRef}>
          {vm.formExpanded ? (
            <TripForm vm={vm} onCancel={vm.hasResults ? vm.closeForm : undefined} />
          ) : (
            <TripPill
              variant="inline"
              route={vm.tripLine?.route ?? null}
              details={vm.tripLine?.details}
              onEdit={vm.openForm}
            />
          )}
        </div>

        <div className={styles.results}>
          {vm.hasResults ? (
            <ResultsContent {...resultsProps(vm)} />
          ) : (
            <EmptyState
              compact
              title={EMPTY_STATE.title}
              body={EMPTY_STATE.body}
              actionLabel={EMPTY_STATE.action}
              onAction={vm.fillExample}
            />
          )}
        </div>
      </aside>

      <main className={styles.map}>
        <LazyMapView
          routes={vm.routes}
          selectedRouteId={vm.selectedRouteId}
          onSelectRoute={vm.selectRoute}
          checkpoints={vm.checkpoints}
          selectedCheckpoint={vm.selectedCheckpoint}
          onSelectCheckpoint={vm.selectCheckpoint}
          onCloseCheckpoint={vm.clearCheckpoint}
          theme={theme}
        />
      </main>
    </div>
  );
}
