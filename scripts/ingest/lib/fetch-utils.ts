// Some council sites behind a Cloudflare challenge hang indefinitely rather
// than responding with an error, which would otherwise stall the whole
// pipeline (Node's fetch has no default timeout). Every request gets a hard
// deadline unless the caller supplies its own signal.
const DEFAULT_TIMEOUT_MS = 15000;

function withDefaultTimeout(init?: RequestInit): RequestInit {
  if (init?.signal) return init;
  return { ...init, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) };
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, withDefaultTimeout(init));
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, withDefaultTimeout(init));
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries a fetch with exponential backoff. Used for rate-limited public APIs. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 3, baseDelayMs = 500 }: { retries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
      }
    }
  }
  throw lastErr;
}

export function logStep(name: string, msg: string) {
  console.log(`[${name}] ${msg}`);
}
