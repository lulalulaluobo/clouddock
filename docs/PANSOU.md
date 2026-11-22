# PanSou 搜索源

PanSou 作为独立服务，通过容器内网提供搜索和链接检测。CloudDock 原有频道、资源选择和转存流程保持可用；搜索栏可选择“原有频道”“全部来源”或“PanSou”。该功能自 CloudDock **1.3.0** 起内置在正式镜像中；旧版 `1.2.0` 及更早镜像不包含此功能。

## Compose 启动

准备基础 Compose 所需的 `.env` 和数据目录，将 `.env` 中的 `CLOUDDOCK_VERSION` 设置为 `1.3.0`（或更新版本），放置 `compose.pansou.yaml` 后启动：

```bash
docker compose -f compose.yaml -f compose.pansou.yaml --env-file .env config --quiet
docker compose -f compose.yaml -f compose.pansou.yaml pull
docker compose -f compose.yaml -f compose.pansou.yaml up -d
```

飞牛百度用户同时带上百度覆盖配置：

```bash
docker compose -f compose.yaml -f compose.baidu.yaml -f compose.pansou.yaml --env-file .env config --quiet
docker compose -f compose.yaml -f compose.baidu.yaml -f compose.pansou.yaml pull
docker compose -f compose.yaml -f compose.baidu.yaml -f compose.pansou.yaml up -d
```

之后更新或重建也需要带上同样的 `-f` 参数。覆盖配置中的 PanSou 不映射宿主机端口，自带容器健康检查与日志体积限制；镜像固定到已验证的 digest，默认启用影视搜索插件 `meitizy,jutoushe,duoduo`，可在 `.env` 用 `PANSOU_PLUGINS` 覆盖。PanSou 插件搜索第三方站点，结果数量和响应时间取决于站点可用性。CloudDock 仅展示夸克和百度网盘链接，并按标题过滤明确标记为小说或电子书的结果；标题无法可靠标识的资源仍可能混入。

## CloudDock 设置

管理员进入“设置 → PanSou 搜索源”，启用服务并填写 CloudDock 容器能够访问的地址。使用上述 Compose 时默认是 `http://pansou:8888`。如果 PanSou 开启认证，可填写已有的访问令牌；留空会保留已保存的令牌。点击“保存 PanSou 设置”，再点击“检测连接”。令牌只保存在 CloudDock 的 `config` 目录中，不会回显；备份时应保护该目录。

PanSou 默认只搜索插件来源，避免与 CloudDock 原有 Telegram 频道重复。选择“全部来源”时两者并行，PanSou 不可用不会阻断原有频道。PanSou 插件可能在首次响应后继续后台搜索；CloudDock 会在当前搜索仍打开时延后刷新两次，也可稍后再次搜索。

搜索结果中可见的夸克和百度链接使用 PanSou 检测接口；原有类型继续沿用上游检测。设置里的“开启资源链接有效性监测”控制自动检测。检测结果仅供参考：有效、失效、需要提取码和暂时无法确认分别处理，不确定的链接仍可尝试转存。

## 测试

```bash
python3 scripts/prepare-web.py
node --test tests/pansou.test.cjs tests/web.test.cjs tests/share-link.test.cjs tests/visibility.test.cjs
docker build --platform linux/amd64 --build-arg CLOUDDOCK_VERSION=1.3.0 -t lulalulaluobo/clouddock:1.3.0 .
python3 tests/pansou-compose-smoke.py
```

`tests/pansou-browser.cjs` 使用 Playwright 在模拟接口下测试桌面和手机页面，不执行真实转存或下载；需要在测试环境提供 Playwright。
