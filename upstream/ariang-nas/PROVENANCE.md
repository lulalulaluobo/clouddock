# AriaNg 分发文件来源

2026-10-24 从用户 NAS 正在使用的 `p3terx/ariang` 容器 `/AriaNg` 提取。只复制静态前端，不包含浏览器存储、RPC 密钥或 aria2 配置。

官方项目：https://github.com/mayswind/AriaNg

遵循随附 MIT LICENSE。`scripts/prepare-web.py` 保留前端资源，在生成目录的 index.html 末尾添加 CloudDock 连接桥接脚本；原始目录不作功能修改。
