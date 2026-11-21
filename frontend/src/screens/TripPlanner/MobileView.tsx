import { useMemo, useState } from 'react';
import { BottomSheet } from '../../components/BottomSheet';
import { EmptyState } from '../../components/EmptyState';
import type { MapPadding, MapTheme } from '../../components/MapView/MapView';
import { ThemeToggle } from '../../components/ThemeToggle';
import { TripPill } from '../../components/TripPill';
import { useCoverage } from '../../hooks/useCoverage';
import { useViewportHeight } from '../../hooks/useViewportHeight';
import { EMPTY_STATE } from './copy';
import { FormPanel } from './FormPanel';
import { LazyMapView } from './LazyMapView';
import { PeekHeader } from './PeekHeader';
import { ResultsContent } from './ResultsContent';
import { resultsProps } from './resultsProps';
import type { TripPlannerViewModel } from './useTripPlannerViewModel';
import styles from './MobileView.module.css';

interface ViewProps {
  vm: TripPlannerViewModel;
  theme: MapTheme;
  onToggleTheme: () => void;
}

/** Mirrors --sheet-peek in BottomSheet.module.css. */
const PEEK_CLEARANCE = 144;

export function MobileView({ vm, theme, onToggleTheme }: ViewProps) {
  const viewport = useViewportHeight();
  const [top, setTop] = useState<HTMLElement | null>(null);
  const [intro, setIntro] = useState<HTMLElement | null>(null);
  const topCoverage = useCoverage(top, 'top', 80);
  const introCoverage = useCoverage(intro, 'bottom', 220);
  const peek = vm.sheetSnap === 'peek';

  // A full sheet hides the map anyway; fit as if half so the routes don't jump when it comes down.
  const bottom = !vm.hasResults ? introCoverage : !peek ? Math.round(viewport * 0.5) : PEEK_CLEARANCE;
  const padding = useMemo<MapPadding>(() => ({ top: topCoverage, right: 0, bottom, left: 0 }), [topCoverage, bottom]);

  return (
    <div className={styles.root} data-snap={vm.sheetSnap}>
      {/* The form is modal; inert keeps Tab and screen readers out of what is behind it. */}
      <div className={styles.stage} inert={vm.formOpen}>
        <main className={styles.map}>
          <LazyMapView
            routes={vm.routes}
            selectedRouteId={vm.selectedRouteId}
            onSelectRoute={vm.selectRoute}
            checkpoints={vm.checkpoints}
            selectedCheckpoint={vm.selectedCheckpoint}
            onSelectCheckpoint={vm.selectCheckpoint}
            onCloseCheckpoint={vm.clearCheckpoint}
            padding={padding}
            theme={theme}
            zoomControls={false}
            escapeCloses={false}
          />
        </main>

        <header ref={setTop} className={styles.top}>
          <h1 className="visually-hidden">Safe Route</h1>
          <TripPill route={vm.tripLine?.route ?? null} details={vm.tripLine?.details} onEdit={vm.openForm} />
          <div className={styles.tools}>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} className={styles.theme} />
          </div>
        </header>

        {!vm.hasResults && (
          <div ref={setIntro} className={styles.intro}>
            <EmptyState
              title={EMPTY_STATE.title}
              body={EMPTY_STATE.body}
              actionLabel={EMPTY_STATE.action}
              onAction={vm.fillExample}
            />
          </div>
        )}

        {vm.hasResults && (
          <BottomSheet
            label="Trip results"
            snap={vm.sheetSnap}
            onSnapChange={vm.setSheetSnap}
            header={<PeekHeader status={vm.status} error={vm.error} route={vm.selectedSummary} />}
          >
            {/* The peek header already carries the status line. */}
            <ResultsContent {...resultsProps(vm)} statusInHeader />
          </BottomSheet>
        )}
      </div>

      {vm.formOpen && <FormPanel vm={vm} />}
    </div>
  );
}
