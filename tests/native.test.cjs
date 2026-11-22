const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const { createRequire } = require("node:module");
const runtimeRequire = createRequire(process.env.RUNTIME_PACKAGE || "/app/package.json");
const axios = runtimeRequire("axios"), { Sequelize, DataTypes, Op } = runtimeRequire("sequelize");
const { PublicError, parseRequest, relative, Directories, Aria, plan } = require("../native/core.cjs");
const { createService } = require("../native/service.cjs");
const { BaiduNative } = require("../native/baidu-native.cjs");
const { createRouter } = require("../native/router.cjs");
const { prepare, redact } = require("../native/aria-proxy.cjs");
const { initialize: initializeRuntime } = require("../native/init-runtime.cjs");
const input = { shareCode: "share123", parentId: "parent", folderId: "cloud", selectedIds: ["second"], intent: "intent-test-123", target: { rootId: "media", relativePath: "" }, title: "测试", renames: [] };
const file = (fid, name, directory = false) => ({ fid, name, directory, size: 123, token: "test-only" });
let temporary;
test.before(async () => { temporary = await fs.mkdtemp(path.join(os.tmpdir(), "clouddock-test-")); });
test.after(async () => { await fs.rm(temporary, { recursive: true, force: true }); });

test("空选择、重复选择、非法目录和跨选择重命名一律拒绝", () => {
  assert.deepEqual(parseRequest(input).selectedIds, ["second"]);
  for (const selectedIds of [[], ["second", "second"], ["../all"]]) assert.throws(() => parseRequest({ ...input, selectedIds }));
  assert.throws(() => parseRequest({ ...input, renames: [{ sourceFileId: "unselected", targetName: "new.mp4" }] }));
  for (const value of ["../outside", "/etc", "a/../b", "a\\b", "a\0b"]) assert.throws(() => relative(value));
});
test("只浏览允许目录，拒绝符号链接和文件内层逃逸", async () => {
  const root = path.join(temporary, "media"), outside = path.join(temporary, "outside");
  await fs.mkdir(path.join(root, "电视剧"), { recursive: true }); await fs.mkdir(outside); await fs.symlink(outside, path.join(root, "escape"));
  const paths = new Directories([{ id: "media", label: "飞牛影视", browse: root, aria: "/downloads" }]);
  assert.equal((await paths.resolve({ rootId: "media", relativePath: "电视剧" })).aria, "/downloads/电视剧");
  assert.deepEqual((await paths.children(input.target)).items.map(row => row.name), ["电视剧"]);
  await assert.rejects(paths.resolve({ rootId: "media", relativePath: "escape" }));
  await assert.rejects(paths.checkFile(root, "escape/one.mp4"));
  const created = await paths.create(input.target, "新建电视剧");
  assert.equal(created.relativePath, "新建电视剧");
  assert.equal((await fs.stat(path.join(root, created.relativePath))).uid, (await fs.stat(root)).uid);
  await assert.rejects(paths.create(input.target, "新建电视剧"), error => error.status === 409);
  await assert.rejects(paths.create(input.target, "../outside"));
  await assert.rejects(paths.create({ rootId: "media", relativePath: "escape" }, "blocked"));
});
function singleClient() {
  const calls = []; let saved = false;
  return { calls, token: async () => "token", share: async () => [file("first", "01.mp4"), file("second", "02.mp4"), file("third", "03.mp4")], own: async () => saved ? [file("saved", "02.mp4"), file("unrelated", "99.mp4")] : [], save: async items => { calls.push(items.map(row => row.fid)); saved = true; return "task-one"; }, wait: async () => ["saved"], rename: async () => {} };
}
test("三个分享文件只选一个：精确转存并排除目标额外文件及网盘前缀", async () => {
  const client = singleClient(), checkpoints = [];
  const files = await plan(client, input, async task => checkpoints.push(task), async () => {});
  assert.deepEqual(client.calls, [["second"]]); assert.deepEqual(checkpoints, ["task-one"]);
  assert.deepEqual(files, [{ fid: "saved", path: "02.mp4", size: 123 }]);
});
test("复用原重命名意图，文件夹递归只采用所选源内容", async () => {
  const renamed = [];
  const client = { token: async () => "token", share: async (_request, _token, parent) => parent === "parent" ? [file("season", "旧季名", true), file("other", "其他季", true)] : [file("episode", "01.mp4")], own: async parent => parent === "cloud" ? [file("saved-season", renamed[0]?.name || "旧季名", true)] : [file("saved-episode", "01.mp4"), file("extra", "99.mp4")], rename: async (fid, name) => renamed.push({ fid, name }) };
  const files = await plan(client, { ...input, selectedIds: ["season"], renames: [{ sourceFileId: "season", targetName: "第一季" }] }, async () => {}, async () => {});
  assert.deepEqual(renamed, [{ fid: "saved-season", name: "第一季" }]);
  assert.deepEqual(files, [{ fid: "saved-episode", path: "第一季/01.mp4", size: 123 }]);
});
test("失效选择和同名不同内容必须停止，不猜最近文件", async () => {
  const client = singleClient();
  await assert.rejects(plan(client, { ...input, selectedIds: ["missing"] }, async () => {}, async () => {}));
  client.own = async () => [{ ...file("saved", "02.mp4"), size: 999 }];
  await assert.rejects(plan(client, input, async () => {}, async () => {})); assert.equal(client.calls.length, 0);
});
test("aria2 HTTP 400 表示缺失 GID；稳定 GID 避免重复 addUri", async () => {
  const known = new Set(), additions = [];
  const server = http.createServer(async (req, res) => {
    let text = ""; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text); assert.equal(body.params[0], "token:test-secret");
    let result;
    if (body.method === "aria2.tellStatus") { if (!known.has(body.params[1])) { res.statusCode = 400; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: { message: "GID is not found" } })); return; } result = { gid: body.params[1], status: "waiting" }; }
    else { const options = body.params[2]; additions.push(options); known.add(options.gid); result = options.gid; }
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ result }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { const rpc = new Aria(axios, `http://127.0.0.1:${server.address().port}`, "test-secret"); const entry = { gid: "1234567890abcdef", path: "第一季/02.mp4" }; await rpc.add(entry, "https://example.invalid/file", "test-cookie", "test-agent", "/downloads/电影"); await rpc.add(entry, "https://example.invalid/file", "test-cookie", "test-agent", "/downloads/电影"); assert.equal(additions.length, 1); assert.equal(additions[0].dir, "/downloads/电影/第一季"); assert.equal(additions[0].out, "02.mp4"); }
  finally { await new Promise(resolve => server.close(resolve)); }
});
async function until(work) { for (let i = 0; i < 200; i++) { if (await work()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error("State did not settle"); }
test("一次性执行持久化、幂等、所属用户隔离、暂停继续及真实完成状态", async () => {
  const db = new Sequelize({ dialect: "sqlite", storage: ":memory:", logging: false }), statuses = new Map(); let adds = 0;
  const client = singleClient(); client.download = async () => ({ url: "https://example.invalid/file", cookie: "test-secret-cookie" });
  const rpc = { health: async () => ({ connected: true }), status: async gid => statuses.get(gid) || null, add: async file => { adds++; statuses.set(file.gid, { status: "waiting", completedLength: "0", totalLength: "123" }); }, call: async (method, [gid]) => { statuses.get(gid).status = method === "aria2.pause" ? "paused" : "waiting"; } };
  const service = createService({ sequelize: db, DataTypes, Op, axios, clientForUser: async () => client, aria: rpc, directories: new Directories([{ id: "media", label: "测试", browse: temporary, aria: "/downloads" }]) });
  try {
    await service.initialize(); const result = await service.create("user-a", input);
    assert.equal((await service.create("user-a", input)).id, result.id);
    await assert.rejects(service.own(result.id, "user-b"), error => error instanceof PublicError && error.status === 404);
    await until(async () => (await service.own(result.id, "user-a")).state === "downloading"); assert.equal(adds, 1);
    await service.action("user-a", result.id, "pause"); assert.equal((await service.own(result.id, "user-a")).state, "paused");
    await service.action("user-a", result.id, "resume");
    const [gid] = statuses.keys(); statuses.set(gid, { status: "complete", completedLength: "123", totalLength: "123" }); await service.refresh();
    const final = service.publicJob(await service.own(result.id, "user-a")); assert.equal(final.state, "completed"); assert.equal(final.files.length, 1); assert.equal(final.payload, undefined); assert.ok(!JSON.stringify(final).includes("test-secret-cookie"));
  } finally { await service.stop(); await db.close(); }
});
test("重启恢复复用已提交 GID，不再次转存或重新添加", async () => {
  const db = new Sequelize({ dialect: "sqlite", storage: ":memory:", logging: false }), gid = "abcdef1234567890";
  const rpc = { health: async () => ({ connected: true }), status: async () => ({ status: "waiting" }), add: async () => { throw new Error("duplicate add"); } };
  const service = createService({ sequelize: db, DataTypes, Op, axios, clientForUser: async () => ({ download: async () => { throw new Error("unexpected URL fetch"); } }), aria: rpc, directories: new Directories([{ id: "media", label: "测试", browse: temporary, aria: "/downloads" }]) });
  try { await service.Job.sync(); const job = await service.Job.create({ id: "restart", userId: "user-a", intent: input.intent, state: "running", phase: "submitting", payload: JSON.stringify(input), files: JSON.stringify([{ fid: "saved", path: "02.mp4", size: 123, gid, state: "pending" }]) }); await service.initialize(); await until(async () => { await job.reload(); return job.state === "downloading"; }); assert.equal(JSON.parse(job.files)[0].gid, gid); }
  finally { await service.stop(); await db.close(); }
});
test("扩展复用 NAS v0.8.3 的 QuarkService 实例接口，不依赖旧版源码", () => {
  const { QuarkService } = runtimeRequire("./dist-final/services/QuarkService");
  const original = new QuarkService();
  for (const method of ["setCookie", "saveSharedFile", "renameFile", "getShareList", "getFolderList"]) assert.equal(typeof original[method], "function");
  assert.equal(typeof original.api.request, "function"); assert.equal(typeof original.cookie, "string");
});
test("本地目录接口按数据库当前角色鉴权，不能使用旧管理员声明越权", async () => {
  const express = runtimeRequire("express"), app = express();
  app.use((req, _res, next) => { req.user = { userId: req.headers["x-test-user"], role: 1 }; next(); });
  const User = { findOne: async ({ where }) => ({ role: where.userId === "admin" ? 1 : 0 }) };
  app.use(createRouter(express, { paths: { list: () => [{ id: "media", label: "飞牛影视" }] } }, User));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  try { const base = `http://127.0.0.1:${server.address().port}`; assert.equal((await fetch(base + "/roots", { headers: { "x-test-user": "revoked" } })).status, 403); const result = await fetch(base + "/roots", { headers: { "x-test-user": "admin" } }); assert.equal(result.status, 200); assert.equal((await result.json()).data[0].id, "media"); }
  finally { await new Promise(resolve => server.close(resolve)); }
});
test("连接检测报告 aria2 版本和断连，意外错误不泄露密钥", async () => {
  const express = runtimeRequire("express"), app = express(); let failure;
  app.use((req, _res, next) => { req.user = { userId: "admin" }; next(); });
  app.use(createRouter(express, { rpc: { health: async () => { if (failure) throw failure; return { connected: true, version: "1.36.0" }; } } }, { findOne: async () => ({ role: 1 }) }));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/health`;
    assert.deepEqual((await (await fetch(url)).json()).data.aria2, { connected: true, version: "1.36.0" });
    failure = new PublicError("aria2 暂时无法连接，请稍后重试", 503);
    assert.deepEqual((await (await fetch(url)).json()).data.aria2, { connected: false, message: failure.message });
    failure = new Error("token:secret-never-expose");
    const offline = await (await fetch(url)).json(); assert.equal(offline.data.aria2.connected, false); assert.ok(!JSON.stringify(offline).includes("secret-never-expose"));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test("AriaNg 代理兼容批量与 multicall，密钥仅由后端注入", () => {
  const call = (method, params = []) => ({ id: "test", jsonrpc: "2.0", method, params });
  assert.deepEqual(prepare(call("aria2.getVersion"), "server-only").params, ["token:server-only"]);
  const batch = prepare([call("aria2.tellActive", [["gid", "downloadSpeed"]]), call("aria2.getGlobalStat")], "server-only");
  assert.equal(batch.length, 2); assert.equal(batch[0].params[0], "token:server-only");
  const multi = prepare(call("system.multicall", [[{ methodName: "aria2.getVersion", params: [] }, { methodName: "aria2.tellWaiting", params: [0, 1000] }]]), "server-only");
  assert.equal(multi.params.length, 1); assert.equal(multi.params[0][1].params[0], "token:server-only");
  assert.deepEqual(prepare(call("system.listMethods"), "server-only").params, []);
  assert.deepEqual(redact({ result: { "rpc-secret": "server-only", header: ["Cookie: private"], nested: "server-only" } }, "server-only"), { result: { "rpc-secret": "", header: [], nested: "[已隐藏]" } });
});
test("AriaNg 代理拒绝任意路径、关机、客户端密钥及批量越权", () => {
  const call = (method, params = []) => ({ id: "test", jsonrpc: "2.0", method, params });
  for (const method of ["aria2.shutdown", "aria2.forceShutdown", "aria2.addUri", "aria2.addTorrent"]) assert.throws(() => prepare(call(method), "secret"));
  assert.throws(() => prepare(call("aria2.getVersion", ["token:client"]), "secret"));
  assert.throws(() => prepare(call("aria2.changeGlobalOption", [{ dir: "/etc" }]), "secret"));
  assert.throws(() => prepare(call("aria2.changeOption", ["1234567890abcdef", { header: ["secret"] }]), "secret"));
  assert.throws(() => prepare(call("system.multicall", [[{ methodName: "aria2.shutdown" }]]), "secret"));
  assert.throws(() => prepare(call("aria2.tellStopped", [0, 1001]), "secret"));
  assert.equal(prepare(call("aria2.pause", ["1234567890abcdef"]), "secret").params[1], "1234567890abcdef");
});
test("镜像首次启动生成独立持久密钥，重启保持配置，拒绝空 RPC 密钥和弱 JWT", async () => {
  const root = path.join(temporary, "image-init"); await fs.mkdir(root);
  await fs.writeFile(path.join(root, "package.json"), "{}");
  await fs.symlink(path.join(path.dirname(process.env.RUNTIME_PACKAGE || "/app/package.json"), "node_modules"), path.join(root, "node_modules"));
  await fs.writeFile(path.join(root, ".env.example"), "JWT_SECRET=placeholder\nJWT_EXPIRES_IN=6h\n");
  const env = { ADMIN_USER_CODE: "123456", ARIA2_RPC_SECRET: "test-only-rpc-secret-01234567890123456789" };
  assert.throws(() => initializeRuntime(root, { ...env, ARIA2_RPC_SECRET: "" }));
  assert.throws(() => initializeRuntime(root, { ...env, JWT_SECRET: "weak" }));
  initializeRuntime(root, env);
  const original = await fs.readFile(path.join(root, "config/env"), "utf8");
  assert.ok(!original.includes("placeholder")); assert.ok(/JWT_SECRET=[a-f0-9]{64}Aa1!/.test(original));
  assert.equal((await fs.stat(path.join(root, "config/env"))).mode & 0o777, 0o600);
  initializeRuntime(root, env); assert.equal(await fs.readFile(path.join(root, "config/env"), "utf8"), original);
});
test('百度接口复用当前管理员鉴权，提交先校验飞牛根目录，传递真实用户身份', async () => {
  const express = runtimeRequire('express'), app = express(); let role = 0; const calls = [];
  app.use(express.json()); app.use((req, _res, next) => { req.user = { userId: 'real-owner' }; next(); });
  const service = { paths: { resolve: async target => { if (target.rootId !== 'allowed') throw new PublicError('目录越界'); } } };
  const baidu = { call: async (operation, owner, body) => { calls.push({ operation, owner, body }); return { id: 'test-job' }; }, health: async () => ({ connected: true }) };
  app.use(createRouter(express, service, { findOne: async () => ({ role }) }, baidu));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await fetch(base + '/baidu/health')).status, 403);
    role = 1;
    const post = body => fetch(base + '/baidu/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ target: { rootId: 'outside' } })).status, 400); assert.equal(calls.length, 0);
    assert.equal((await post({ target: { rootId: 'allowed' }, _owner: 'spoofed' })).status, 202);
    assert.equal(calls[0].owner, 'real-owner');
    assert.equal((await post({ download: false })).status, 202);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('带提取码的夸克链接复用当前用户和原生分享客户端，拒绝非法输入', async () => {
  const express = runtimeRequire('express'), app = express(); const requests = [];
  app.use(express.json()); app.use((req, _res, next) => { req.user = { userId: 'owner' }; next(); });
  const service = { clientForUser: async owner => { assert.equal(owner, 'owner'); return { token: async request => { requests.push(request); return 'share-token'; }, share: async (_request, token, parent) => { assert.equal(token, 'share-token'); assert.equal(parent, '0'); return [{ fid: 'one', name: 'movie.mp4', token: 'file-token', directory: false, size: 42 }]; } }; } };
  app.use(createRouter(express, service, { findOne: async () => ({ role: 1 }) }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const call = body => fetch('http://127.0.0.1:' + server.address().port + '/quark/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await call({ shareCode: '../bad' })).status, 400);
    const result = await call({ shareCode: 'abc123', receiveCode: 'aB12' }); assert.equal(result.status, 200);
    assert.deepEqual(requests, [{ shareCode: 'abc123', passcode: 'aB12' }]); assert.equal((await result.json()).data.list[0].fileId, 'one');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('夸克与百度定期清理 30 天前已完成或失败记录，保留近期及进行中任务', async () => {
  const db = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  const now = Date.now(), day = 24 * 60 * 60 * 1000;
  const service = createService({ sequelize: db, DataTypes, Op, axios, clientForUser: async () => ({}), aria: { health: async () => ({ connected: true }), status: async () => null }, directories: new Directories([{ id: 'media', label: '测试', browse: temporary, aria: '/downloads' }]) });
  const baidu = new BaiduNative({ sqlite3: null, axios, sequelize: db, DataTypes, Op, paths: service.paths, hostRoots: { media: temporary } });
  try {
    await service.Job.sync(); await baidu.Job.sync();
    const putQuark = async (id, state, daysAgo) => {
      const stamp = new Date(now - daysAgo * day);
      await service.Job.create({ id, userId: 'u1', intent: 'intent-' + id, state, phase: state, payload: JSON.stringify(input), files: '[]', createdAt: stamp, updatedAt: stamp }, { silent: true });
      assert.equal(new Date((await service.Job.findByPk(id)).updatedAt).getTime(), stamp.getTime());
    };
    await putQuark('old-done', 'completed', 31);
    await putQuark('old-fail', 'failed', 45);
    await putQuark('recent-done', 'completed', 29);
    await putQuark('recent-fail', 'failed', 5);
    await putQuark('old-paused', 'paused', 40);
    await putQuark('old-downloading', 'downloading', 40);
    assert.equal(await service.prune(now), 2);
    assert.deepEqual((await service.Job.findAll({ order: [['id', 'ASC']] })).map(row => row.id), ['old-downloading', 'old-paused', 'recent-done', 'recent-fail']);
    await putQuark('boot-old-done', 'completed', 35);
    await service.initialize();
    assert.equal(await service.Job.findByPk('boot-old-done'), null);

    const putBaidu = async (id, state, daysAgo) => {
      const stamp = new Date(now - daysAgo * day);
      await baidu.Job.create({ id, owner: 'u1', intent: 'intent-' + id, state, data: JSON.stringify({ id, state }), createdAt: stamp, updatedAt: stamp }, { silent: true });
      assert.equal(new Date((await baidu.Job.findByPk(id)).updatedAt).getTime(), stamp.getTime());
    };
    await putBaidu('bd-old-done', 'completed', 31);
    await putBaidu('bd-old-fail', 'failed', 60);
    await putBaidu('bd-recent-done', 'completed', 10);
    await putBaidu('bd-recent-fail', 'failed', 29);
    await putBaidu('bd-old-downloading', 'downloading', 40);
    assert.equal(await baidu.prune(now), 2);
    assert.deepEqual((await baidu.Job.findAll({ order: [['id', 'ASC']] })).map(row => row.id), ['bd-old-downloading', 'bd-recent-done', 'bd-recent-fail']);
    await putBaidu('bd-boot-old-fail', 'failed', 35);
    await baidu.initialize();
    assert.equal(await baidu.Job.findByPk('bd-boot-old-fail'), null);
  } finally { await service.stop(); await baidu.stop(); await db.close(); }
});
