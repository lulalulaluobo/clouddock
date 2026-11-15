const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');

test('插件地址及分享链接严格校验，并保留提取码', async () => {
  const { parseInput, normalizeBase, transferUrl } = await import('../browser-extension/lib/share.mjs');
  const link = parseInput('https://pan.baidu.com/s/1abc_def 提取码：aB12');
  assert.equal(link.code, 'aB12');
  assert.equal(normalizeBase('http://nas.local:7003/'), 'http://nas.local:7003');
  const target = new URL(transferUrl('http://nas.local:7003', link));
  assert.equal(target.pathname, '/transfer');
  assert.deepEqual(JSON.parse(new URLSearchParams(target.hash.slice(1)).get('clouddock')), { url: 'https://pan.baidu.com/s/1abc_def?pwd=aB12', code: 'aB12' });
  for (const input of ['http://pan.baidu.com/s/1abc', 'https://user@pan.baidu.com/s/1abc', 'https://pan.baidu.com.evil/s/1abc', 'https://pan.quark.cn/s/aaa https://pan.baidu.com/s/1bbb']) assert.throws(() => parseInput(input));
  for (const base of ['javascript:alert(1)', 'http://user@host:7003', 'http://host:7003/path', 'http://host/?x=y']) assert.throws(() => normalizeBase(base));
});

test('预填入口清除地址栏参数，只暂存合法分享及提取码', () => {
  const script = fs.readFileSync(require('node:path').join(__dirname, '../web/transfer-bootstrap.js'), 'utf8');
  function run(value) {
    const data = new Map([['clouddock_pending_transfer', 'old']]); let clean = '';
    const fragment = new URLSearchParams({ clouddock: JSON.stringify(value) });
    const context = { URL, URLSearchParams, Date, JSON, location: { pathname: '/transfer', search: '', hash: '#' + fragment }, history: { state: null, replaceState: (_a, _b, path) => { clean = path; } }, sessionStorage: { setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) } };
    vm.runInNewContext(script, context);
    return { clean, pending: data.get('clouddock_pending_transfer') };
  }
  const good = run({ url: 'https://pan.quark.cn/s/abc123', code: 'a123' });
  assert.equal(good.clean, '/transfer'); assert.equal(JSON.parse(good.pending).code, 'a123');
  for (const input of [{ url: 'https://pan.quark.cn.evil/s/abc', code: '' }, { url: 'https://pan.quark.cn/s/abc', code: 'bad!!' }, { url: 'http://pan.baidu.com/s/1abc', code: '' }]) assert.equal(run(input).pending, undefined);
});

test('多个链接或多个候选提取码时不猜测', async () => {
  const { nearbyCode } = await import('../browser-extension/lib/share.mjs');
  const a = { href: 'https://pan.quark.cn/s/abc' };
  const b = { href: 'https://pan.baidu.com/s/1xyz' };
  function anchor(text, links) { return { parentElement: { textContent: text, querySelectorAll: () => links, parentElement: null } }; }
  assert.equal(nearbyCode(anchor('资源 提取码：aB12', [a])), 'aB12');
  assert.equal(nearbyCode(anchor('资源 提取码：aB12 提取码：cd34', [a])), '');
  assert.equal(nearbyCode(anchor('资源 提取码：aB12', [a, b])), '');
});
