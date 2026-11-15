const { PublicError } = require("./core.cjs");
const { createRpcHandler } = require("./aria-proxy.cjs");
function createRouter(express, service, User, baidu) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    try { const user = req.user && await User.findOne({ where: { userId: req.user.userId } }); if (!user || user.role !== 1) { res.status(403).json({ success: false, code: 403, message: "飞牛下载仅对管理员开放" }); return; } next(); }
    catch { res.status(500).json({ success: false, code: 500, message: "无法验证当前账号" }); }
  });
  function route(work, status = 200) { return async (req, res) => { try { res.status(status).json({ success: true, code: 0, data: await work(req) }); } catch (error) { const safe = error instanceof PublicError ? error : new PublicError("请求未能完成，请稍后重试", 500); res.status(safe.status).json({ success: false, code: safe.status, message: safe.message }); } }; }
  router.get("/health", route(async () => { let aria; try { aria = await service.rpc.health(); } catch (error) { aria = { connected: false, message: error instanceof PublicError ? error.message : "无法连接 aria2，请检查下载服务是否运行" }; } return { service: "CloudDock", baseVersion: "0.8.3", aria2: aria }; }));
  router.post('/quark/share', route(async req => {
    const shareCode = req.body?.shareCode, passcode = req.body?.receiveCode || '';
    if (typeof shareCode !== 'string' || !/^[A-Za-z0-9]{1,128}$/.test(shareCode) || typeof passcode !== 'string' || !/^[A-Za-z0-9]{0,4}$/.test(passcode)) throw new PublicError('分享链接或提取码无效');
    const client = await service.clientForUser(req.user.userId), request = { shareCode, passcode };
    const token = await client.token(request), rows = await client.share(request, token, '0');
    return { pwdId: shareCode, shareCode, stoken: token, list: rows.map(row => ({ fileId: row.fid, fileIdToken: row.token, fileName: row.name, isFolder: row.directory, fileSize: row.size })) };
  }));
  if (baidu) {
    router.get('/baidu/health', route(req => baidu.health(req.user.userId)));
    let pairingAt = 0;
    router.post('/baidu/authorize', route(req => { if (Date.now() - pairingAt < 2000) throw new PublicError('请稍后重试', 429); pairingAt = Date.now(); return baidu.authorize(); }));
    router.post('/baidu/share', route(req => baidu.call('/share', req.user.userId, { shareCode: req.body?.shareCode, receiveCode: req.body?.receiveCode || req.body?.shareInfo?.receiveCode || '', parentId: req.body?.pdirFid || '/' })));
    router.get('/baidu/folders', route(req => baidu.call('/folders', req.user.userId, { parentId: req.query.parentCid || '/' })));
    router.post('/baidu/create-folder', route(req => baidu.call('/mkdir', req.user.userId, { parentId: req.body?.parentFid, name: req.body?.folderName })));
    router.get('/baidu/jobs', route(req => baidu.call('/list', req.user.userId)));
    router.post('/baidu/jobs', route(async req => {
      if (req.body?.download !== false) await service.paths.resolve(req.body?.target || {});
      return baidu.call('/jobs', req.user.userId, req.body);
    }, 202));
  }
  router.post("/rpc", createRpcHandler(service.rpc));
  router.get("/roots", route(async () => service.paths.list()));
  router.get("/directories", route(req => service.paths.children({ rootId: String(req.query.rootId || "media"), relativePath: String(req.query.path || "") })));
  router.post("/directories", route(req => service.paths.create(req.body?.target, req.body?.name), 201));
  router.get("/jobs", route(req => service.list(req.user.userId)));
  router.post("/jobs", route(req => service.create(req.user.userId, req.body), 202));
  router.post("/jobs/:id/:operation", route(req => service.action(req.user.userId, req.params.id, req.params.operation)));
  return router;
}
module.exports = { createRouter };
