// Validation-only preload. Production code never imports this guard.
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url || String(input));
  if (url.hostname === 'v3.football.api-sports.io' || /(^|\.)allsportsapi\.com$/.test(url.hostname)) {
    throw new Error('PROVIDER_HTTP_FORBIDDEN_DURING_VALIDATION');
  }
  return nativeFetch(input, init);
};
