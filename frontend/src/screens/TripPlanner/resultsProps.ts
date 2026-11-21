import type { ResultsContentProps } from './ResultsContent';
import type { TripPlannerViewModel } from './useTripPlannerViewModel';

/** The parts of the ViewModel the results read; every one keeps its identity between renders. */
export function resultsProps(vm: TripPlannerViewModel): ResultsContentProps {
  return {
    status: vm.status,
    error: vm.error,
    onRetry: vm.retry,
    onDismissError: vm.dismissError,
    heading: vm.routesHeading,
    notices: vm.notices,
    routes: vm.summaries,
    selectedRouteId: vm.selectedRouteId,
    onSelectRoute: vm.selectRoute,
    timeline: vm.timeline,
    selectedCheckpoint: vm.selectedCheckpoint,
    onSelectCheckpoint: vm.selectCheckpoint,
  };
}
