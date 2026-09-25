// @ts-check
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// Dev-only: /images/geograph/<outcodeSlug>/<photoId>.webp is served by the Cloudflare Worker from R2 in production
// (worker/index.ts), which `astro dev` has no equivalent of. This serves the same photos from the local
// data/raw/geograph/ cache (scripts/ingest/fetch-district-images.ts's download cache) so they preview locally too.
function geographDevImages() {
  return {
    name: 'geograph-dev-images',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/images\/geograph\/([^/]+)\/([^/]+)\.webp/);
        if (!match) return next();
        const [, outcodeSlug, photoId] = match;
        try {
          const buf = await readFile(path.join(process.cwd(), 'data/raw/geograph', `${photoId}_${outcodeSlug}.webp`));
          res.setHeader('Content-Type', 'image/webp');
          res.end(buf);
        } catch {
          res.statusCode = 404;
          res.end('Not found locally - this photo only exists in R2 once fetch-district-images.ts has uploaded it.');
        }
      });
    },
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://postcodehub.uk',
  integrations: [
    sitemap({
      // Keep the CMS and the old /property/ redirect stubs out of the sitemap.
      filter: (page) => !page.includes('/admin') && !page.endsWith('/offline/') && !page.endsWith('/compare/') && !/\/property\/?$/.test(page),
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
    plugins: [tailwindcss(), geographDevImages()]
  }
});