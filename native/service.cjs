const { randomUUID, randomBytes } = require("node:crypto");
const { PublicError, parseRequest, Directories, Aria, plan, USER_AGENT } = require("./core.cjs");

function createService({ sequelize, DataTypes, Op, axios, clientForUser, directories, aria }) {
  const Job = sequelize.models.CloudDockJob || sequelize.define("CloudDockJob", {
    id: { type: DataTypes.STRING(36), primaryKey: true }, userId: { type: DataTypes.STRING, allowNull: false },
    intent: { type: DataTypes.STRING, allowNull: false }, state: { type: DataTypes.STRING, allowNull: false },
    phase: { type: DataTypes.STRING, allowNull: false }, error: { type: DataTypes.TEXT, defaultValue: "" },
    payload: { type: DataTypes.TEXT, allowNull: false }, files: { type: DataTypes.TEXT, allowNull: false, defaultValue: "[]" },
  }, { tableName: "clouddock_download_jobs", indexes: [{ unique: true, fields: ["userId", "intent"] }, { fields: ["userId", "createdAt"] }] });
  const paths = directories || new Directories(), rpc = aria || new Aria(axios);
  let busy = false, refreshing = false, timer;
  function publicJob(job) {
    const data = JSON.parse(job.payload);
    return { id: job.id, title: data.title, state: job.state, phase: job.phase, error: job.error, target: data.target, selectedCount: data.selectedIds.length, files: JSON.parse(job.files), createdAt: job.createdAt };
  }
  async function own(id, userId) {
    const job = await Job.findOne({ where: { id, userId } });
    if (!job) throw new PublicError("记录不存在或无权访问", 404);
    return job;
  }
  async function run(job) {
    const payload = JSON.parse(job.payload); let files = JSON.parse(job.files);
    try {
      await job.update({ state: "running", phase: "validating", error: "" });
      const location = await paths.resolve(payload.target), client = await clientForUser(job.userId);
      await rpc.health();
      if (!files.length) {
        const planned = await plan(client, payload, async task => { payload.tasks = [...(payload.tasks || []), task]; await job.update({ payload: JSON.stringify(payload) }); }, async phase => { await job.update({ phase }); });
        if (!planned.length) throw new PublicError("所选目录没有可下载文件");
        files = planned.map(file => ({ ...file, gid: randomBytes(8).toString("hex"), state: "pending", completed: 0, total: file.size }));
        await job.update({ files: JSON.stringify(files) });
      }
      await job.update({ phase: "submitting" });
      for (const file of files) {
        if (file.state === "complete") continue;
        try {
          const known = await rpc.status(file.gid);
          if (known && ["error", "removed"].includes(known.status)) throw new PublicError("下载失败，请使用失败重试重新获取直链");
          if (!known) {
            await paths.checkFile(location.browse, file.path);
            const link = await client.download(file.fid);
            await rpc.add(file, link.url, link.cookie, USER_AGENT, location.aria);
          }
          file.state = known?.status || "waiting"; delete file.error;
        } catch (error) { file.state = "error"; file.error = error instanceof PublicError ? error.message : "提交下载失败，请重试"; }
        await job.update({ files: JSON.stringify(files) });
      }
      const failed = files.every(file => file.state === "error");
      await job.update({ state: failed ? "failed" : "downloading", phase: "downloading", error: failed ? "下载未能提交，请查看文件状态" : "", files: JSON.stringify(files) });
    } catch (error) { await job.update({ state: "failed", error: error instanceof PublicError ? error.message : "本次处理失败，请检查配置后重试" }); }
  }
  async function pump() {
    if (busy) return;
    busy = true;
    try { for (;;) { const job = await Job.findOne({ where: { state: "queued" }, order: [["createdAt", "ASC"]] }); if (!job) break; await run(job); } }
    catch { console.error("CloudDock 执行队列异常，请查看记录"); }
    finally { busy = false; }
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const jobs = await Job.findAll({ where: { state: { [Op.in]: ["downloading", "paused"] } }, limit: 50 });
      for (const job of jobs) {
        const files = JSON.parse(job.files); let disconnected = false;
        for (const file of files) {
          if (file.state === "complete" || file.state === "error" && file.error) continue;
          try {
            const known = await rpc.status(file.gid);
            if (!known) { file.state = "error"; file.error = "aria2 中不存在此项，请重试恢复"; continue; }
            file.state = known.status; file.completed = Number(known.completedLength || 0); file.total = Number(known.totalLength || file.size);
            if (known.status === "error") file.error = "aria2 下载失败，可重试刷新直链";
          } catch { disconnected = true; break; }
        }
        if (disconnected) continue;
        const done = files.every(file => file.state === "complete"), live = files.some(file => ["active", "waiting"].includes(file.state)), failed = files.some(file => ["error", "removed"].includes(file.state)), paused = files.some(file => file.state === "paused");
        await Job.update({ files: JSON.stringify(files), state: done ? "completed" : live ? "downloading" : failed ? "failed" : paused ? "paused" : "downloading", error: failed ? "部分文件未完成，请查看明细" : "", phase: done ? "completed" : job.phase }, { where: { id: job.id, updatedAt: job.updatedAt, state: { [Op.in]: ["downloading", "paused"] } } });
      }
    } catch { /* bounded status polling will retry */ }
    finally { refreshing = false; }
  }
  async function create(userId, body) {
    const payload = parseRequest(body);
    const prior = await Job.findOne({ where: { userId, intent: payload.intent } });
    if (prior) return publicJob(prior);
    if (await Job.count({ where: { state: { [Op.in]: ["queued", "running"] } } }) >= 8) throw new PublicError("提交队列已满，请稍后重试", 429);
    await paths.resolve(payload.target); await clientForUser(userId); await rpc.health();
    let job;
    try { job = await Job.create({ id: randomUUID(), userId, intent: payload.intent, payload: JSON.stringify(payload), state: "queued", phase: "queued" }); }
    catch (error) { const existing = await Job.findOne({ where: { userId, intent: payload.intent } }); if (existing) return publicJob(existing); throw error; }
    setImmediate(() => void pump());
    return publicJob(job);
  }
  async function action(userId, id, operation) {
    const job = await own(id, userId), files = JSON.parse(job.files);
    if (["queued", "running"].includes(job.state)) throw new PublicError("正在转存，请等待本阶段处理结束");
    if (operation === "retry") {
      if (job.state !== "failed") throw new PublicError("只有失败的执行可以重试");
      for (const file of files) {
        if (!["error", "removed"].includes(file.state)) continue;
        const known = await rpc.status(file.gid);
        if (known && ["active", "waiting", "paused", "complete"].includes(known.status)) file.state = known.status;
        else { if (known) await rpc.call("aria2.removeDownloadResult", [file.gid]); file.state = "pending"; }
        delete file.error;
      }
      await job.update({ files: JSON.stringify(files), state: "queued", error: "" });
      void pump();
    } else if (operation === "pause" || operation === "resume") {
      for (const file of files) { const known = await rpc.status(file.gid); if (known && operation === "pause" && ["active", "waiting"].includes(known.status)) await rpc.call("aria2.pause", [file.gid]); if (known?.status === "paused" && operation === "resume") await rpc.call("aria2.unpause", [file.gid]); }
      await refresh();
    } else throw new PublicError("不支持此操作");
    return publicJob(await own(id, userId));
  }
  return {
    Job, paths, rpc, clientForUser, own, publicJob, create, action, refresh,
    async list(userId) { return (await Job.findAll({ where: { userId }, order: [["createdAt", "DESC"]], limit: 30 })).map(publicJob); },
    async initialize() { await Job.sync(); await Job.update({ state: "queued" }, { where: { state: "running" } }); timer = setInterval(() => { void refresh(); void pump(); }, 4000); timer.unref(); void pump(); },
    async stop() { if (timer) clearInterval(timer); while (busy || refreshing) await new Promise(resolve => setTimeout(resolve, 20)); },
  };
}
module.exports = { createService };
