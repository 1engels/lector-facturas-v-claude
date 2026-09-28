/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** RUC de la empresa compradora (ver .env). */
  readonly VITE_BUYER_RUC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
