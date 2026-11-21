import { Button } from '../../components/Button';
import { DateTimeField } from '../../components/DateTimeField';
import { NumberField } from '../../components/NumberField';
import { PlaceField } from '../../components/PlaceField';
import { SegmentedControl } from '../../components/SegmentedControl';
import { WeatherIcon } from '../../components/WeatherIcon';
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
      <DateTimeField label="Departure" {...vm.departure} />
      <NumberField label="Cargo weight" icon={<WeatherIcon name="weight" size={20} />} {...vm.cargo} />
      <SegmentedControl label="Checkpoint every" {...vm.spacing} />
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
