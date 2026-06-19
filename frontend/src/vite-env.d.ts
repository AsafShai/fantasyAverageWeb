/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_SHOW_PLAYER_RANKINGS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
