import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useColorScheme } from '../../hooks/useColorScheme';
import { DesktopView } from './DesktopView';
import { MobileView } from './MobileView';
import { useTripPlannerViewModel } from './useTripPlannerViewModel';

export default function TripPlanner() {
  const breakpoint = useBreakpoint();
  const { theme, toggleTheme } = useColorScheme();
  const vm = useTripPlannerViewModel({ layout: breakpoint });

  return breakpoint === 'desktop' ? (
    <DesktopView vm={vm} theme={theme} onToggleTheme={toggleTheme} />
  ) : (
    <MobileView vm={vm} theme={theme} onToggleTheme={toggleTheme} />
  );
}
