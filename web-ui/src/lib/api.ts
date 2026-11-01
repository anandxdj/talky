/**
 * Control-server auth for the browser.
 *
 * Every `/api/*` request needs the `X-Talky-Token` header (see `src/web/auth.ts`). The panel
 * bootstraps the token from `GET /api/auth/session` — the server only answers that for
 * same-origin / local requests — and this module wraps `window.fetch` so every existing
 * `fetch('/api/…')` call site gets the header without changes. A 401 refreshes the token
 * once (the server rotates it when `data/control-token` is deleted) and retries.
 */

const TOKEN_HEADER = 'X-Talky-Token'
const SESSION_PATH = '/api/auth/session'

let token: string | null = null
let tokenPromise: Promise<string | null> | null = null
let installed = false

function isApiRequest(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin)
    return (
      parsed.origin === window.location.origin &&
      parsed.pathname.startsWith('/api/') &&
      parsed.pathname !== SESSION_PATH
    )
  } catch {
    return false
  }
}

async function loadToken(nativeFetch: typeof fetch, force = false): Promise<string | null> {
  if (token && !force) return token
  if (!tokenPromise || force) {
    tokenPromise = nativeFetch(SESSION_PATH, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return null
        const body = (await res.json()) as { token?: string }
        token = typeof body.token === 'string' ? body.token : null
        return token
      })
      .catch(() => null)
      .finally(() => {
        tokenPromise = null
      })
  }
  return tokenPromise
}

export function installApiAuth(): void {
  if (installed) return
  installed = true
  const nativeFetch = window.fetch.bind(window)

  const withToken = (input: RequestInfo | URL, init: RequestInit | undefined, value: string | null) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (value) headers.set(TOKEN_HEADER, value)
    return nativeFetch(input, { ...init, headers })
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!isApiRequest(url)) return nativeFetch(input, init)
    const first = await withToken(input, init, await loadToken(nativeFetch))
    if (first.status !== 401) return first
    const refreshed = await loadToken(nativeFetch, true)
    return refreshed ? withToken(input, init, refreshed) : first
  }
}

/** JSON helper for new code: throws with the server's `error` message on non-2xx. */
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* non-JSON (e.g. proxy error page) */
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `HTTP ${res.status}`
    throw new Error(message)
  }
  return body as T
}
