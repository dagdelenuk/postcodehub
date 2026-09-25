import { handleAuth, handleCallback, type OAuthEnv } from "./oauth";

interface Env extends OAuthEnv {
  ASSETS: Fetcher;
  PHOTOS: R2Bucket;
}

// Content-addressed by Geograph photo ID (scripts/ingest/fetch-district-images.ts never overwrites a key in place), so
// this is safe to cache hard - a changed selection just means a page starts linking to a different key, not this one
// changing under a viewer.
const PHOTO_CACHE_CONTROL = "public, max-age=31536000, immutable";

async function servePhoto(url: URL, photos: R2Bucket): Promise<Response> {
  const key = url.pathname.replace(/^\/images\//, "");
  const object = await photos.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", PHOTO_CACHE_CONTROL);
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/auth") {
      return handleAuth(url, env);
    }
    if (url.pathname === "/callback") {
      return handleCallback(url, env);
    }
    if (url.pathname.startsWith("/images/geograph/")) {
      return servePhoto(url, env.PHOTOS);
    }

    // The Statistics pages used to live at .../property/ - keep old links working with a
    // permanent redirect (query string kept, e.g. ?highlight=richmond-upon-thames).
    const legacyStatistics = url.pathname.match(/^(\/[^/]+(?:\/[^/]+\/[^/]+)?)\/property\/?$/);
    if (legacyStatistics) {
      return Response.redirect(`${url.origin}${legacyStatistics[1]}/statistics/${url.search}`, 301);
    }

    // Everything else is the static Astro site (dist/), including /admin.
    return env.ASSETS.fetch(request);
  },
};
