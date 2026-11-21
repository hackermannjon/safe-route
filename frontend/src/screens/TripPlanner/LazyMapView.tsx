import { lazy, Suspense } from 'react';
import type { MapViewProps } from '../../components/MapView/MapView';

// MapLibre is most of the bundle; the shell and the form paint before it arrives. The fallback
// is empty because the map's container already has the basemap's background colour.
const MapView = lazy(() => import('../../components/MapView/MapView'));

export function LazyMapView(props: MapViewProps) {
  return (
    <Suspense fallback={null}>
      <MapView {...props} />
    </Suspense>
  );
}
