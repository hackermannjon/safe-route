import { useLayoutEffect, useRef } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { TripForm } from './TripForm';
import type { TripPlannerViewModel } from './useTripPlannerViewModel';
import styles from './FormPanel.module.css';

/** The trip form over the whole screen on a phone, opened from the search pill. */
export function FormPanel({ vm }: { vm: TripPlannerViewModel }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Focus moves into the dialog without opening the keyboard, and goes back to the opener on
  // close. A layout effect, so it runs before anything inside asks for focus itself.
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    return () => opener?.focus();
  }, []);

  return (
    <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="trip-form-title">
      <header className={styles.header}>
        <Button variant="ghost" icon aria-label="Close trip form" onClick={vm.closeForm}>
          <Icon name="back" size={22} />
        </Button>
        <h2 id="trip-form-title" ref={headingRef} tabIndex={-1} className={styles.title}>
          Plan a trip
        </h2>
      </header>
      <div className={styles.body}>
        <TripForm vm={vm} />
      </div>
    </div>
  );
}
