// Capture a transfer before the SPA can redirect to the login page.
(() => {
  if (location.pathname !== '/transfer' || !location.hash.startsWith('#clouddock=')) return;
  const params = new URLSearchParams(location.hash.slice(1));
  const raw = params.get('clouddock') || '';
  history.replaceState(history.state, '', location.pathname + location.search);
  sessionStorage.removeItem('clouddock_pending_transfer');
  if (!raw || raw.length > 8192) return;
  try {
    const value = JSON.parse(raw);
    if (typeof value.url !== 'string' || value.url.length > 2048 || typeof value.code !== 'string' || value.code.length > 4) return;
    const url = new URL(value.url);
    const valid = url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'pan.quark.cn' && /^\/s\/[A-Za-z0-9]+\/?$/.test(url.pathname) ||
       url.hostname === 'pan.baidu.com' && /^\/s\/1[A-Za-z0-9_-]+\/?$/.test(url.pathname));
    if (!valid || (value.code && !/^[A-Za-z0-9]{4}$/.test(value.code))) return;
    sessionStorage.setItem('clouddock_pending_transfer', JSON.stringify({ url: url.href, code: value.code, createdAt: Date.now() }));
  } catch { /* Ignore malformed external input. */ }
})();
