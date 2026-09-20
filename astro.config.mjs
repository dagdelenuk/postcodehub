// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://postcodehub.uk',
  integrations: [
    sitemap({
      // Keep the CMS and the old /property/ redirect stubs out of the sitemap.
      filter: (page) => !page.includes('/admin') && !page.endsWith('/offline/') && !/\/property\/?$/.test(page),
      changefreq: 'weekly',
      lastmod: new Date(),
    }),
  ],
  // The Statistics pages used to live at .../property/. (The Cloudflare worker also 301s these, keeping ?highlight=.)
  redirects: {
    '/[city]/property': '/[city]/statistics',
    '/[city]/[borough]/[outcode]/property': '/[city]/[borough]/[outcode]/statistics',
  },
  vite: {
    plugins: [tailwindcss()]
  }
});