import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// MapLibre resolves its worker relative to its own module URL. Vite's dependency
// pre-bundling (dev) and hashing (build) both move that module, so the default
// lookup 404s; hand it the asset URL Vite actually serves.
setWorkerUrl(workerUrl);
