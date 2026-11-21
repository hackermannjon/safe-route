import { useEffect, useLayoutEffect, useRef } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { TripForm } from './TripForm';
import type { TripPlannerViewModel } from './useTripPlannerViewModel';
import styles from './FormPanel.module.css';

/** Mirrors the leave animation in FormPanel.module.css. */
export const FORM_EXIT_MS = 220;

interface FormPanelProps {
  vm: TripPlannerViewModel;
  /** Closed and sliding away; it takes no input and is gone for assistive technology already. */
  leaving?: boolean;
}

/** The trip form over the whole screen on a phone, opened from the search pill. */
export function FormPanel({ vm, leaving = false }: FormPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Focus moves into the dialog without opening the keyboard, and goes back to the opener on
  // close. A layout effect, so it runs before anything inside asks for focus itself.
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openerRef.current = opener;
    headingRef.current?.focus();
    return () => opener?.focus();
  }, []);

  // Focus cannot wait out the exit inside a panel that no longer takes input.
  useEffect(() => {
    if (leaving) openerRef.current?.focus();
  }, [leaving]);

  return (
    <div
      className={styles.panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="trip-form-title"
      data-leaving={leaving ? '' : undefined}
      aria-hidden={leaving || undefined}
      inert={leaving}
    >
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
