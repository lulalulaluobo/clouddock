const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { PanSou, address, share, convertResults } = require('../native/pansou.cjs');

test('PanSou 地址与链接严格验证，保留提取码并转义描述', () => {
  assert.equal(address('http://pansou:8888/'), 'http://pansou:8888');
  for (const value of ['file:///etc/passwd', 'http://a@host/', 'http://host/path', 'http://host/?token=x']) assert.throws(() => address(value));
  assert.equal(share('baidu', 'https://pan.baidu.com/s/1abc?pwd=Ab12').password, 'Ab12');
  for (const input of ['http://pan.quark.cn/s/abc', 'https://pan.quark.cn.evil/s/abc', 'https://u@pan.quark.cn/s/abc', 'https://pan.quark.cn/s/../abc']) assert.equal(share('quark', input), null);
  const groups = convertResults({ results: [
    { title: '测试', content: '<img src=x onerror=alert(1)>', links: [{ type: 'baidu', url: 'https://pan.baidu.com/s/1abc', password: 'A123' }, { type: 'quark', url: 'https://pan.quark.cn/s/abc' }] },
    { title: '重复', links: [{ type: 'quark', url: 'https://pan.quark.cn/s/abc' }] },
    { title: '伪造', links: [{ type: 'quark', url: 'https://pan.quark.cn.evil/s/abc' }] },
  ] });
  assert.equal(groups.length, 1); assert.equal(groups[0].list.length, 1);
  assert.deepEqual(groups[0].list[0].cloudLinks.map(x => x.cloudType), ['baiduPan','quark']);
  assert.equal(groups[0].list[0].cloudLinks[0].link, 'https://pan.baidu.com/s/1abc?pwd=A123');
  assert.ok(groups[0].list[0].content.includes('&lt;img')); assert.ok(!groups[0].list[0].content.includes('<img'));
  assert.deepEqual(convertResults({code:0,data:{total:0}}), []);
  assert.equal(convertResults({code:0,data:{total:1,results:[{title:'测试',links:[{type:'quark',url:'https://pan.quark.cn/s/abc'}]}]}})[0].list.length,1);
  assert.throws(() => convertResults({code:0,data:{total:1}}));
});

test('PanSou 过滤明显的小说文本，只保留夸克和百度网盘影视链接', () => {
  const quark = url => ({ type: 'quark', url: `https://pan.quark.cn/s/${url}` });
  const groups = convertResults({ results: [
    { title: '三体小说全集', links: [quark('book')] },
    { title: '三体作者刘慈欣.txt「合集」', links: [quark('text')] },
    { title: '三体.epub', links: [quark('ebook')] },
    { title: '三体（根据小说改编）电视剧', links: [quark('film'), { type: 'aliyun', url: 'https://www.aliyundrive.com/s/example' }] },
    { title: '三体全集', links: [{ type: 'magnet', url: 'magnet:?xt=example' }] },
  ] });
  assert.equal(groups[0].list.length, 1);
  assert.match(groups[0].list[0].title, /电视剧/);
  assert.deepEqual(groups[0].list[0].cloudLinks.map(link => link.cloudType), ['quark']);
});

test('PanSou 配置持久化、令牌不返回前端，搜索和检测正确映射', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clouddock-pansou-'));
  try {
    const calls = [], axios = {
      post: async (url, body, options) => {
        calls.push({ url, body, options });
        if (url.endsWith('/api/search')) return { data: { results: [{ title: '测试资源', links: [{ type: 'quark', url: 'https://pan.quark.cn/s/abc', password: '1234' }] }] } };
        return { data: { results: [...body.items].reverse().map(item => ({ url: item.url, state: item.disk_type === 'quark' ? 'locked' : 'ok' })) } };
      },
      get: async () => ({ data: { status: 'ok' } }),
    };
    const file = path.join(dir, 'config.json'), pan = new PanSou(axios, { file }); pan.initial = { enabled: false, url: '', token: '' };
    await assert.rejects(pan.search('资源'), /启用并配置/);
    assert.deepEqual(await pan.save({ enabled: true, url: 'http://pansou:8888', token: 'secret-token' }), { enabled: true, url: 'http://pansou:8888', hasToken: true });
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.equal((await pan.health()).connected, true);
    const results = await pan.search(' 影片 ');
    assert.equal(results[0].list[0].cloudLinks[0].link, 'https://pan.quark.cn/s/abc?pwd=1234');
    assert.equal(calls[0].body.src, 'plugin'); assert.equal(calls[0].body.kw, '影片');
    assert.equal(calls[0].options.maxRedirects, 0); assert.equal(calls[0].options.proxy, false);
    const checked = await pan.check([{ type: 'quark', url: 'https://pan.quark.cn/s/abc', password: '1234' }, { type: 'baiduPan', url: 'https://pan.baidu.com/s/1abc' }]);
    assert.deepEqual(checked.map(row => row.state), ['locked', 'ok']);
    await assert.rejects(pan.check([{ type: 'quark', url: 'https://evil.test/s/a' }]), /无效/);
    await pan.save({ enabled: false, url: 'http://pansou:8888', token: '' });
    assert.equal((await pan.publicConfig()).hasToken, true);
    await pan.save({ enabled: false, url: 'http://pansou:8888', clearToken: true });
    assert.equal((await pan.publicConfig()).hasToken, false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('选择来源时保留原频道搜索与渐进结果，并隔离 PanSou 故障', async () => {
  const { createPanSouSearchAdapter } = await import('../web/pansou-search.mjs');
  const calls = [], original = {
    search: async (...args) => { calls.push(args); return { code: 0, data: ['original'] }; },
    searchChannels: async () => ({ code: 0, data: { mode: 'progressive', batchSize: 2, channels: [{ id:'channel-1', name:'频道', index:0 }] } }),
  };
  let mode = 'channels'; const adapter = createPanSouSearchAdapter(original, () => ({ searchSource: () => mode, searchPanSou: async () => ['pansou'] }));
  assert.equal((await adapter.searchChannels('test')).data.channels.length, 1);
  mode = 'all'; let data = (await adapter.searchChannels('test')).data;
  assert.equal(data.channels.length, 2); assert.equal(data.channels[1].id, 'channel-1');
  assert.deepEqual((await adapter.search('test', data.channels[0].id)).data, ['pansou']);
  mode = 'pansou'; assert.equal((await adapter.searchChannels('test')).data.channels.length, 1);
  mode = 'all'; original.searchChannels = async () => { throw new Error('频道不可用'); };
  data = (await adapter.searchChannels('test')).data;
  await adapter.search('test', data.channels[1].id);
  assert.equal(calls[0][1], undefined);
});

test('搜索与检测要求登录，只有管理员能修改 PanSou 配置', async () => {
  const { createPanSouRouter } = require('../native/pansou-router.cjs');
  const handlers = {}, router = { use(fn) { handlers.auth=fn; }, get(p, fn) { handlers['GET '+p]=fn; }, post(p, fn) { handlers['POST '+p]=fn; } };
  createPanSouRouter({ Router: () => router }, { publicConfig: async()=>({}), save: async()=>({}), search: async()=>[], check: async()=>[] }, { findOne: async ({where}) => where.userId === 'admin' ? {role:1} : {role:0} });
  function response() { return { code:200, body:null, status(n) { this.code=n; return this; }, json(v) { this.body=v; return this; } }; }
  let res=response(), passed=false;
  await handlers.auth({},res,()=>{passed=true;}); assert.equal(res.code,401); assert.equal(passed,false);
  const req={user:{userId:'ordinary'},body:{}}; res=response();
  await handlers.auth(req,res,()=>{passed=true;}); assert.equal(passed,true);
  await handlers['POST /config'](req,res); assert.equal(res.code,403);
  res=response(); await handlers['POST /search'](req,res); assert.equal(res.code,200);
});

test('PanSou 异步结果延后刷新，失活后不再请求', async () => {
  const { schedulePanSouRefresh } = await import('../web/pansou-search.mjs');
  const timers=[]; let active=true, count=0;
  schedulePanSouRefresh(()=>{count++;},()=>active,(fn,delay)=>timers.push({fn,delay}));
  assert.deepEqual(timers.map(row=>row.delay),[10000,25000]);
  timers[0].fn(); assert.equal(count,1);
  active=false; timers[1].fn(); assert.equal(count,1);
});
