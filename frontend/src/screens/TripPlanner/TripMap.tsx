import type { MapViewProps } from '../../components/MapView/MapView';
import { LazyMapView } from './LazyMapView';
import { useForecastViewModel } from './useForecastViewModel';

export type TripMapProps = Omit<MapViewProps, 'heatmap' | 'truck'>;

/** The map, with the forecast hour and the truck read through the scoped forecast ViewModel. */
export function TripMap(props: TripMapProps) {
  const { mapHeatmap, truck } = useForecastViewModel();
  return <LazyMapView {...props} heatmap={mapHeatmap} truck={truck} />;
}
