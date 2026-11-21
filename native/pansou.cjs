const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { PublicError } = require('./core.cjs');

const TYPES = { quark: 'quark', baidu: 'baiduPan' };
const DOMAINS = { quark: 'pan.quark.cn', baidu: 'pan.baidu.com' };
function address(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new PublicError('PanSou 地址无效');
  let url; try { url = new URL(value.trim()); } catch { throw new PublicError('请输入完整的 PanSou 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new PublicError('PanSou 地址只支持 HTTP(S) 服务地址，不能包含路径或凭据');
  return url.origin;
}
function share(type, input, password = '') {
  if (!DOMAINS[type] || typeof input !== 'string' || input.length > 2048) return null;
  let url; try { url = new URL(input); } catch { return null; }
  const pattern = type === 'quark' ? /^\/s\/[A-Za-z0-9]{1,128}\/?$/ : /^\/s\/1[A-Za-z0-9_-]{1,127}\/?$/;
  if (url.protocol !== 'https:' || url.hostname !== DOMAINS[type] || url.username || url.password || url.port || !pattern.test(url.pathname)) return null;
  const code = String(password || url.searchParams.get('pwd') || url.searchParams.get('password') || '').trim();
  if (code && !/^[A-Za-z0-9]{4}$/.test(code)) return null;
  const clean = new URL('https://' + DOMAINS[type] + url.pathname.replace(/\/$/, ''));
  if (code) clean.searchParams.set('pwd', code);
  return { url: clean.href, password: code };
}
function escapeHtml(value) {
  return String(value || '').slice(0, 1500).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]).replace(/\r?\n/g, '<br>');
}
function convertResults(payload) {
  if (!payload || (typeof payload.code === 'number' && payload.code !== 0)) throw new PublicError('PanSou 搜索失败，请检查服务', 502);
  const result = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  if (!Array.isArray(result.results)) {
    if (result.total === 0) return [];
    throw new PublicError('PanSou 返回格式无法识别，请检查服务版本', 502);
  }
  const seen = new Set(), list = [];
  for (const row of result.results.slice(0, 500)) {
    // Search providers sometimes mix ebook entries into film results. Filter
    // explicit text formats and book labels, without excluding film adaptations.
    const title = String(row?.title || '');
    if (/(?:\.(?:txt|epub|mobi|azw3?|pdf|docx?)(?:\b|$)|电子书|有声小说|网络小说|小说(?:全集|合集|全套|下载|原著)|原著小说|[【\[（(]小说[】\]）)])/i.test(title)) continue;
    const links = [];
    for (const item of Array.isArray(row?.links) ? row.links.slice(0, 20) : []) {
      const type = item?.type, parsed = share(type, item?.url, item?.password);
      if (!parsed || seen.has(type + ':' + parsed.url)) continue;
      seen.add(type + ':' + parsed.url); links.push({ link: parsed.url, cloudType: TYPES[type] });
    }
    if (!links.length) continue;
    const id = crypto.createHash('sha256').update(links.map(x => x.link).join('|')).digest('hex').slice(0, 24);
    list.push({ id, messageId: id, channelId: 'clouddock-pansou', title: String(row.title || '网盘资源').slice(0, 300), content: escapeHtml(row.content || row.title || ''), cloudLinks: links, supportSaveLinks: links, isSupportSave: true, channel: 'PanSou', pubDate: typeof row.datetime === 'string' ? row.datetime.slice(0, 40) : '', tags: [], isLastMessage: true });
  }
  return list.length ? [{ id: 'clouddock-pansou', channelInfo: { channelId: 'clouddock-pansou', name: 'PanSou', channelLogo: '' }, displayList: true, list }] : [];
}
class PanSou {
  constructor(axios, options = {}) {
    this.axios = axios; this.file = options.file || process.env.PANSOU_CONFIG_PATH || '/app/config/pansou.json';
    this.initial = { enabled: Boolean(process.env.PANSOU_URL), url: process.env.PANSOU_URL || '', token: process.env.PANSOU_TOKEN || '' };
  }
  async config() {
    try {
      const config = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (typeof config.enabled !== 'boolean' || typeof config.url !== 'string' || typeof config.token !== 'string') throw new Error('invalid config');
      return config;
    } catch (error) { if (error.code === 'ENOENT') return this.initial; throw new PublicError('无法读取 PanSou 配置', 500); }
  }
  async publicConfig() { const config = await this.config(); return { enabled: config.enabled, url: config.url, hasToken: Boolean(config.token) }; }
  async save(body) {
    if (!body || typeof body.enabled !== 'boolean' || typeof body.url !== 'string' || (body.token !== undefined && typeof body.token !== 'string') || (body.clearToken !== undefined && typeof body.clearToken !== 'boolean')) throw new PublicError('PanSou 配置无效');
    const previous = await this.config(), token = body.clearToken ? '' : body.token ? body.token.trim() : previous.token;
    if (token.length > 4096 || /[\r\n]/.test(token)) throw new PublicError('PanSou 令牌无效');
    const url = body.url.trim() ? address(body.url) : '';
    if (body.enabled && !url) throw new PublicError('启用 PanSou 时请填写服务地址');
    const next = { enabled: body.enabled, url, token };
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = this.file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try { await fs.writeFile(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); await fs.rename(temp, this.file); }
    finally { await fs.unlink(temp).catch(() => {}); }
    return { enabled: next.enabled, url: next.url, hasToken: Boolean(next.token) };
  }
  async post(endpoint, body, timeout = 20000) {
    const config = await this.config();
    if (!config.enabled || !config.url) throw new PublicError('请在设置中启用并配置 PanSou', 503);
    const base = address(config.url);
    try {
      const response = await this.axios.post(base + endpoint, body, { timeout, proxy: false, maxRedirects: 0, maxContentLength: 2 * 1024 * 1024, headers: config.token ? { Authorization: 'Bearer ' + config.token } : {} });
      return response.data;
    } catch (error) {
      if (error.response?.status === 401 || error.response?.status === 403) throw new PublicError('PanSou 认证失败，请检查令牌', 502);
      throw new PublicError('PanSou 连接失败或响应超时，请检查服务', 503);
    }
  }
  async health() {
    const config = await this.config();
    if (!config.enabled || !config.url) return { connected: false, message: '未启用 PanSou' };
    try {
      const result = await this.axios.get(address(config.url) + '/api/health', { timeout: 5000, proxy: false, maxRedirects: 0, maxContentLength: 65536 });
      return { connected: result.data?.status === 'ok', message: result.data?.status === 'ok' ? 'PanSou 服务已连接' : 'PanSou 状态异常' };
    } catch { return { connected: false, message: '无法连接 PanSou，请检查服务地址及运行状态' }; }
  }
  async search(keyword) {
    if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 200) throw new PublicError('请输入不超过 200 字的搜索关键词');
    return convertResults(await this.post('/api/search', { kw: keyword.trim(), src: 'plugin', res: 'results', cloud_types: ['baidu', 'quark'] }, 30000));
  }
  async check(items) {
    if (!Array.isArray(items) || !items.length || items.length > 20) throw new PublicError('一次可检测 1 至 20 条链接');
    const clean = items.map(item => {
      const type = item?.type === 'baiduPan' ? 'baidu' : item?.type;
      const parsed = share(type, item?.url, item?.password);
      if (!parsed) throw new PublicError('分享链接格式无效');
      return { disk_type: type, url: parsed.url, password: parsed.password };
    });
    const result = await this.post('/api/check/links', { items: clean }, 20000);
    if (!result || !Array.isArray(result.results)) throw new PublicError('PanSou 检测结果无法识别', 502);
    const byUrl = new Map(result.results.filter(row => typeof row?.url === 'string').map(row => [row.url, row.state]));
    return clean.map(item => ({ url: item.url, state: ['ok','bad','locked','unsupported','uncertain'].includes(byUrl.get(item.url)) ? byUrl.get(item.url) : 'uncertain' }));
  }
}
module.exports = { PanSou, address, share, convertResults };
