// HTTP helper: User-Agent định danh rõ, timeout, thử lại, giãn cách giữa các request.
export const UA = 'GameJobAssistant/1.0 (personal, low-volume; contact: owner of this app)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getText(url, { retries = 2, timeout = 25000, delay = 0, headers = {} } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      if (delay) await sleep(delay);
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'vi,en;q=0.8', ...headers },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await sleep(800 * (i + 1));
    }
  }
  throw new Error(`${url}: ${lastErr?.message || lastErr}`);
}

export async function getJson(url, opts) {
  return JSON.parse(await getText(url, opts));
}

export { sleep };
