# CloudDock 1.1.0

发布日期：2026-10-26（Asia/Shanghai）。

- 镜像：`lulalulaluobo/clouddock:1.1.0`，同步更新 `latest`。
- 平台：`linux/amd64`，适用于 x86-64 NAS。
- 远程 digest：`sha256:fe23e36f3bd7a8747a6d69987f459e86effc7d77185e3070d537cd738012afdf`。
- amd64 清单：`sha256:c1f1596541688c1bc7e08a6c5ae4127f6e0acd884f2bf72c6dd5ac7ecd25d3c8`。

## 更新

- 新增“链接转存”：识别夸克、百度分享链接和提取码，复用资源选择、网盘目录及飞牛目录窗口。
- 内置飞牛官方百度网盘授权、转存和下载，无需独立适配服务；百度通过官方客户端下载，夸克继续使用 aria2。
- 百度文件夹仅展开所选子树，按文件提交下载并保留层级；已接受的任务保留进度，部分失败不会被误报为鉴权错误。
- 统一 CloudDock 品牌，移除旧更新弹窗、关于和赞赏入口；保留上游来源及许可证。
- 包含手机影片列表的懒加载、可见性监听和滚动性能优化，内置 AriaNg 及返回搜索入口。

## 部署

解压 `clouddock-1.1.0-compose.zip`，复制 `.env.example` 为 `.env`，按 README 填写目录、UID/GID、管理员注册码和 RPC 密钥。

通用部署：

```bash
docker compose config --quiet
docker compose pull
docker compose up -d
```

飞牛百度部署：先安装并登录同机飞牛官方百度网盘应用，填写 `BAIDU_NAS_UID`：

```bash
docker compose -f compose.yaml -f compose.baidu.yaml config --quiet
docker compose -f compose.yaml -f compose.baidu.yaml pull
docker compose -f compose.yaml -f compose.baidu.yaml up -d
```

随后在 CloudDock 设置中点击“获取飞牛百度网盘授权”。启用百度后，升级与重建必须继续使用两份配置。

## 验证与回滚

23 项后端测试、16 项网页/逻辑测试、Compose 参数检查通过。独立空目录验证首位管理员注册、登录、aria2、本地目录创建及应用重建后的配置持久化；未新增真实转存或下载任务。NAS 已从 Docker Hub 拉取并确认 x64 运行环境和所需模块齐全。

本次发布镜像没有切换 NAS 正在运行的 `clouddock-nas` / `clouddock-aria2`。生产继续使用已经验证的分发挂载版本。旧版固定镜像 `1.0.0` 保留；升级前备份持久化数据，数据库回滚需使用对应备份。
