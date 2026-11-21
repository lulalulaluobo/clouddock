const { PublicError } = require('./core.cjs');

function createPanSouRouter(express, pansou, User) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    try {
      if (!req.user?.userId) return res.status(401).json({ success: false, message: '请先登录' });
      const user = await User.findOne({ where: { userId: req.user.userId } });
      if (!user) return res.status(401).json({ success: false, message: '请先登录' });
      req.panSouAdmin = user.role === 1; next();
    } catch { res.status(500).json({ success: false, message: '无法验证当前账号' }); }
  });
  const route = (work, admin = false) => async (req, res) => {
    if (admin && !req.panSouAdmin) return res.status(403).json({ success: false, message: '仅管理员可配置 PanSou' });
    try { res.json({ success: true, code: 0, data: await work(req) }); }
    catch (error) { const safe = error instanceof PublicError ? error : new PublicError('PanSou 请求失败', 500); res.status(safe.status).json({ success: false, code: safe.status, message: safe.message }); }
  };
  router.get('/config', route(() => pansou.publicConfig(), true));
  router.post('/config', route(req => pansou.save(req.body), true));
  router.get('/health', route(() => pansou.health(), true));
  router.post('/search', route(req => pansou.search(req.body?.keyword)));
  router.post('/check', route(req => pansou.check(req.body?.items)));
  return router;
}
module.exports = { createPanSouRouter };
