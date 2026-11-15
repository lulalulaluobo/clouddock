export function parseShareLink(text, passcode = '') {
  const links = [...String(text).matchAll(/https?:\/\/[^\s<>"“”]+/gi)].map(match => match[0].replace(/[，。；、）)]+$/, ''));
  const supported = [];
  for (const link of links) {
    let url; try { url = new URL(link); } catch { continue; }
    const provider = url.hostname === 'pan.quark.cn' ? 'quark' : url.hostname === 'pan.baidu.com' ? 'baiduPan' : null;
    const id = url.pathname.match(provider === 'quark' ? /^\/s\/([A-Za-z0-9]+)\/?$/ : /^\/s\/(1[A-Za-z0-9_-]+)\/?$/)?.[1];
    if (provider && id) supported.push({ provider, id, url });
  }
  const unique = [...new Map(supported.map(value => [value.provider + value.id, value])).values()];
  if (unique.length > 1) throw new Error('一次请填写一个分享链接');
  if (!unique.length) throw new Error('请填写有效的夸克或百度网盘分享链接');
  const { provider, id, url } = unique[0];
  const code = String(passcode).trim() || url.searchParams.get('pwd') || url.searchParams.get('password') || String(text).match(/(?:提取码|提取代码|访问码|密码)[：:\s]*([A-Za-z0-9]{4})(?![A-Za-z0-9])/)?.[1] || '';
  if (code && !/^[A-Za-z0-9]{4}$/.test(code)) throw new Error('提取码应为 4 位字母或数字');
  const normalized = new URL('https://' + url.hostname + '/s/' + id); if (code) normalized.searchParams.set('pwd', code);
  return { provider, label: provider === 'quark' ? '夸克网盘' : '百度网盘', url: normalized.href, code };
}
