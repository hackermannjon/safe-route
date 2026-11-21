import { memo } from 'react';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Icon } from '../../components/Icon';
import { LoadingState } from '../../components/LoadingState';
import { RouteList, type RouteListItem } from '../../components/RouteList';
import type { PlanStatus } from './useTripPlannerViewModel';
import styles from './ResultsContent.module.css';

export interface ResultsContentProps {
  status: PlanStatus;
  error: string | null;
  onRetry: () => void;
  onDismissError: () => void;
  heading: string;
  notices: readonly string[];
  routes: RouteListItem[];
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
  /** The container's header already says what is happening, so loading and errors skip their titles. */
  statusInHeader?: boolean;
}

const LOADING_MESSAGE = 'Finding routes…';
const LOADING_DETAIL = 'Up to three truck routes, fastest first.';

/**
 * Everything below the form, the same on both layouts; only its container differs. Memoised so
 * form edits and sheet moves, which re-render the screen, skip the route list.
 */
export const ResultsContent = memo(function ResultsContent({
  status,
  error,
  onRetry,
  onDismissError,
  heading,
  notices,
  routes,
  selectedRouteId,
  onSelectRoute,
  statusInHeader = false,
}: ResultsContentProps) {
  if (status === 'loading') {
    return <LoadingState message={LOADING_MESSAGE} detail={LOADING_DETAIL} messageHidden={statusInHeader} />;
  }

  if (status === 'error' && error) {
    return (
      <ErrorBanner
        message={error}
        title={statusInHeader ? null : undefined}
        onRetry={onRetry}
        onDismiss={onDismissError}
        focusOnMount
      />
    );
  }

  if (routes.length === 0) return null;

  return (
    <div className={styles.results}>
      {notices.length > 0 && (
        <ul className={styles.notices}>
          {notices.map((notice) => (
            <li key={notice} className={styles.notice}>
              <Icon name="info" size={18} className={styles.noticeIcon} />
              {notice}
            </li>
          ))}
        </ul>
      )}
      <section className={styles.routes} aria-labelledby="routes-heading">
        <h2 id="routes-heading" className={styles.heading}>
          {heading}
        </h2>
        <RouteList routes={routes} selectedId={selectedRouteId} onSelect={onSelectRoute} />
      </section>
    </div>
  );
});
