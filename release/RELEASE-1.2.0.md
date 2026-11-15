# CloudDock 1.2.0

发布日期：2026-11-15（Asia/Shanghai）。

- 镜像：`lulalulaluobo/clouddock:1.2.0`，同时更新 `latest`。
- 镜像 digest：`sha256:cb704e7a1e7eff3fea2c7244e40046fd39975aa4eab6f510e58e49378be83dc1`。
- 架构：`linux/amd64`，适用于 x86-64 NAS。
- Chrome 插件：下载发布附件中的 `clouddock-browser-extension-0.1.0-chrome.zip`，解压后在 Chrome 扩展程序页面以开发者模式加载。

## 更新

- 新增 Chrome 链接助手：点击夸克、百度分享链接或右键发送链接和选中文字，在 CloudDock“链接转存”自动填入。
- 链接中或附近的提取码能明确识别时一并填入；歧义时留空，支持手工修改。未登录时暂存本标签页，登录后恢复。
- 资源解析、勾选、网盘和飞牛目录选择继续使用 CloudDock 原有流程，不自动转存或下载。
- 保留 1.1.0 的飞牛官方百度网盘接入、夸克下载管理与链接转存功能。

## 使用与回滚

按 README 配置 Compose 和插件中的 CloudDock 地址。已有部署将 `.env` 中 `CLOUDDOCK_VERSION` 更新为 `1.2.0` 后拉取并重建应用。启用飞牛百度时，升级、重建仍需同时使用基础和百度两份 Compose 配置。

升级前备份 `.env`、`data`、`config` 与 `aria2-config`；需要回滚时使用 `1.1.0` 固定标签，并按需恢复对应数据备份。更新发布镜像不会自动替换 NAS 正在运行的实例。

## 验证

- 19 项网页、链接识别及可见性测试和 23 项镜像内后端测试通过；Compose 与 README 参数一致性检查通过。
- 独立空目录部署验证首次注册、登录、aria2、目录创建、RPC 密钥不向浏览器返回，以及重建后的配置和登录持久化。
- 使用模拟链接验证插件与 NAS 7003 的交接；用户已测试通过。未创建真实转存或下载任务。
