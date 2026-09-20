import { handleAuth, handleCallback, type OAuthEnv } from "./oauth";

interface Env extends OAuthEnv {
  ASSETS: Fetcher;
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
