// Built into the app. Uses its existing sqlite3/axios/Sequelize dependencies.
const fs = require('node:fs/promises'), path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { PublicError, filename, relative } = require('./core.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function cloudPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 2048 || /[\\\x00-\x1f]/.test(value) || value.split('/').some(p => ['.', '..'].includes(p))) throw new PublicError('网盘目录无效，请重新选择');
  return '/' + value.split('/').filter(Boolean).join('/');
}
// SDK task IDs exceed Number.MAX_SAFE_INTEGER. Never round them in JSON.parse.
function parseJson(text) {
  return JSON.parse(text.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token => token[0] !== '"' && /^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token)) ? JSON.stringify(token) : token));
}
function idList(ids) { if (!ids.length || ids.some(id => !/^\d{1,20}$/.test(String(id)))) throw new PublicError('文件或任务标识无效'); return '[' + ids.join(',') + ']'; }
class BaiduNative {
  constructor({ sqlite3, axios, sequelize, DataTypes, Op, paths, database = process.env.BAIDU_DATABASE || '/run/fnos-baidu/db/main.db', binding = '/app/config/fnos-baidu-binding.json', uid = process.env.BAIDU_NAS_UID || '1000', links = '/run/fnos-baidu/ulinks', hostRoots }) {
    Object.assign(this, { sqlite3, axios, Op, paths, database, binding, uid, links });
    this.hostRoots = hostRoots || (process.env.BAIDU_HOST_ROOTS_JSON ? JSON.parse(process.env.BAIDU_HOST_ROOTS_JSON) : { media: process.env.BAIDU_HOST_DOWNLOAD_PATH });
    this.Job = sequelize.models.CloudDockBaiduJob || sequelize.define('CloudDockBaiduJob', { id: { type: DataTypes.STRING, primaryKey: true }, owner: DataTypes.STRING, intent: DataTypes.STRING, state: DataTypes.STRING, data: DataTypes.TEXT }, { tableName: 'clouddock_baidu_jobs', indexes: [{ unique: true, fields: ['owner', 'intent'] }] });
    this.busy = false; this.refreshing = false;
  }
  async credentials() {
    let row;
    try {
      row = await new Promise((resolve, reject) => {
        const db = new this.sqlite3.Database(this.database, this.sqlite3.OPEN_READONLY, error => {
          if (error) { reject(error); return; }
          db.get('select u.access_token,u.device_id,u.uk from nas_bd_user u join nas_bd_bind b on b.nas_uid=u.nas_uid and b.current_uk=u.uk where u.nas_uid=? and u.deleted_at=0 and b.deleted_at=0', [this.uid], (failure, value) => { db.close(); failure ? reject(failure) : resolve(value); });
        });
      });
    } catch { throw new PublicError('无法读取飞牛百度登录信息，请检查 Compose 的只读目录挂载', 503); }
    if (!row?.access_token || !row.device_id) throw new PublicError('请先在飞牛官方百度网盘应用登录，再点击获取授权', 503);
    return { token: row.access_token, device: row.device_id, account: createHash('sha256').update(String(row.uk) + ':' + row.device_id).digest('hex') };
  }
  async ensure() {
    let binding; try { binding = JSON.parse(await fs.readFile(this.binding, 'utf8')); } catch { throw new PublicError('请在设置中点击“获取飞牛百度网盘授权”', 503); }
    const credentials = await this.credentials();
    if (binding.account !== credentials.account) throw new PublicError('飞牛百度账号已切换，请在设置中重新获取授权', 409);
    return credentials.account;
  }
  async api(endpoint, query, body, account) {
    const credentials = await this.credentials();
    if (account && account !== credentials.account) throw new PublicError('飞牛百度账号已切换，本次任务已停止', 409);
    const params = { ...query, access_token: credentials.token };
    if (params.device_id === true) params.device_id = credentials.device;
    let result;
    try {
      const response = await this.axios.request({ url: 'https://pan.baidu.com' + endpoint, params, method: body === undefined ? 'GET' : 'POST', data: body === undefined ? undefined : new URLSearchParams(body).toString(), headers: body === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 25000, maxRedirects: 0, proxy: false, responseType: 'text', transformResponse: [x => x], maxContentLength: 8 * 1024 * 1024, validateStatus: status => status < 500 });
      result = parseJson(response.data);
    } catch { throw new PublicError('百度请求结果未确认，请查看任务记录，勿重复提交', 502); }
    // A partial download response can contain accepted tasks; retain them before reporting failures.
    if (result.errno === 42620 && endpoint === '/rest/2.0/xpan/nas' && query.method === 'download') return result;
    if (result.errno !== 0) {
      if ([110, 111, -6, 6].includes(result.errno)) throw new PublicError('百度登录已失效，请在飞牛官方应用重新登录后获取授权', 503);
      const operation = endpoint.endsWith('/transfer') ? '转存' : endpoint.endsWith('/taskquery') ? '查询转存结果' : endpoint.endsWith('/nas') ? '下载' : '访问网盘';
      throw new PublicError(`百度${operation}未接受请求（代码 ${result.errno}）`, 502);
    }
    return result;
  }
  async member(account) {
    const result = await this.api('/rest/2.0/xpan/device', { method: 'iotqueryuinfo', device_id: true }, undefined, account);
    return { connected: true, engine: 'fnos-baidu', nasMember: result.data?.is_iot_svip === 1, expiresAt: result.data?.end_time, message: '已获取飞牛百度授权，登录由飞牛官方应用管理' };
  }
  async authorize() {
    const { account } = await this.credentials(), result = await this.member(account);
    await fs.mkdir(path.dirname(this.binding), { recursive: true });
    const temp = this.binding + '.' + randomUUID();
    await fs.writeFile(temp, JSON.stringify({ account, authorizedAt: new Date().toISOString() }), { mode: 0o600 });
    await fs.rename(temp, this.binding);
    return result;
  }
  async health() { try { return await this.member(await this.ensure()); } catch (e) { return { connected: false, message: e instanceof PublicError ? e.message : '读取百度状态失败' }; } }
  async shareParams(body, account) {
    if (typeof body.shareCode !== 'string' || !/^1[A-Za-z0-9_-]{4,127}$/.test(body.shareCode)) throw new PublicError('百度分享链接无效');
    const pwd = body.receiveCode || body.passcode || '';
    if (typeof pwd !== 'string' || !/^[A-Za-z0-9]{0,16}$/.test(pwd)) throw new PublicError('提取码格式无效');
    const query = { appid: '116623829', product: 'netdisk', short_url: body.shareCode.slice(1) };
    const result = await this.api('/apaas/1.0/share/verify', query, { pwd }, account);
    return { query, spwd: result.data.spwd };
  }
  async shareList(context, parent, account) {
    const rows = [];
    for (let page = 1; page <= 201; page++) {
      const result = await this.api('/apaas/1.0/share/list', context.query, { spwd: context.spwd, dir: cloudPath(parent), page, page_size: 100, order_by: 'name', desc_order: 0 }, account);
      const batch = result.data.list; rows.push(...batch); if (batch.length < 100) return rows;
    }
    throw new PublicError('目录过大，请缩小选择范围');
  }
  async own(parent, account) {
    const rows = [];
    for (let start = 0; start < 20100; start += 100) {
      const result = await this.api('/rest/2.0/xpan/file', { method: 'list', dir: cloudPath(parent), start, limit: 100, order: 'name', desc: 0 }, undefined, account);
      const batch = result.list || []; rows.push(...batch); if (batch.length < 100) return rows;
    }
    throw new PublicError('目录过大，请缩小选择范围');
  }
  async target(target) {
    const location = await this.paths.resolve(target), host = this.hostRoots[target.rootId];
    if (typeof host !== 'string' || !host.startsWith('/')) throw new PublicError('尚未配置百度下载宿主机路径，请检查 Compose 配置');
    const linkDirectory = path.join(this.links, String(this.uid), 'download'), matches = [];
    try {
      for (const name of await fs.readdir(linkDirectory)) {
        const link = path.join(linkDirectory, name); if (!(await fs.lstat(link)).isSymbolicLink()) continue;
        const base = path.resolve(path.dirname(link), await fs.readlink(link));
        const suffix = path.relative(base, path.resolve(host));
        if (suffix !== '..' && !suffix.startsWith('../') && !path.isAbsolute(suffix)) matches.push({ length: base.length, sdk: path.posix.join('/', name, suffix, relative(target.relativePath)) });
      }
    } catch { throw new PublicError('无法读取飞牛百度目录映射，请检查只读挂载'); }
    if (!matches.length) throw new PublicError('该下载目录不在飞牛百度授权的目录范围内');
    matches.sort((a, b) => b.length - a.length);
    return { ...location, sdk: matches[0].sdk };
  }
  async validateTree(rows, base, account, context, prefix = '', count = { value: 0 }, depth = 0) {
    for (const row of rows) {
      if (++count.value > 20000 || depth > 40) throw new PublicError('资源过多，请分批选择');
      const name = filename(row.server_filename), next = prefix ? prefix + '/' + name : name;
      await this.paths.checkFile(base, row.isdir ? next + '/__clouddock_path_check__' : next);
      if (row.isdir) {
        const actual = path.join(base, next);
        try { const info = await fs.lstat(actual); if (info.isSymbolicLink() || !info.isDirectory()) throw new PublicError('飞牛目标存在类型冲突'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const children = context ? await this.shareList(context, row.path, account) : await this.own(row.path, account);
        await this.validateTree(children, base, account, context, next, count, depth + 1);
      }
    }
  }
  async downloadPlan(rows, account, prefix = '', files = [], count = { value: 0 }, depth = 0) {
    for (const row of rows) {
      if (++count.value > 20000 || depth > 40) throw new PublicError('资源过多，请分批选择');
      const local = path.posix.join(prefix, filename(row.server_filename));
      if (row.isdir) await this.downloadPlan(await this.own(cloudPath(row.path), account), account, local, files, count, depth + 1);
      else { const fid = String(row.fs_id ?? row.fsid); idList([fid]); files.push({ fid, path: local }); }
    }
    return files;
  }
  async ensureLocalDirectory(target, directory) {
    let current = { ...target };
    for (const name of directory.split('/').filter(part => part && part !== '.')) {
      const location = await this.paths.resolve(current), next = path.join(location.browse, filename(name));
      try { const info = await fs.lstat(next); if (!info.isDirectory() || info.isSymbolicLink()) throw new PublicError('飞牛目录存在类型冲突'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await this.paths.create(current, name); }
      current.relativePath = path.posix.join(current.relativePath || '', name);
    }
    return current;
  }
  async submitDownloads(job, rows, location) {
    if (!job.downloadPlan) { job.downloadPlan = await this.downloadPlan(rows, job.account); await this.persist(job); }
    if (!job.downloadPlan.length) throw new PublicError('所选文件夹为空，没有可下载文件');
    job.downloadTasks ||= [];
    const groups = new Map();
    for (const file of job.downloadPlan) {
      if (job.downloadTasks.some(task => String(task.fs_id) === file.fid)) continue;
      const dir = path.posix.dirname(file.path); if (!groups.has(dir)) groups.set(dir, []); groups.get(dir).push(file);
    }
    for (const [directory, files] of groups) {
      await this.ensureLocalDirectory(job.target, directory);
      for (let offset = 0; offset < files.length; offset += 100) {
        const batch = files.slice(offset, offset + 100), ids = batch.map(file => file.fid);
        job.phase = 'submitting'; job.uncertain = true; job.rid = Date.now(); await this.persist(job);
        const result = await this.api('/rest/2.0/xpan/nas', { method: 'download', device_id: true, type: 2, rtype: 1, rid: job.rid, iot_version: 'FnOS-BaiduNetdisk-1.0.0', auto_sync: 0, use_local_mtime: 0 }, { fs_ids: idList(ids), save_path: path.posix.join(location.sdk, directory) }, job.account);
        const tasks = result.list || [];
        if (tasks.some(x => !ids.includes(String(x.fs_id)) || !/^\d+$/.test(String(x.task_id))) || new Set(tasks.map(x => String(x.fs_id))).size !== tasks.length) throw new PublicError('下载返回标识异常，请在飞牛百度核对，勿重复提交');
        job.downloadTasks.push(...tasks.map(task => ({ ...task, localPath: batch.find(file => file.fid === String(task.fs_id)).path })));
        job.uncertain = false;
        if (tasks.length !== ids.length || result.errno === 42620) job.submissionError = `部分文件未创建下载任务（已接受 ${job.downloadTasks.length}/${job.downloadPlan.length} 个），请在飞牛百度核对`;
        await this.persist(job);
        if (job.submissionError) return;
      }
    }
  }
  public(job) { return Object.fromEntries(['id', 'title', 'state', 'phase', 'error', 'target', 'selectedCount', 'files', 'createdAt', 'provider', 'download'].map(key => [key, job[key]])); }
  async persist(job) { await this.Job.update({ state: job.state, data: JSON.stringify(job) }, { where: { id: job.id } }); }
  async create(owner, body) {
    if (!/^[\w-]{8,100}$/.test(body.intent || '')) throw new PublicError('操作标识无效');
    const prior = await this.Job.findOne({ where: { owner, intent: body.intent } }); if (prior) return this.public(JSON.parse(prior.data));
    const selected = body.selectedIds;
    if (!Array.isArray(selected) || !selected.length || selected.length > 500 || selected.some(x => typeof x !== 'string' || !/^\d{1,20}$/.test(x)) || new Set(selected).size !== selected.length) throw new PublicError('请明确勾选 1 至 500 个不同资源');
    if (await this.Job.count({ where: { state: { [this.Op.in]: ['queued', 'running'] } } }) >= 8) throw new PublicError('转存队列已满，请稍后重试', 429);
    const account = await this.ensure(), download = body.download !== false;
    if (download) await this.target(body.target);
    const payload = { shareCode: body.shareCode, passcode: body.passcode || '', selectedIds: selected, parentId: cloudPath(body.parentId || '/'), folderId: cloudPath(body.folderId || '/') };
    const job = { id: 'baidu-' + randomUUID(), owner, intent: body.intent, account, payload, provider: 'baidu', state: 'queued', phase: 'queued', error: '', files: [], title: String(body.title || '百度转存').slice(0, 512), target: body.target || { relativePath: '' }, download, selectedCount: selected.length, createdAt: new Date().toISOString() };
    try { await this.Job.create({ id: job.id, owner, intent: body.intent, state: job.state, data: JSON.stringify(job) }); }
    catch (error) { const existing = await this.Job.findOne({ where: { owner, intent: body.intent } }); if (existing) return this.public(JSON.parse(existing.data)); throw error; }
    setImmediate(() => void this.pump()); return this.public(job);
  }
  async run(job) {
    try {
      if (job.uncertain) throw new PublicError('上次提交结果未确认，为避免重复任务，请先在飞牛百度网盘核对');
      if (job.account !== await this.ensure()) throw new PublicError('百度账号已切换，本次任务已停止');
      job.state = 'running'; job.phase = 'validating'; await this.persist(job);
      const p = job.payload, context = await this.shareParams(p, job.account);
      const source = await this.shareList(context, p.parentId, job.account), selected = source.filter(x => p.selectedIds.includes(String(x.fsid ?? x.fs_id)));
      if (selected.length !== p.selectedIds.length) throw new PublicError('勾选资源已变化，请重新选择');
      const location = job.download ? await this.target(job.target) : null;
      if (location) await this.validateTree(selected, location.browse, job.account, context);
      if (!job.transferTask) {
        job.phase = 'saving'; job.uncertain = true; await this.persist(job);
        // Share transfer expects JSON string IDs; the NAS download API expects numeric IDs.
        const result = await this.api('/apaas/1.0/share/transfer', { ...context.query, device_id: true }, { spwd: context.spwd, fsid_list: JSON.stringify(p.selectedIds), to_path: p.folderId, async: 2, ondup: 'newcopy' }, job.account);
        job.transferTask = String(result.data.task_id); job.uncertain = false; await this.persist(job);
      }
      let transfer;
      for (let retry = 0; retry < 120; retry++) {
        transfer = (await this.api('/apaas/1.0/share/taskquery', { appid: '116623829', task_id: job.transferTask }, undefined, job.account)).data;
        if (transfer.status === 'success') break;
        if (!['pending', 'running'].includes(transfer.status)) throw new PublicError('百度转存失败，请检查容量和分享状态');
        await delay(1000);
      }
      if (transfer.status !== 'success') throw new PublicError('百度转存仍在处理，请在官方应用核对结果，勿重复提交');
      const saved = transfer.desc.list;
      if (saved.length !== selected.length || new Set(saved.map(x => String(x.from_fs_id))).size !== selected.length || saved.some(x => !p.selectedIds.includes(String(x.from_fs_id)))) throw new PublicError('转存结果与勾选项不一致，已停止下载');
      job.saved = saved;
      if (!job.download) { job.state = 'completed'; job.phase = 'completed'; await this.persist(job); return; }
      const actual = saved.map(x => ({ ...selected.find(s => String(s.fsid ?? s.fs_id) === String(x.from_fs_id)), fs_id: x.to_fs_id, fsid: x.to_fs_id, path: cloudPath(x.to), server_filename: x.to.split('/').at(-1) }));
      await this.validateTree(actual, location.browse, job.account, null);
      await this.submitDownloads(job, actual, location);
      job.files = job.downloadTasks.map(x => ({ gid: String(x.task_id), fid: String(x.fs_id), path: x.localPath || x.path.split('/').at(-1), state: 'waiting', completed: 0, total: 0, speed: 0 }));
      if (job.submissionError) job.error = job.submissionError;
      if (!job.files.length) throw new PublicError(job.submissionError || '未创建下载任务');
      job.state = 'downloading'; job.phase = 'downloading'; await this.persist(job);
    } catch (error) { job.state = 'failed'; job.error = error instanceof PublicError ? error.message : '处理结果未确认，请在飞牛百度核对本次任务'; await this.persist(job); }
  }
  async pump() {
    if (this.busy) return; this.busy = true;
    try { for (;;) { const row = await this.Job.findOne({ where: { state: 'queued' }, order: [['createdAt', 'ASC']] }); if (!row) break; await this.run(JSON.parse(row.data)); } }
    catch { /* Retain durable checkpoint. */ } finally { this.busy = false; }
  }
  async refresh() {
    if (this.refreshing) return; this.refreshing = true;
    try {
      const rows = await this.Job.findAll({ where: { state: 'downloading' }, limit: 50 }); if (!rows.length) return;
      const account = await this.ensure(), jobs = rows.map(x => JSON.parse(x.data));
      const ids = [...new Set(jobs.filter(j => j.account === account).flatMap(j => j.files.map(f => f.gid)))], tasks = new Map();
      for (let i = 0; i < ids.length; i += 100) { const result = await this.api('/rest/2.0/xpan/nas', { method: 'batchtaskmeta', device_id: true, taskid_list: idList(ids.slice(i, i + 100)), iot_version: 'FnOS-BaiduNetdisk-1.0.0' }, undefined, account); for (const row of result.task_meta || []) tasks.set(String(row.task_id), row); }
      for (const job of jobs) {
        if (job.account !== account) { job.state = 'failed'; job.error = '百度账号已切换，请到原账号查看结果'; await this.persist(job); continue; }
        for (const file of job.files) {
          const row = tasks.get(file.gid); if (!row) continue;
          Object.assign(file, { state: row.status === 5 ? 'complete' : row.fail_code ? 'error' : row.status === 3 ? 'active' : 'waiting', completed: Number(row.current_size || 0), total: Number(row.size || 0), speed: row.status === 3 ? Number(row.speed || 0) : 0 });
          if (file.state === 'error') file.error = '飞牛百度下载失败（代码 ' + row.fail_code + '）';
        }
        if (job.files.length && job.files.every(f => f.state === 'complete')) { job.state = job.submissionError ? 'failed' : 'completed'; job.phase = 'completed'; }
        else if (job.files.some(f => f.state === 'error')) { job.state = 'failed'; job.error = '请在飞牛百度网盘查看或恢复失败下载'; }
        await this.persist(job);
      }
    } catch { /* Keep last known progress when disconnected. */ } finally { this.refreshing = false; }
  }
  async call(action, owner, body = {}) {
    if (action === '/list') return (await this.Job.findAll({ where: { owner }, order: [['createdAt', 'DESC']], limit: 30 })).map(x => this.public(JSON.parse(x.data)));
    if (action === '/jobs') return this.create(owner, body);
    const account = await this.ensure();
    if (action === '/share') {
      const rows = await this.shareList(await this.shareParams(body, account), body.parentId || '/', account);
      return { shareCode: body.shareCode, list: rows.map(x => ({ fileId: x.isdir ? cloudPath(x.path) : String(x.fsid ?? x.fs_id), fileIdToken: String(x.fsid ?? x.fs_id), fileName: filename(x.server_filename), isFolder: Boolean(x.isdir), fileSize: Number(x.size || 0) })) };
    }
    if (action === '/folders') return (await this.own(body.parentId || '/', account)).filter(x => x.isdir).map(x => ({ cid: cloudPath(x.path), name: filename(x.server_filename) }));
    if (action === '/mkdir') { const destination = cloudPath(body.parentId || '/').replace(/\/$/, '') + '/' + filename(String(body.name || '').trim()); const result = await this.api('/rest/2.0/xpan/file', { method: 'create' }, { path: destination, isdir: 1, rtype: 0 }, account); return { fid: result.path || destination }; }
    throw new PublicError('接口不存在', 404);
  }
  async initialize() { await this.Job.sync(); const rows = await this.Job.findAll({ where: { state: 'running' } }); for (const row of rows) { const job = JSON.parse(row.data); job.state = 'queued'; await this.persist(job); } this.timer = setInterval(() => { void this.pump(); void this.refresh(); }, 5000); this.timer.unref(); void this.pump(); }
  async stop() { clearInterval(this.timer); while (this.busy || this.refreshing) await delay(20); }
}
module.exports = { BaiduNative, parseJson, idList, cloudPath };
