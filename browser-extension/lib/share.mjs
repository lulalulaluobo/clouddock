import { parseShareLink } from '../../web/share-link.mjs';

export function parseInput(input, code = '') {
  if (typeof input !== 'string' || input.length > 8192) throw new Error('链接内容过长');
  const match = input.match(/https?:\/\/[^\s<>"“”]+/i);
  if (!match) throw new Error('未找到分享链接');
  const original = new URL(match[0].replace(/[，。；、）)]+$/, ''));
  if (original.protocol !== 'https:' || original.username || original.password || original.port) throw new Error('链接格式不受支持');
  return parseShareLink(input, code);
}

export function normalizeBase(input) {
  const url = new URL(String(input).trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('请输入 CloudDock 的完整地址，例如 http://nas地址:7003');
  }
  return url.origin;
}

export function transferUrl(base, link) {
  const parsed = parseInput(link.url, link.code);
  const url = new URL('/transfer', normalizeBase(base));
  url.hash = new URLSearchParams({ clouddock: JSON.stringify({ url: parsed.url, code: parsed.code }) }).toString();
  return url.href;
}

// Never associate a code with a different link in a multi-link block.
export function nearbyCode(anchor) {
  for (let box = anchor.parentElement, depth = 0; box && depth < 3; box = box.parentElement, depth++) {
    const content = box.textContent || '';
    if (content.length > 1200) break;
    const hrefs = [...box.querySelectorAll('a[href]')].map(a => { try { return parseInput(a.href).url.split('?')[0]; } catch { return ''; } }).filter(Boolean);
    const textLinks = [...content.matchAll(/https?:\/\/[^\s<>"“”]+/gi)].map(m => { try { return parseInput(m[0]).url.split('?')[0]; } catch { return ''; } }).filter(Boolean);
    if (new Set([...hrefs, ...textLinks]).size > 1) return '';
    const codes = [...content.matchAll(/(?:提取码|提取代码|访问码|密码)[：:\s]*([A-Za-z0-9]{4})(?![A-Za-z0-9])/g)].map(m => m[1]);
    const unique = [...new Set(codes)];
    if (unique.length === 1) return unique[0];
    if (unique.length > 1) return '';
  }
  return '';
}
