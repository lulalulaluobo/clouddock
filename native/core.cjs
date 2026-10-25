const fs = require("node:fs/promises");
const path = require("node:path");

class PublicError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function filename(value) {
  if (typeof value !== "string" || !value || [".", ".."].includes(value) || /[\\/\x00-\x1f]/.test(value)) throw new PublicError("文件名称包含不安全字符");
  return value;
}
function relative(value) {
  if (typeof value !== "string" || value.length > 2048 || value.startsWith("/") || /[\\\x00-\x1f]/.test(value) || value.split("/").some(part => [".", ".."].includes(part))) throw new PublicError("请选择允许范围内的飞牛目录");
  return value.split("/").filter(Boolean).join("/");
}
function parseRequest(body) {
  const fid = value => typeof value === "string" && /^[\w-]{1,128}$/.test(value);
  if (!body || !/^[a-zA-Z0-9]{1,128}$/.test(body.shareCode || "") || !fid(body.parentId) || !fid(body.folderId)) throw new PublicError("分享或目录参数无效");
  if (!Array.isArray(body.selectedIds) || !body.selectedIds.length || body.selectedIds.length > 500 || !body.selectedIds.every(fid) || new Set(body.selectedIds).size !== body.selectedIds.length) throw new PublicError("请明确勾选 1 至 500 个不同资源");
  if (typeof body.intent !== "string" || !/^[\w-]{8,100}$/.test(body.intent)) throw new PublicError("操作标识无效，请重新打开转存窗口");
  if (typeof body.target?.rootId !== "string") throw new PublicError("请选择飞牛保存位置");
  const passcode = body.passcode || "", shareToken = body.shareToken || "";
  if (typeof passcode !== "string" || passcode.length > 64 || typeof shareToken !== "string" || shareToken.length > 8192 || /[\x00-\x1f]/.test(passcode + shareToken)) throw new PublicError("分享凭据无效");
  const renames = Array.isArray(body.renames) ? body.renames : [];
  if (renames.length > body.selectedIds.length) throw new PublicError("重命名参数无效");
  const renameIds = new Set();
  const checkedRenames = renames.map(row => {
    if (!row || !body.selectedIds.includes(row.sourceFileId) || renameIds.has(row.sourceFileId)) throw new PublicError("重命名必须对应当前勾选资源");
    renameIds.add(row.sourceFileId);
    return { sourceFileId: row.sourceFileId, targetName: filename(row.targetName?.trim()) };
  });
  return { shareCode: body.shareCode, parentId: body.parentId, folderId: body.folderId, selectedIds: [...body.selectedIds], intent: body.intent, target: { rootId: body.target.rootId, relativePath: relative(body.target.relativePath) }, title: typeof body.title === "string" ? body.title.slice(0, 512) : "本次转存下载", passcode, shareToken, renames: checkedRenames };
}

class Directories {
  constructor(roots) {
    this.roots = roots || (process.env.DOWNLOAD_ROOTS_JSON ? JSON.parse(process.env.DOWNLOAD_ROOTS_JSON) : [{ id: "media", label: "飞牛影视", browse: "/downloads", aria: "/downloads" }]);
    if (!Array.isArray(this.roots) || !this.roots.length || this.roots.some(root => !/^[\w-]+$/.test(root.id) || !path.isAbsolute(root.browse) || !path.posix.isAbsolute(root.aria))) throw new Error("飞牛目录配置无效");
  }
  list() { return this.roots.map(({ id, label }) => ({ id, label })); }
  async resolve(target) {
    const root = this.roots.find(row => row.id === target.rootId);
    if (!root) throw new PublicError("飞牛存储位置不存在");
    const local = relative(target.relativePath);
    let base, actual;
    try { base = await fs.realpath(root.browse); actual = await fs.realpath(path.join(base, local)); if (!(await fs.stat(actual)).isDirectory()) throw new Error(); }
    catch { throw new PublicError("飞牛目录不存在或没有访问权限"); }
    const suffix = path.relative(base, actual);
    if (suffix === ".." || suffix.startsWith("../") || path.isAbsolute(suffix)) throw new PublicError("飞牛目录超出允许范围");
    return { browse: actual, aria: path.posix.join(root.aria, suffix.split(path.sep).join("/")), relativePath: local };
  }
  async children(target) {
    const result = await this.resolve(target);
    const entries = await fs.readdir(result.browse, { withFileTypes: true });
    return { relativePath: result.relativePath, items: entries.filter(item => item.isDirectory() && !item.isSymbolicLink()).sort((a, b) => a.name.localeCompare(b.name, "zh-CN")).slice(0, 1000).map(item => ({ name: item.name, relativePath: path.posix.join(result.relativePath, item.name) })) };
  }
  async create(target, name) {
    if (!target || typeof target.rootId !== "string") throw new PublicError("请先选择飞牛保存目录");
    const checked = filename(typeof name === "string" ? name.trim() : name);
    if (Buffer.byteLength(checked, "utf8") > 240) throw new PublicError("文件夹名称过长，请缩短后重试");
    const location = await this.resolve(target), root = this.roots.find(row => row.id === target.rootId);
    const owner = await fs.stat(await fs.realpath(root.browse));
    const destination = path.join(location.browse, checked);
    try { await fs.mkdir(destination, { mode: 0o775 }); }
    catch (error) {
      if (error.code === "EEXIST") throw new PublicError("该名称已经存在，请更换名称", 409);
      if (error.code === "ENOSPC") throw new PublicError("飞牛磁盘空间不足", 507);
      throw new PublicError("无法创建飞牛文件夹，请检查目录权限", 403);
    }
    // Set ownership only on the newly created directory, matching the mounted
    // NAS root owner used by the aria2 service. Never chown existing media.
    try {
      const info = await fs.stat(destination);
      if (info.uid !== owner.uid || info.gid !== owner.gid) await fs.chown(destination, owner.uid, owner.gid);
    } catch { throw new PublicError("文件夹已创建，但权限设置失败，请检查服务配置", 500); }
    return { name: checked, rootId: target.rootId, relativePath: path.posix.join(location.relativePath, checked) };
  }
  async checkFile(base, file) {
    let current = base;
    const parts = relative(file).split("/");
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, filename(parts[i]));
      let info;
      try { info = await fs.lstat(current); } catch (error) { if (error.code === "ENOENT") return; throw new PublicError("无法检查飞牛文件位置"); }
      if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile())) throw new PublicError("飞牛目录包含符号链接或同名类型冲突，请更换位置");
    }
  }
}

class Aria {
  constructor(axios, endpoint = process.env.ARIA2_RPC_URL, secret = process.env.ARIA2_RPC_SECRET) { this.axios = axios; this.endpoint = endpoint; this.secret = secret; }
  async call(method, args = [], missing = false) {
    if (!this.endpoint || !this.secret) throw new PublicError("尚未配置 aria2 下载服务", 503);
    let response;
    try { response = await this.axios.post(this.endpoint, { jsonrpc: "2.0", id: "clouddock", method, params: ["token:" + this.secret, ...args] }, { timeout: 12000, proxy: false, maxRedirects: 0, validateStatus: value => value === 200 || value === 400 }); }
    catch { throw new PublicError("aria2 暂时无法连接，请稍后重试", 503); }
    const body = response.data;
    if (body?.error) { if (missing && /not found|not exist/i.test(body.error.message || "")) return null; throw new PublicError("aria2 未接受请求，请检查配置或下载状态", 502); }
    if (body?.result === undefined) throw new PublicError("aria2 返回无效响应", 502);
    return body.result;
  }
  async health() { return { connected: true, version: (await this.call("aria2.getVersion")).version }; }
  status(gid) { return this.call("aria2.tellStatus", [gid, ["gid", "status", "completedLength", "totalLength", "errorCode"]], true); }
  async add(file, url, cookie, userAgent, directory) {
    const known = await this.status(file.gid);
    if (known) return known;
    const parts = file.path.split("/");
    const gid = await this.call("aria2.addUri", [[url], { gid: file.gid, dir: path.posix.join(directory, ...parts.slice(0, -1)), out: parts.at(-1), header: ["Cookie: " + cookie, "User-Agent: " + userAgent], continue: "true", "auto-file-renaming": "false", "allow-overwrite": "false" }]);
    if (gid !== file.gid) throw new PublicError("下载标识不匹配，停止处理", 502);
    return { status: "waiting" };
  }
}

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/3.14.2 Chrome/112.0.5615.165 Electron/24.1.3.8 Safari/537.36";
class Quark {
  // Reuse the NAS v0.8.3 QuarkService instance, per-user cookie loading and proxy.
  constructor(service) { this.service = service; }
  async request(method, url, values) {
    let response;
    try { response = await this.service.api.request({ method, url, headers: { "User-Agent": USER_AGENT }, params: { pr: "ucpro", fr: "pc", ...(method === "GET" ? values : {}) }, data: method === "POST" ? values : undefined, timeout: 30000, maxRedirects: 0 }); }
    catch { throw new PublicError("夸克请求未确认，请检查网络及本次执行记录", 502); }
    if ((response.data?.code !== 0 && response.data?.status !== 200) || !response.data?.data) throw new PublicError("夸克未接受请求，请检查 Cookie、分享或容量", 502);
    const cookies = response.headers["set-cookie"];
    if (Array.isArray(cookies)) {
      const values = new Map(this.service.cookie.split(";").map(part => { const i = part.indexOf("="); return [part.slice(0, i).trim(), part.slice(i + 1)]; }));
      for (const item of cookies) { const value = item.split(";")[0], i = value.indexOf("="); if (i > 0) values.set(value.slice(0, i), value.slice(i + 1)); }
      this.service.cookie = [...values].map(([key, value]) => key + "=" + value).join("; ");
    }
    return response.data;
  }
  async token(request) { return request.shareToken || (await this.request("POST", "/1/clouddrive/share/sharepage/token", { pwd_id: request.shareCode, passcode: request.passcode })).data.stoken; }
  async list(url, params) {
    const entries = [], seen = new Set();
    for (let page = 1; page <= 2000; page++) {
      const result = await this.request("GET", url, { ...params, _page: page, _size: 100, _fetch_total: 1, _sort: "file_type:asc,file_name:asc" });
      if (!Array.isArray(result.data.list)) throw new PublicError("夸克目录响应无效", 502);
      let added = 0;
      for (const item of result.data.list) {
        if (!item.fid || seen.has(String(item.fid))) continue;
        seen.add(String(item.fid)); added++;
        entries.push({ fid: String(item.fid), name: filename(item.file_name), directory: Boolean(item.dir ?? item.file_type === 0), size: Number(item.size || 0), hash: item.sha1 || "", token: item.share_fid_token });
      }
      const total = Number(result.metadata?._total);
      if (!added || !result.data.list.length || Number.isFinite(total) && entries.length >= total) return entries;
    }
    throw new PublicError("目录过大，请缩小选择范围");
  }
  share(request, token, parent) { return this.list("/1/clouddrive/share/sharepage/detail", { pwd_id: request.shareCode, stoken: token, pdir_fid: parent, force: 0 }); }
  own(parent) { return this.list("/1/clouddrive/file/sort", { pdir_fid: parent, _fetch_sub_dirs: 0, fetch_all_file: 1 }); }
  async save(items, parent, request, token) {
    if (items.some(item => !item.token)) throw new PublicError("资源转存凭据已失效，请重新打开分享");
    const result = await this.service.saveSharedFile({ fids: items.map(item => item.fid), fidTokens: items.map(item => item.token), folderId: parent, shareCode: request.shareCode, receiveCode: token });
    if (!result.data?.task_id) throw new PublicError("无法确认转存任务，请先检查云盘结果", 502);
    return String(result.data.task_id);
  }
  async wait(task) {
    for (let retry = 0; retry < 120; retry++) {
      const { data } = await this.request("GET", "/1/clouddrive/task", { task_id: task, retry_index: retry });
      if (data.status === 2) { if (!Array.isArray(data.save_as?.save_as_top_fids)) throw new PublicError("转存结果无法确认", 502); return data.save_as.save_as_top_fids.map(String); }
      if (![0, 1].includes(data.status)) throw new PublicError("夸克转存失败", 502);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new PublicError("转存仍在处理中，请稍后查看记录", 504);
  }
  async rename(fid, name) { await this.service.renameFile(fid, name); }
  async download(fid) {
    const result = await this.request("POST", "https://drive-pc.quark.cn/1/clouddrive/file/download", { fids: [fid] });
    if (!Array.isArray(result.data) || result.data.length !== 1 || result.data[0].fid && String(result.data[0].fid) !== fid) throw new PublicError("下载文件与所选资源不匹配", 502);
    const url = new URL(result.data[0].download_url);
    if (url.protocol !== "https:") throw new PublicError("下载链接协议无效", 502);
    return { url: url.href, cookie: this.service.cookie };
  }
}

async function plan(client, request, checkpoint, phase) {
  for (const task of request.tasks || []) await client.wait(task);
  const token = await client.token(request), source = await client.share(request, token, request.parentId), byId = new Map(source.map(item => [item.fid, item]));
  const wanted = request.selectedIds.map(id => byId.get(id));
  if (!wanted.length || wanted.some(item => !item)) throw new PublicError("勾选项已经变化，请重新选择");
  const renames = new Map((request.renames || []).map(row => [row.sourceFileId, row.targetName]));
  const files = []; let visited = 0;
  async function walk(items, parent, names, depth) {
    if (depth > 40 || (visited += items.length) > 20000) throw new PublicError("资源数量过多，请分批选择");
    let destination = await client.own(parent);
    const matched = new Map(), missing = [];
    for (const item of items) {
      const renamed = renames.get(item.fid) || item.name;
      filename(item.name); filename(renamed);
      const entries = destination.filter(row => row.name === renamed || row.name === item.name);
      if (entries.length > 1 || entries.length && entries[0].directory !== item.directory) throw new PublicError("夸克目标有同名冲突，请更换保存目录");
      if (!entries.length) { missing.push(item); continue; }
      const match = entries[0];
      if (!item.directory && (match.size !== item.size || item.hash && match.hash && item.hash !== match.hash)) throw new PublicError("夸克目标存在不同内容的同名文件");
      matched.set(item.fid, match);
    }
    for (let i = 0; i < missing.length; i += 100) {
      await phase("saving");
      const batch = missing.slice(i, i + 100), task = await client.save(batch, parent, request, token);
      await checkpoint(task); await phase("waiting_cloud");
      const ids = new Set(await client.wait(task));
      if (ids.size !== batch.length) throw new PublicError("转存结果数量不符，停止下载");
      destination = await client.own(parent);
      for (const item of batch) {
        const matches = destination.filter(row => ids.has(row.fid) && row.name === item.name && row.directory === item.directory);
        if (matches.length !== 1) throw new PublicError("无法准确定位本次转存资源，停止下载");
        matched.set(item.fid, matches[0]);
      }
    }
    for (const item of items) {
      const saved = matched.get(item.fid), finalName = renames.get(item.fid) || item.name;
      if (saved.name !== finalName) {
        await phase("renaming"); await client.rename(saved.fid, finalName);
        if (!(await client.own(parent)).some(row => row.fid === saved.fid && row.name === finalName)) throw new PublicError("夸克重命名结果未确认，停止下载");
      }
      const next = [...names, finalName];
      if (item.directory) await walk(await client.share(request, token, item.fid), saved.fid, next, depth + 1);
      else files.push({ fid: saved.fid, path: next.join("/"), size: item.size });
    }
  }
  await walk(wanted, request.folderId, [], 0);
  return files;
}
module.exports = { PublicError, filename, relative, parseRequest, Directories, Aria, Quark, plan, USER_AGENT };
