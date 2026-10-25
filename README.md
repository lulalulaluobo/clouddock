# CloudDock

搜索资源、转存夸克，再自动通过 aria2 下载到 NAS。基于 NAS 实际运行的 **CloudSaver v0.8.3**，内置 AriaNg，保留原有搜索、频道管理和转存窗口。不依赖 QAS，不创建定时追更任务。

镜像：[`lulalulaluobo/clouddock:1.0.0`](https://hub.docker.com/r/lulalulaluobo/clouddock)。架构：**linux/amd64（x86-64 NAS）**，目前未发布原生 ARM64 镜像。生产建议固定具体版本；`latest` 跟随最新发布。

## 两个容器，一份 Compose

| 服务 | 内容 | 端口 |
| --- | --- | --- |
| `app` | CloudDock 后端、网页、内置 AriaNg | 宿主机 `7003` → 容器 `8008` |
| `aria2` | 实际下载引擎 | `6800` 仅容器内网使用 |

不需要单独部署 AriaNg，不需要映射 6880 或 RPC 端口。网页自动连接本套 Compose 的 aria2，RPC 密钥留在后端。本地下载及下载管理目前对管理员开放。

## Docker Compose 部署

在 NAS 创建一个应用目录，把下面的 `compose.yaml` 和 `.env` 放进去。飞牛可在 Docker → Compose 中新建项目；命令行也可使用：

```bash
mkdir -p /你的应用目录/clouddock
cd /你的应用目录/clouddock
mkdir -p data config logs aria2-config
# 在此目录保存下面的 compose.yaml 和 .env
# 有项目文件时，也可 cp .env.example .env 后修改
```

### 1. compose.yaml

```yaml
name: clouddock
services:
  app:
    image: lulalulaluobo/clouddock:${CLOUDDOCK_VERSION:-1.0.0}
    platform: linux/amd64
    restart: unless-stopped
    ports:
      - "${BIND_IP:-0.0.0.0}:${APP_PORT:-7003}:8008"
    environment:
      TZ: ${TZ:-Asia/Shanghai}
      NODE_ENV: production
      ADMIN_USER_CODE: ${ADMIN_USER_CODE:?请设置 ADMIN_USER_CODE}
      JWT_SECRET: ${JWT_SECRET:-}
      JWT_EXPIRES_IN: ${JWT_EXPIRES_IN:-7d}
      ARIA2_RPC_URL: http://aria2:6800/jsonrpc
      ARIA2_RPC_SECRET: ${ARIA2_RPC_SECRET:?请设置 ARIA2_RPC_SECRET}
      TELE_CHANNELS: ${TELE_CHANNELS:-[]}
      TG_BOT_TOKEN: ""
    volumes:
      - ./data:/app/data
      - ./config:/app/config
      - ./logs:/app/logs
      - ${NAS_DOWNLOAD_PATH:?请设置 NAS_DOWNLOAD_PATH}:/downloads
    depends_on:
      aria2:
        condition: service_started
  aria2:
    image: p3terx/aria2-pro@sha256:086d1a37c586edb07ec0fb956bf9edd89d1d38d138ad5309ff96d510c8c9a011
    platform: linux/amd64
    restart: unless-stopped
    environment:
      TZ: ${TZ:-Asia/Shanghai}
      PUID: ${PUID:-1000}
      PGID: ${PGID:-1001}
      RPC_SECRET: ${ARIA2_RPC_SECRET:?请设置 ARIA2_RPC_SECRET}
      RPC_PORT: "6800"
      UMASK_SET: "022"
      UPDATE_TRACKERS: "false"
      IPV6_MODE: "false"
    volumes:
      - ./aria2-config:/config
      - ${NAS_DOWNLOAD_PATH:?请设置 NAS_DOWNLOAD_PATH}:/downloads
```

### 2. .env

复制以下内容，至少修改 **NAS_DOWNLOAD_PATH、PUID、PGID、ADMIN_USER_CODE、ARIA2_RPC_SECRET**：

```dotenv
CLOUDDOCK_VERSION=1.0.0
BIND_IP=0.0.0.0
APP_PORT=7003
TZ=Asia/Shanghai

# NAS 实际下载目录，必须已存在且下载用户可写
NAS_DOWNLOAD_PATH=/vol3/1000/2T/飞牛影视
PUID=1000
PGID=1001

# 自己设置 6～12 位数字，仅用于首次注册管理员，不是登录密码
ADMIN_USER_CODE=把这里改成你自己的数字注册码
# 随机密钥，至少 32 位；建议用下方命令生成 64 位十六进制字符串
ARIA2_RPC_SECRET=把这里改成随机生成的密钥

# 留空自动生成并保存到 config/env，重建容器不会改变
JWT_SECRET=
JWT_EXPIRES_IN=7d
TELE_CHANNELS=[]
```

生成 RPC 密钥，将输出填入 `.env`，不要把命令本身填进去：

```bash
openssl rand -hex 32
```

检查下载目录的 UID/GID：

```bash
stat -c '%u:%g %n' '/vol3/1000/2T/飞牛影视'
```

例如输出 `1000:1001`，就填写 `PUID=1000`、`PGID=1001`。目录建议先在 NAS 文件管理器中创建，并确认这个用户可写。不要随意递归修改已有影视库的所有者。下载路径填写宿主机绝对路径，可包含中文和空格，不要填容器路径 `/downloads`。

### 3. 启动

```bash
docker compose --env-file .env config --quiet
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 app
```

访问 `http://NAS的IP:7003/`。端口被占用时，只改 `.env` 的 `APP_PORT`，容器内部端口保持 8008。配置检查使用 `--quiet`，避免将解析后的密钥打印到终端。

### 参数说明

| 参数 | 是否必填 | 填写方式 |
| --- | --- | --- |
| `CLOUDDOCK_VERSION` | 否 | 默认 `1.0.0`；生产固定版本，升级时修改。 |
| `APP_PORT` | 否 | NAS 上的访问端口，默认 `7003`。 |
| `BIND_IP` | 否 | 默认 `0.0.0.0`，也可绑定 NAS 的指定内网 IP。 |
| `NAS_DOWNLOAD_PATH` | 是 | NAS 实际下载目录的绝对路径；两个服务共用，必须可写。 |
| `PUID` / `PGID` | 按目录填写 | aria2 运行用户的数字 UID/GID；按目录所有者填写，不填用户名。 |
| `ADMIN_USER_CODE` | 是 | 自选 6～12 位数字，用于注册第一位管理员，不是登录密码；已有管理员后不再用于创建新管理员。 |
| `ARIA2_RPC_SECRET` | 是 | 至少 32 位随机字符串。Compose 自动让两个服务共用，不必在网页填写。 |
| `JWT_SECRET` | 否 | 推荐留空自动生成并持久保存。自定义须至少 32 位，包含大小写字母、数字和特殊字符；修改会让现有登录失效。 |
| `JWT_EXPIRES_IN` | 否 | 登录有效期，默认 `7d`；也可填 `6h`、`30m` 等。 |
| `TZ` | 否 | 默认 `Asia/Shanghai`。 |
| `TELE_CHANNELS` | 否 | 仅空数据库初始化时导入的频道 JSON 数组，默认 `[]`；已有频道时不覆盖。 |

`.env` 是 **Compose 参数文件**；`config/env` 是 **应用配置文件**，两者用途不同。JWT 留空时，程序首次启动在后者中保存随机密钥。不要把 NAS Cookie、数据库或密钥写进镜像。

## 首次登录和使用

1. 在登录页选择注册，设置用户名和密码，使用 `.env` 的 `ADMIN_USER_CODE` 注册第一位管理员。没有预置账号和密码。
2. 登录后在设置页填写自己的夸克 Cookie 并保存，确认 aria2 显示“已连接”。
3. 全新数据库不携带他人的频道列表。在设置 → 搜索频道中新增/导入自己的频道并保存，或在首次启动前设置 `TELE_CHANNELS`。
4. 搜索资源或直接粘贴分享链接解析，勾选本次需要的文件/文件夹，点“下一步”。
5. 选择夸克保存目录，再在“下载到飞牛”辅助行中更改本地目录，点保存。“夸克新建”在云盘建目录；“飞牛新建”在本地目录选择器内。
6. 右上角“下载进度”进入 AriaNg，可切换下载中、等待中、已完成。“返回搜索”回到资源页；“转存记录”处理转存问题和失败重试。

只选择一个文件就只下载该文件；选择整个文件夹则下载内部内容并保留层级。云盘路径与 NAS 路径独立，不自动添加“来自：分享/TV”等网盘前缀。关闭“下载到飞牛”后仅执行原版云盘转存。

频道参数格式，频道用户名一般不带 `https://t.me/` 前缀：

```dotenv
TELE_CHANNELS='[{"id":"实际频道用户名","name":"频道名称"}]'
```

## 持久化、升级和备份

| 宿主机目录 | 用途 |
| --- | --- |
| `./data` | SQLite 数据库：账号、Cookie、频道和转存作业等。 |
| `./config` | JWT 签名密钥与应用配置。 |
| `./aria2-config` | aria2 配置和下载会话。 |
| `./logs` | 应用日志。 |
| `NAS_DOWNLOAD_PATH` | 实际下载文件。 |

备份 `.env`、`data`、`config`、`aria2-config`。为保证备份一致，可先 `docker compose stop`，复制这些文件和目录后再 `docker compose start`。

升级时修改 `.env` 中的固定版本，再运行：

```bash
docker compose pull app
docker compose up -d app
docker compose ps
```

这不会重建 aria2 或删除下载文件。回滚时恢复上一个固定版本；未来若有数据库结构升级，需恢复对应备份。不要用 `docker compose down -v` 清理生产数据。

### 从 NAS 测试版迁移

复用原 `data/config/logs/aria2-config`、媒体目录和 RPC 密钥，即可保留账号、频道及已完成任务。不要在空目录启动后误以为数据丢失。旧 `deploy/compose.yaml` 是 NAS 分发文件挂载测试方案；正式镜像使用本 README 的**根目录 compose.yaml**，不再需要 `RELEASE_PATH`、`native` 或 `web` 源码挂载。发布镜像不会自动切换当前 NAS 服务。

## 常见问题

- **aria2 未连接**：确认两服务都在运行且 `ARIA2_RPC_SECRET` 共用同一个值。Compose 中 RPC 地址是 `http://aria2:6800/jsonrpc`，不要改成 `localhost`。
- **下载无权限**：检查实际目录与 UID/GID。两服务内部都应挂载到 `/downloads`。
- **登录失效**：重新登录；不要每次重建容器都换 JWT 密钥或清空 `config`。
- **搜索无资源**：配置搜索频道，或直接解析分享链接；需要代理时在原设置页配置。
- **下载失败**：先看“转存记录”。Cookie/下载直链失效时从那里重试；AriaNg 管理已有下载，顶部“新建”返回 CloudDock 搜索入口。

## 开发和来源

飞牛百度接入已内置后端：在飞牛官方百度应用登录后，在设置中点击“获取飞牛百度网盘授权”；复用原转存弹窗和飞牛目录选择。无需独立适配服务或配对码。Compose 参数及测试方式见 [飞牛百度接入指南](docs/BAIDU-SETUP.md)。**目前已发布的 1.0.0 / latest 尚不包含此功能。**

```bash
python3 scripts/prepare-web.py
node --test tests/web.test.cjs
docker build --platform linux/amd64 -t lulalulaluobo/clouddock:1.0.0 .
```

`upstream/nas-v0.8.3` 是 NAS 镜像的混淆后端和编译前端，不包含原始 TypeScript/Vue 源码。本项目通过经过版本校验的接入点扩展，不使用早期 v0.2.5 源码重建页面。Docker 构建复用固定 digest 的 NAS v0.8.3 基础镜像，不额外安装应用依赖；构建上下文不含用户配置、数据和凭据。

感谢 [CloudSaver](https://github.com/jiangrui1994/CloudSaver)、[AriaNg](https://github.com/mayswind/AriaNg)、[aria2](https://github.com/aria2/aria2) 和 [aria2-pro](https://github.com/P3TERX/Aria2-Pro-Docker)。AriaNg 许可证随静态资源保留。功能验收见 [TESTING.md](TESTING.md)。
