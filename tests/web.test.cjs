const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const root = path.resolve(__dirname, ".."), source = path.join(root, "upstream/nas-v0.8.3/html"), output = path.join(root, "build/web");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "build/manifest.json"), "utf8"));
test("原桌面/手机资源、设置和频道管理分发文件逐字节保留", () => {
  const files = fs.readdirSync(path.join(source, "assets")).filter(name => /^(ResourceList|Setting|Home|resource-)/.test(name));
  assert.ok(files.length > 8);
  for (const file of files) assert.deepEqual(fs.readFileSync(path.join(output, "assets", file)), fs.readFileSync(path.join(source, "assets", file)), file);
});
test("共用转存流程仅在夸克勾选本地下载时提交一次；关闭时保留原 saveResource", () => {
  const flow = fs.readFileSync(path.join(output, manifest.entrypoints.flow), "utf8");
  assert.equal(flow.split("CloudDock.submit(").length - 1, 1); assert.ok(flow.includes("e.saveResource(r.value,c.value)")); assert.ok(flow.includes('e.currentCloudLink?.cloudType==="quark"&&globalThis.CloudDock?.enabled()'));
  assert.equal(cp.spawnSync(process.execPath, ["--input-type=module", "--check"], { input: flow }).status, 0);
});
test("扩展入口和缓存修订齐全，保留原转存入口", () => {
  const index = fs.readFileSync(path.join(output, "index.html"), "utf8"), worker = fs.readFileSync(path.join(output, "sw.js"), "utf8");
  for (const file of Object.values(manifest.entrypoints)) { assert.ok(index.includes(file)); assert.ok(worker.includes(file)); }
  assert.ok(index.indexOf('type="importmap"') < index.indexOf('type="module"'));
  const client = fs.readFileSync(path.join(output, manifest.entrypoints.client), "utf8");
  assert.ok(!client.includes("location.href = '/downloads'")); assert.ok(client.includes('selectedIds: [...ids]')); assert.ok(client.includes("renameDraftMap"));
  assert.equal(cp.spawnSync(process.execPath, ["--check", path.join(output, manifest.entrypoints.client)]).status, 0);
});
test("下载进度整合实际 AriaNg，返回搜索和转存记录入口均可达", () => {
  const page = fs.readFileSync(path.join(output, manifest.progress.page), "utf8"), script = fs.readFileSync(path.join(output, manifest.progress["progress.js"]), "utf8");
  const bridge = fs.readFileSync(path.join(output, manifest.progress["ariang-bridge.js"]), "utf8"), aria = fs.readFileSync(path.join(output, "clouddock/ariang/index.html"), "utf8");
  assert.ok(page.includes('href="/"')); assert.ok(page.includes("返回搜索")); assert.ok(page.includes('title="AriaNg 下载管理"')); assert.ok(page.includes("转存记录"));
  assert.ok(script.includes("./ariang/#!/downloading")); assert.ok(script.includes("window.CloudDock.showRecords()"));
  assert.ok(bridge.includes('"/api/clouddock/rpc"')); assert.ok(bridge.includes('storage.setPrefix("CloudDock.AriaNg")')); assert.ok(!bridge.includes("ARIA2_RPC_SECRET"));
  assert.ok(aria.includes(manifest.progress["ariang-bridge.js"]));
  assert.ok(aria.includes('href="/" target="_top"'));
  assert.ok(fs.existsSync(path.join(output, "clouddock/ariang/LICENSE")));
  for (const name of ["progress.js", "ariang-bridge.js"]) assert.equal(cp.spawnSync(process.execPath, ["--check", path.join(output, manifest.progress[name])]).status, 0);
});
test("手机性能补丁使用同一主模块、可见性监听和原版无观察器回退", () => {
  const index=fs.readFileSync(path.join(output,'index.html'),'utf8');
  assert.ok(index.includes('src="/'+manifest.entrypoints.main+'"'));
  const map=JSON.parse(index.match(/<script type="importmap">(.*?)<\/script>/s)[1]).imports;
  assert.equal(map['/assets/main-qTjhG9aT.js'],'/'+manifest.entrypoints.main);
  assert.equal(map['/assets/ResourceList-p18e8BOQ.js'],'/'+manifest.entrypoints.mobile);
  const mobile=fs.readFileSync(path.join(output,manifest.entrypoints.mobile),'utf8');
  assert.ok(mobile.includes('R=observeResources(u.value,N,et)'));assert.ok(mobile.includes('R?.disconnect()'));
  assert.ok(!mobile.includes('v.addEventListener("scroll",N)'));
  const main=fs.readFileSync(path.join(output,manifest.entrypoints.main),'utf8');
  assert.ok(main.includes('rootMargin:"800px 0px"'));assert.ok(main.includes('if(this.mode===wo.observer)return;'));
  assert.ok(main.includes('!Vp&&t===wo.observer&&(t=wo.event)'));
  for(const key of ['main','mobile'])assert.equal(cp.spawnSync(process.execPath,['--input-type=module','--check'],{input:fs.readFileSync(path.join(output,manifest.entrypoints[key]))}).status,0);
});
test("百度驱动复用原资源、目录和提交组件，缓存及两端新建入口完整", () => {
  const read = key => fs.readFileSync(path.join(output, manifest.entrypoints[key]), 'utf8');
  assert.ok(read('resource').includes('type:"baiduPan",regex:/pan\\.baidu'));
  assert.ok(read('flow').includes('e.currentCloudLink?.cloudType==="baiduPan"||'));
  for (const key of ['resource', 'desktop', 'mobile']) {
    assert.equal(cp.spawnSync(process.execPath, ['--input-type=module', '--check'], { input: read(key) }).status, 0);
    if (key !== 'resource') { assert.ok(read(key).includes('baiduPan:globalThis.CloudDock.baiduApi')); assert.ok(!read(key).includes('当前仅支持夸克网盘新建文件夹')); }
  }
  assert.ok(read('client').includes('selected.map(row => String(row.fileIdToken))'));
  assert.ok(read('client').includes('download: state.enabled'));
  assert.ok(read('client').includes('/baidu/authorize'));
  assert.ok(!read('client').includes('/baidu/pair'));
});
