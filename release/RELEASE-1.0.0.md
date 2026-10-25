# CloudDock 1.0.0 发布记录

发布日期：2026-10-24（Asia/Shanghai）。

- Docker Hub：https://hub.docker.com/r/lulalulaluobo/clouddock
- 固定版本：`lulalulaluobo/clouddock:1.0.0`
- 同步标签：`lulalulaluobo/clouddock:latest`
- 目标平台：`linux/amd64`（x86-64 NAS），不含 ARM64 运行镜像。
- 两个标签的远程 digest：`sha256:f65dea447b87802a679d1d7f821527872a3a975477cd3dbed8d37813be21efec`
- amd64 子清单：`sha256:3444b5b259bfbd3adbc07b6d5786ac0cbe07b5c06e753b3f848dfabcc3b02299`
- 基础应用：NAS 实际 CloudSaver v0.8.3 固定 digest；内置 AriaNg。

## 校验

- 14 项后端测试和 4 项网页构建检查通过。
- 使用正式镜像和根目录 Compose，在独立空数据目录部署成功；完成首位管理员注册及登录。
- 验证 aria2 v1.36.0 连接、本地目录新建、登录鉴权、批量 RPC 查询及密钥脱敏。
- 强制重建应用容器后，JWT 配置、账号和已有登录继续有效。
- 验证过程中未创建资源转存或媒体下载任务。
- NAS 从 Docker Hub 成功拉取 1.0.0，实际运行检查返回 `process.arch=x64`；后端、原 QuarkService 和 AriaNg 静态文件齐全。
- Docker Hub 中文 README 已同步，并与本地 README 逐字符回读比对一致。

当前 NAS 的 `clouddock-nas` / `clouddock-aria2` 保持原部署运行，没有自动切换到正式镜像。原 CloudSaver 7000 服务未修改。

## 使用

解压 `clouddock-1.0.0-compose.zip`，按 README 填写 `.env` 后执行：

```bash
docker compose --env-file .env config --quiet
docker compose pull
docker compose up -d
```

需固定不可变内容时，可把 Compose 应用镜像写成：

```text
lulalulaluobo/clouddock@sha256:f65dea447b87802a679d1d7f821527872a3a975477cd3dbed8d37813be21efec
```

回滚现有 NAS 测试部署时可继续使用其原 `deploy/compose.yaml` 方案及原持久化目录；发布镜像本身没有覆盖这些文件。后续正式升级应记录旧的固定版本并备份数据，不能依赖 `latest` 判断回滚版本。
