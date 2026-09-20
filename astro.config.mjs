// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // The Statistics pages used to live at .../property/. (The Cloudflare worker also 301s these, keeping ?highlight=.)
  redirects: {
    '/[city]/property': '/[city]/statistics',
    '/[city]/[borough]/[outcode]/property': '/[city]/[borough]/[outcode]/statistics',
  },
  vite: {
    plugins: [tailwindcss()]
  }
});