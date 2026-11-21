import { useMemo, useState } from 'react';
import { BottomSheet, SHEET_EASING, SHEET_MOVE_MS } from '../../components/BottomSheet';
import { EmptyState } from '../../components/EmptyState';
import type { CameraMotion, MapPadding, MapTheme } from '../../components/MapView/MapView';
import { ThemeToggle } from '../../components/ThemeToggle';
import { TripPill } from '../../components/TripPill';
import { useCoverage } from '../../hooks/useCoverage';
import { usePresence } from '../../hooks/usePresence';
import { useViewportHeight } from '../../hooks/useViewportHeight';
import { cubicBezier } from '../../lib/easing';
import { EMPTY_STATE } from './copy';
import { FORECAST_EXIT_MS, ForecastPanel, WeatherToggle } from './ForecastPanel';
import { FORM_EXIT_MS, FormPanel } from './FormPanel';
import { TripMap } from './TripMap';
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
/** The map recentres in step with the sheet that moved, on the same curve. */
const WITH_SHEET: CameraMotion = { durationMs: SHEET_MOVE_MS, easing: cubicBezier(...SHEET_EASING) };

export function MobileView({ vm, theme, onToggleTheme }: ViewProps) {
  const viewport = useViewportHeight();
  const [top, setTop] = useState<HTMLElement | null>(null);
  const [intro, setIntro] = useState<HTMLElement | null>(null);
  const [forecast, setForecast] = useState<HTMLElement | null>(null);
  const topCoverage = useCoverage(top, 'top', 80);
  const introCoverage = useCoverage(intro, 'bottom', 220);
  const forecastCoverage = useCoverage(forecast, 'bottom', 300);
  const heatmapOn = vm.heatmap.status !== 'off';
  const peek = vm.sheetSnap === 'peek';
  const minimized = peek && vm.heatmap.playing;
  const forecastPanel = usePresence(heatmapOn && peek, FORECAST_EXIT_MS);
  const formPanel = usePresence(vm.formOpen, FORM_EXIT_MS);

  // A full sheet hides the map anyway; fit as if half so the routes don't jump when it comes down.
  const bottom = !vm.hasResults
    ? introCoverage
    : !peek
      ? Math.round(viewport * 0.5)
      : heatmapOn
        ? forecastCoverage
        : PEEK_CLEARANCE;
  const padding = useMemo<MapPadding>(() => ({ top: topCoverage, right: 0, bottom, left: 0 }), [topCoverage, bottom]);

  return (
    <div className={styles.root} data-snap={vm.sheetSnap} data-minimized={minimized ? '' : undefined}>
      {/* The form is modal; inert keeps Tab and screen readers out of what is behind it. */}
      <div className={styles.stage} inert={vm.formOpen}>
        <main className={styles.map}>
          <TripMap
            routes={vm.routes}
            selectedRouteId={vm.selectedRouteId}
            onSelectRoute={vm.selectRoute}
            previewRouteId={vm.previewRouteId}
            checkpoints={vm.checkpoints}
            selectedCheckpoint={vm.selectedCheckpoint}
            onSelectCheckpoint={vm.selectCheckpoint}
            onCloseCheckpoint={vm.clearCheckpoint}
            padding={padding}
            paddingMotion={WITH_SHEET}
            theme={theme}
            zoomControls={false}
            escapeCloses={false}
          />
        </main>

        <header ref={setTop} className={styles.top}>
          <h1 className="visually-hidden">Safe Route</h1>
          <TripPill route={vm.tripLine?.route ?? null} details={vm.tripLine?.details} onEdit={vm.openForm} />
          <div className={styles.tools}>
            {vm.heatmap.available && <WeatherToggle heatmap={vm.heatmap} />}
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

        {forecastPanel.mounted && (
          <ForecastPanel
            ref={setForecast}
            heatmap={vm.heatmap}
            className={styles.forecast}
            leaving={forecastPanel.leaving}
          />
        )}

        {vm.hasResults && (
          <BottomSheet
            label="Trip results"
            snap={vm.sheetSnap}
            onSnapChange={vm.setSheetSnap}
            minimized={minimized}
            header={<PeekHeader status={vm.status} error={vm.error} route={vm.selectedSummary} />}
          >
            {/* The peek header already carries the route summary and the status line. */}
            <ResultsContent {...resultsProps(vm)} summary={null} statusInHeader />
          </BottomSheet>
        )}
      </div>

      {formPanel.mounted && <FormPanel vm={vm} leaving={formPanel.leaving} />}
    </div>
  );
}
