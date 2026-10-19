/// <reference types="vite/client" />

declare module "*.png" {
  const src: string;
  export default src;
}
declare module "*.jpg" {
  const src: string;
  export default src;
}
declare module "*.svg" {
  const src: string;
  export default src;
}

/** App version from package.json, injected at build time (electron.vite.config.ts). */
declare const __APP_VERSION__: string;
