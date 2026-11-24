const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * GET with a browser-ish User-Agent, a timeout and a couple of retries.
 * Several of our sources (Slobodna Dalmacija especially) reject the default
 * Node UA, so sending one is not optional.
 */
export async function getText(url, { timeout = 20000, retries = 2, accept, headers } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'user-agent': UA,
          'accept': accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'hr-HR,hr;q=0.9,en;q=0.6',
          ...headers,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`GET ${shortUrl(url)} failed: ${lastErr?.message || lastErr}`);
}

export async function getJson(url, opts = {}) {
  const txt = await getText(url, { accept: 'application/json,*/*', ...opts });
  return JSON.parse(stripBom(txt));
}

/** Drops the query string so the reason survives the status-line budget. */
function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return String(url);
  }
}

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
