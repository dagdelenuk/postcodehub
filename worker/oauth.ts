/**
 * GitHub OAuth proxy for the Decap CMS admin at /admin. Decap's github
 * backend can't complete the OAuth code exchange purely client-side (GitHub
 * requires the client secret server-side), so this implements the two routes
 * Decap expects: /auth kicks off the GitHub authorize redirect, /callback
 * exchanges the code for a token and hands it back to the Decap popup via
 * postMessage. Adapted from the well-known open-source reference
 * https://github.com/sterlingwes/decap-proxy (read and verified before
 * writing this) rather than guessing the handshake protocol.
 */

export interface OAuthEnv {
  GITHUB_OAUTH_ID: string;
  GITHUB_OAUTH_SECRET: string;
}

function randomState(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function handleAuth(url: URL, env: OAuthEnv): Response {
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", env.GITHUB_OAUTH_ID);
  authorizeUrl.searchParams.set("redirect_uri", `https://${url.hostname}/callback?provider=github`);
  // This repo is public, so public_repo is sufficient (no access to private repos requested).
  authorizeUrl.searchParams.set("scope", "public_repo,user");
  authorizeUrl.searchParams.set("state", randomState());
  return Response.redirect(authorizeUrl.toString(), 302);
}

function callbackPage(status: "success" | "error", payload: Record<string, string>): Response {
  const message = `authorization:github:${status}:${JSON.stringify(payload)}`;
  return new Response(
    `<!doctype html>
<html>
<body>
<p>Authorizing Decap&hellip;</p>
<script>
  (function () {
    function receiveMessage(e) {
      window.opener.postMessage(${JSON.stringify(message)}, "*");
      window.removeEventListener("message", receiveMessage, false);
    }
    window.addEventListener("message", receiveMessage, false);
    window.opener.postMessage("authorizing:github", "*");
  })();
</script>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function handleCallback(url: URL, env: OAuthEnv): Promise<Response> {
  const code = url.searchParams.get("code");
  if (!code) return new Response("Missing code", { status: 400 });

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_ID,
      client_secret: env.GITHUB_OAUTH_SECRET,
      code,
      redirect_uri: `https://${url.hostname}/callback?provider=github`,
    }),
  });

  if (!tokenRes.ok) {
    return callbackPage("error", { message: `GitHub token exchange failed: ${tokenRes.status}` });
  }

  const data = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    return callbackPage("error", { message: data.error ?? "No access_token in GitHub response" });
  }

  return callbackPage("success", { token: data.access_token });
}
