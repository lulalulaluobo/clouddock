# CloudDock 1.3.0

发布日期：2026-11-22（Asia/Shanghai）。

- 镜像：`lulalulaluobo/clouddock:1.3.0`，同时更新 `latest`。
- 镜像 digest：`sha256:8d3aa524258327e67277f4e1c66d2f16e5bd3cffbe02de2074a1ddfbff71d9fb`。
- 架构：`linux/amd64`，适用于 x86-64 NAS。
- Chrome 插件：沿用 `clouddock-browser-extension-0.1.0-chrome.zip`（发布附件附带），解压后在 Chrome 扩展程序页面以开发者模式加载。

## 更新

- 正式内置 PanSou 影视搜索与链接有效性检测：配合 `compose.pansou.yaml` 启动独立 PanSou 容器，支持在搜索栏选择“原有频道”“全部来源”或“PanSou”，并自动检测可见的夸克和百度链接有效性；PanSou 故障不阻断原有频道。
- 补充 `aria2` 和 `pansou` 容器健康检查：`compose.yaml` 中 `app` 改为等待 `aria2` 健康（`condition: service_healthy`）再启动，健康检查不传递任何 RPC 密钥；`compose.pansou.yaml` 通过内网 `/api/health` 检查 PanSou 服务状态。
- 限制容器日志体积：为 `app`、`aria2`、`pansou` 统一配置 Docker `json-file` 日志轮转（单文件上限 `10m`，最多保留 `3` 份），避免 NAS 长期运行日志持续膨胀。
- 自动清理过期转存记录：夸克与飞牛百度转存作业在启动时及运行期间定期自动清理超过 30 天且处于已完成或失败状态的旧记录，保留 30 天内记录及所有排队、下载中或暂停的任务。
- 保留 1.2.0 的 Chrome 链接助手、飞牛官方百度网盘接入、夸克下载管理、内置 AriaNg 与链接转存功能。

## 使用与回滚

按 README 配置基础 `compose.yaml` 和 `.env`；按需合用 `compose.baidu.yaml` 和 `compose.pansou.yaml`。已有部署将 `.env` 中 `CLOUDDOCK_VERSION` 更新为 `1.3.0`，同步 Compose 文件中的健康检查和日志配置后拉取并重建服务。启用飞牛百度或 PanSou 时，升级和重建必须继续带上对应的 `-f` 覆盖文件。

升级前备份 `.env`、`data`、`config` 与 `aria2-config`；需要回滚时将版本改回 `1.2.0` 固定标签，并按需恢复对应数据备份。更新发布镜像不会自动替换 NAS 正在运行的实例。

## 验证

- 25 项宿主机测试（PanSou、网页、分享链接、浏览器扩展、百度原生与可见性）、30 项镜像内后端测试（含夸克与百度 30 天记录清理、鉴权、RPC 密钥脱敏）以及 Compose 与 README 三份 YAML 一致性检查全部通过。
- 独立空目录基础 Compose 验证首次注册、登录、aria2 健康检查及依赖等待、日志轮转配置、本地目录创建、RPC 密钥不向浏览器返回，以及重建后的 JWT 密钥和登录持久化。
- 独立 PanSou 联合 Compose 验证 `app` / `aria2` / `pansou` 三容器健康检查和日志轮转、内网健康检测、鉴权及搜索返回格式。全过程未创建真实转存或下载任务，未改动 NAS 正在运行的实例。
