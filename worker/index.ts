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

    // Everything else is the static Astro site (dist/), including /admin.
    return env.ASSETS.fetch(request);
  },
};
