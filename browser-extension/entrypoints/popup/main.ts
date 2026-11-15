import './style.css';
import { normalizeBase, parseInput } from '../../lib/share.mjs';

const form = document.querySelector<HTMLFormElement>('#settings')!;
const base = document.querySelector<HTMLInputElement>('#base')!;
const enabled = document.querySelector<HTMLInputElement>('#enabled')!;
const status = document.querySelector<HTMLElement>('#status')!;
const last = document.querySelector<HTMLAnchorElement>('#last')!;
const value = await browser.storage.local.get(['base', 'enabled', 'lastLink', 'message']);
base.value = typeof value.base === 'string' ? value.base : '';
enabled.checked = value.enabled !== false;
if (typeof value.message === 'string') { status.textContent = value.message; await browser.storage.local.remove('message'); }
try { if (value.lastLink) { last.href = parseInput(value.lastLink).url; last.hidden = false; } } catch { /* Ignore invalid stored input. */ }
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const normalized = normalizeBase(base.value);
    await browser.storage.local.set({ base: normalized, enabled: enabled.checked });
    base.value = normalized; status.textContent = '设置已保存';
  } catch { status.textContent = '地址无效，请填写完整的 http 或 https 地址和端口。'; }
});
