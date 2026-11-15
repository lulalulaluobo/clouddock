const test = require('node:test'), assert = require('node:assert/strict');
test('链接入口识别两种网盘、完整文案及独立提取码，拒绝伪造域名和多链接', async () => {
  const { parseShareLink } = await import('../web/share-link.mjs');
  assert.equal(parseShareLink('分享 https://pan.baidu.com/s/1Test_abc 提取码：aB12').url, 'https://pan.baidu.com/s/1Test_abc?pwd=aB12');
  assert.equal(parseShareLink('https://pan.quark.cn/s/abc123#/list/share', '1234').url, 'https://pan.quark.cn/s/abc123?pwd=1234');
  assert.equal(parseShareLink('https://pan.baidu.com/s/1Test?pwd=aaaa', 'bbbb').code, 'bbbb');
  assert.equal(parseShareLink('链接：https://pan.quark.cn/s/abc123。').provider, 'quark');
  for (const value of ['https://pan.baidu.com.evil.test/s/1abc', 'javascript:alert(1)', 'https://pan.baidu.com@evil.test/s/1abc', 'https://pan.quark.cn/s/aaa https://pan.baidu.com/s/1bbb', 'https://pan.baidu.com/s/1abc?pwd=123456']) assert.throws(() => parseShareLink(value));
});
test('发布页面替换品牌，旧宣传入口移除，新增路由复用原转存组件', () => {
  const fs = require('node:fs'), base = require('node:path').join(__dirname, '../build/web/');
  const index = fs.readFileSync(base + 'index.html','utf8'), imports = JSON.parse(index.match(/<script type="importmap">(.*?)<\/script>/s)[1]).imports;
  assert.ok(index.includes('<title>CloudDock</title>')); assert.ok(!index.includes('CloudSaver'));
  const main = fs.readFileSync(base + imports['/assets/main-qTjhG9aT.js'].slice(1), 'utf8');
  assert.equal(main.match(/path:"\/transfer"/g).length, 2); assert.ok(main.includes('createTransferPage(m.default)'));
  const desktop = fs.readFileSync(base + imports['/assets/Home-BqrH2t5L.js'].slice(1), 'utf8');
  assert.ok(!desktop.includes('title:"关于与支持"')); assert.ok(!desktop.includes('title:"鸣谢"')); assert.ok(!desktop.includes('href:l(Fe)')); assert.ok(desktop.includes('title:"链接转存"'));
  const mobile = fs.readFileSync(base + imports['/assets/Home-ajRj3t7p.js'].slice(1), 'utf8'); assert.ok(mobile.includes('to:"/transfer"'));
  const prompt = fs.readFileSync(base + imports['/assets/useReleaseSupportPrompt-DNHszSUM.js'].slice(1), 'utf8'); assert.ok(prompt.includes('openIfNeeded:async()=>{}'));
  const manifest = JSON.parse(fs.readFileSync(base + 'manifest.webmanifest')); assert.equal(manifest.name, 'CloudDock');
});
