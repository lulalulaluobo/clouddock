import { normalizeBase, parseInput, transferUrl } from '../lib/share.mjs';

type Transfer = { url: string; code: string };

async function openTransfer(input: string, code = '') {
  const link = parseInput(input, code);
  const settings = await browser.storage.local.get(['base', 'enabled']);
  if (!settings.base) throw new Error('请先在插件中设置 CloudDock 地址');
  const target = transferUrl(normalizeBase(settings.base), link);
  await browser.storage.local.set({ lastLink: link.url });
  await browser.tabs.create({ url: target });
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.removeAll(() => {
      browser.contextMenus.create({ id: 'clouddock-link', title: '发送链接到 CloudDock', contexts: ['link'], targetUrlPatterns: ['https://pan.quark.cn/*', 'https://pan.baidu.com/*'] });
      browser.contextMenus.create({ id: 'clouddock-selection', title: '将选中内容发送到 CloudDock', contexts: ['selection'] });
    });
  });
  browser.contextMenus.onClicked.addListener(async (info) => {
    try { await openTransfer(info.menuItemId === 'clouddock-link' ? info.linkUrl || '' : info.selectionText || ''); }
    catch { await browser.storage.local.set({ message: '发送失败：请检查 CloudDock 地址和选中的分享链接。' }); await browser.tabs.create({ url: browser.runtime.getURL('/popup.html') }); }
  });
  browser.runtime.onMessage.addListener((message: { type?: string; link?: Transfer }, sender) => {
    if (message.type !== 'open-transfer' || !sender.tab || !message.link || typeof message.link.url !== 'string' || typeof message.link.code !== 'string') return;
    return openTransfer(message.link.url, message.link.code).then(() => ({ ok: true }), () => ({ ok: false }));
  });
});
