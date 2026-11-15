import { nearbyCode, parseInput } from '../lib/share.mjs';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  main() {
    let configured = false;
    const refresh = () => browser.storage.local.get(['base', 'enabled']).then(value => { configured = Boolean(value.base) && value.enabled !== false && value.base !== location.origin; });
    void refresh();
    browser.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.base || changes.enabled)) void refresh(); });
    document.addEventListener('click', (event) => {
      if (!configured || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !event.isTrusted) return;
      const anchor = event.composedPath().find(node => node instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
      if (!anchor || anchor.hasAttribute('download') || anchor.dataset.clouddockFallback === 'true') return;
      let link;
      try {
        link = parseInput(anchor.href);
        if (!link.code) link = parseInput(anchor.href, nearbyCode(anchor));
      } catch { return; }
      event.preventDefault();
      event.stopImmediatePropagation();
      browser.runtime.sendMessage({ type: 'open-transfer', link: { url: link.url, code: link.code } }).then((result) => {
        if (!result?.ok) showFailure(link.url);
      }).catch(() => showFailure(link.url));
    }, true);
  },
});

function showFailure(url: string) {
  const notice = document.createElement('div');
  notice.setAttribute('role', 'alert');
  notice.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;padding:14px;background:#20242d;color:white;border-radius:8px;font:14px sans-serif';
  notice.append('CloudDock 打开失败。');
  const link = document.createElement('a');
  link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '打开原链接'; link.style.cssText = 'color:#a8d1ff;margin-left:8px'; link.dataset.clouddockFallback = 'true';
  // Mark the fallback so it is not captured again.
  link.addEventListener('click', event => event.stopPropagation());
  notice.append(link); document.body.append(notice);
  setTimeout(() => notice.remove(), 15000);
}
