/// <reference types="vite/client" />
/// <reference types="geojson" />

interface ImportMetaEnv {
  /** Django API origin, without a trailing slash. Empty means same origin (the dev server proxies /api). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
