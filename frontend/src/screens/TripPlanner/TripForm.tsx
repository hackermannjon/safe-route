import { Button } from '../../components/Button';
import { PlaceField } from '../../components/PlaceField';
import type { TripPlannerViewModel } from './useTripPlannerViewModel';
import styles from './TripForm.module.css';

interface TripFormProps {
  vm: TripPlannerViewModel;
  /** Shown when there are results to go back to. */
  onCancel?: () => void;
}

export function TripForm({ vm, onCancel }: TripFormProps) {
  return (
    <form className={styles.form} onSubmit={vm.submit} noValidate aria-label="Trip details">
      <PlaceField label="From" placeholder="City or address" {...vm.origin} />
      <PlaceField label="To" placeholder="City or address" {...vm.destination} />
      <div className={styles.actions}>
        <Button type="submit" block loading={vm.planning} loadingLabel="Finding routes">
          Find routes
        </Button>
        {onCancel && (
          <Button variant="ghost" block onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
