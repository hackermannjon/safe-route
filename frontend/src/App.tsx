import { AppErrorBoundary } from './app/AppErrorBoundary';
import TripPlanner from './screens/TripPlanner';

export default function App() {
  return (
    <AppErrorBoundary>
      <TripPlanner />
    </AppErrorBoundary>
  );
}
