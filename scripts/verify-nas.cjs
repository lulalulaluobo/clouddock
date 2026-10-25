// Run inside the isolated container; credentials and signed URLs never leave it.
const { createRequire } = require("node:module");
const assert = require("node:assert/strict");
const appRequire = createRequire("/app/dist-final/app.js");
const jwt = appRequire("jsonwebtoken"), db = appRequire("./config/database").default;
const User = appRequire("./models/User").default;
const { config } = appRequire("./config");
(async () => {
  const user = await User.findOne({ where: { username: "luobo", role: 1 } }); assert.ok(user);
  const token = jwt.sign({ userId: user.userId, role: user.role }, config.jwt.secret, { expiresIn: "5m" });
  async function call(endpoint, body, auth = true) { const response = await fetch("http://127.0.0.1:8008/api" + endpoint, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer " + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, data: await response.json() }; }
  assert.equal((await call("/clouddock/jobs", undefined, false)).status, 401);
  const health = await call("/clouddock/health"); assert.equal(health.status, 200); assert.equal(health.data.data.baseVersion, "0.8.3"); assert.equal(health.data.data.aria2.connected, true);
  const channels = await db.query("SELECT count(*) total,sum(isEnabled) enabled FROM search_channels", { type: appRequire("sequelize").QueryTypes.SELECT });
  assert.ok(channels[0].total > 0); assert.ok(channels[0].enabled > 0);
  const roots = await call("/clouddock/roots"); assert.equal(roots.status, 200); assert.equal(roots.data.data[0].id, "media");
  const directories = await call("/clouddock/directories?rootId=media&path="); assert.equal(directories.status, 200);
  assert.equal((await call("/clouddock/directories?rootId=media&path=../")).status, 400);
  const before = await call("/clouddock/jobs"); assert.equal(before.status, 200);
  const invalid = { shareCode: "test", parentId: "0", folderId: "0", selectedIds: [], intent: "test-invalid-only", target: { rootId: "media", relativePath: "" } };
  assert.equal((await call("/clouddock/jobs", invalid)).status, 400); assert.deepEqual((await call("/clouddock/jobs")).data.data, before.data.data);
  const axios = appRequire("axios"), { Aria } = require("/app/clouddock/core.cjs"), aria = new Aria(axios);
  assert.equal(await aria.status("ffffffffffffffff"), null);
  const stats = await aria.call("aria2.getGlobalStat");
  if (process.env.VERIFY_BAIDU === '1') {
    assert.equal((await call('/clouddock/baidu/authorize', {}, false)).status, 401);
    const auth = await call('/clouddock/baidu/authorize', {}); assert.equal(auth.status, 200); assert.equal(auth.data.data.connected, true); assert.equal(auth.data.data.nasMember, true);
    const health = await call('/clouddock/baidu/health'); assert.equal(health.data.data.connected, true);
    const share = await call('/clouddock/baidu/share', { shareCode: '1q9IORb2Rx5mNVcNQ-IlaJA', receiveCode: 'jt1c' }); assert.equal(share.status, 200); assert.equal(share.data.data.list.length, 1);
    const folders = await call('/clouddock/baidu/folders?parentCid=%2F'); assert.equal(folders.status, 200);
    const jobs = await call('/clouddock/baidu/jobs'); assert.equal(jobs.data.data.length, 0);
    console.log(JSON.stringify({ baidu: 'PASS', connected: true, nasMember: true, readOnlyShare: true, folders: true, newDownloads: 0 }));
  }
  console.log(JSON.stringify({ result: "PASS", baseVersion: "0.8.3", channels: channels[0], aria2: health.data.data.aria2.version, nasSubdirectories: directories.data.data.items.length, jobsUnchanged: true, active: stats.numActive, waiting: stats.numWaiting, stopped: stats.numStopped }, null, 2));
})().catch(error => { console.error("隔离实例验证失败：", error.name, String(error.stack).split("\n").find(line => line.includes("[stdin]")) || "请检查服务状态"); process.exitCode = 1; }).finally(() => db.close());
