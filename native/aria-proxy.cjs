const { PublicError } = require("./core.cjs");
const readMethods = ["getVersion", "getSessionInfo", "getGlobalStat", "getGlobalOption", "getOption", "getFiles", "getUris", "getPeers", "getServers", "tellStatus", "tellActive", "tellWaiting", "tellStopped"];
const taskMethods = ["pause", "forcePause", "unpause", "remove", "forceRemove", "removeDownloadResult", "changePosition", "changeOption"];
const methods = new Set([...readMethods, ...taskMethods, "pauseAll", "forcePauseAll", "unpauseAll", "purgeDownloadResult", "changeGlobalOption", "saveSession"].map(name => "aria2." + name));
const globalOptions = new Set(["max-concurrent-downloads", "max-overall-download-limit", "max-overall-upload-limit", "max-download-limit", "max-upload-limit"]);
const taskOptions = new Set(["max-download-limit", "max-upload-limit", "max-connection-per-server", "split", "select-file", "bt-max-peers", "seed-ratio", "seed-time"]);
const systems = ["system.multicall", "system.listMethods", "system.listNotifications"];

function parameters(method, params, secret, nested = false) {
  if (!Array.isArray(params) || params.length > 4) throw new PublicError("下载控制参数无效");
  if (method === "system.multicall") {
    if (nested || params.length !== 1 || !Array.isArray(params[0]) || !params[0].length || params[0].length > 50) throw new PublicError("批量下载控制参数无效");
    return [params[0].map(call => {
      if (!call || typeof call.methodName !== "string") throw new PublicError("批量下载控制参数无效");
      return { methodName: call.methodName, params: parameters(call.methodName, call.params || [], secret, true) };
    })];
  }
  if (["system.listMethods", "system.listNotifications"].includes(method)) {
    if (params.length) throw new PublicError("下载控制参数无效");
    return [];
  }
  if (!methods.has(method)) throw new PublicError("此入口用于管理下载进度；新增任务或失败重试请通过 CloudDock 转存入口操作", 403);
  if (params.some(value => typeof value === "string" && value.startsWith("token:"))) throw new PublicError("无需提供 aria2 密钥");
  const name = method.slice(6);
  if ([...taskMethods, "getOption", "getFiles", "getUris", "getPeers", "getServers", "tellStatus"].includes(name) && !/^[a-fA-F0-9]{16}$/.test(params[0] || "")) throw new PublicError("下载任务标识无效");
  if (["tellWaiting", "tellStopped"].includes(name) && (!Number.isInteger(params[0]) || Math.abs(params[0]) > 1000000 || !Number.isInteger(params[1]) || params[1] < 0 || params[1] > 1000)) throw new PublicError("下载列表查询范围无效");
  if (["changeOption", "changeGlobalOption"].includes(name)) {
    const options = params[name === "changeOption" ? 1 : 0], allowed = name === "changeOption" ? taskOptions : globalOptions;
    if (!options || typeof options !== "object" || Array.isArray(options) || !Object.keys(options).length) throw new PublicError("下载选项无效");
    for (const [key, value] of Object.entries(options)) {
      if (!allowed.has(key) || typeof value !== "string" || value.length > 1024 || !(key === "select-file" ? /^[\d,\-\s]+$/ : /^\d+(?:\.\d+)?[KMG]?$/i).test(value)) throw new PublicError("此处仅支持调整下载速度、连接数量和文件选择");
    }
  }
  if (name === "changePosition" && (!Number.isInteger(params[1]) || Math.abs(params[1]) > 1000000 || !["POS_SET", "POS_CUR", "POS_END"].includes(params[2]))) throw new PublicError("下载排序参数无效");
  return ["token:" + secret, ...params];
}
function prepare(body, secret) {
  if (JSON.stringify(body || {}).length > 65536) throw new PublicError("下载控制请求过大", 413);
  const one = request => {
    if (!request || request.jsonrpc !== "2.0" || !["string", "number"].includes(typeof request.id) || String(request.id).length > 128 || typeof request.method !== "string") throw new PublicError("下载控制请求无效");
    return { jsonrpc: "2.0", id: request.id, method: request.method, params: parameters(request.method, request.params || [], secret) };
  };
  if (!Array.isArray(body)) return one(body);
  if (!body.length || body.length > 50) throw new PublicError("批量下载控制请求过大");
  return body.map(one);
}
function redact(value, secret) {
  if (Array.isArray(value)) return value.map(item => redact(item, secret));
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) continue;
      if (/secret|passwd|password|authorization|cookie|proxy-user|http-user/i.test(key)) result[key] = "";
      else if (key === "header") result[key] = [];
      else if (key === "message" && value.code !== undefined) result[key] = "aria2 未能完成操作，请检查任务状态";
      else result[key] = redact(child, secret);
    }
    return result;
  }
  return typeof value === "string" && secret ? value.split(secret).join("[已隐藏]") : value;
}
function createRpcHandler(rpc) {
  return async (req, res) => {
    try {
      if (!rpc.endpoint || !rpc.secret) throw new PublicError("尚未配置 aria2 下载服务", 503);
      const body = prepare(req.body, rpc.secret);
      let response;
      try { response = await rpc.axios.post(rpc.endpoint, body, { timeout: 12000, proxy: false, maxRedirects: 0, validateStatus: status => status === 200 || status === 400 }); }
      catch { throw new PublicError("aria2 暂时无法连接，请稍后重试", 503); }
      const data = response.data;
      if (!data || typeof data !== "object") throw new PublicError("aria2 返回无效响应", 502);
      res.set("Cache-Control", "no-store").json(redact(data, rpc.secret));
    } catch (error) {
      const safe = error instanceof PublicError ? error : new PublicError("下载控制请求未能完成", 500);
      res.status(safe.status).json({ jsonrpc: "2.0", id: typeof req.body?.id === "string" || typeof req.body?.id === "number" ? req.body.id : null, error: { code: -32000, message: safe.message } });
    }
  };
}
module.exports = { createRpcHandler, prepare, redact };
