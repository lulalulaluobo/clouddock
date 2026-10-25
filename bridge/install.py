#!/usr/bin/env python3
"""Install the local adapter on fnOS; run explicitly as NAS administrator."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import subprocess

parser = argparse.ArgumentParser(description='安装 CloudDock 飞牛百度适配服务（不修改官方应用）')
parser.add_argument('--uid', type=int, required=True, help='已登录百度网盘的飞牛用户 UID')
parser.add_argument('--download-root', required=True, help='与 CloudDock /downloads 挂载相同的宿主机目录')
parser.add_argument('--install-dir', default='/var/lib/clouddock-baidu')
parser.add_argument('--show-pairing-code', action='store_true', help='安装后在当前终端显示配对码；不要将输出分享给其他人')
args = parser.parse_args()
if os.geteuid() != 0:
    parser.error('请使用飞牛管理员 sudo 运行')
os.umask(0o077)
database = Path('/var/apps/baidu.netdisk/var/db/main.db')
with sqlite3.connect('file:' + str(database) + '?mode=ro', uri=True) as db:
    count = db.execute('select count(*) from nas_bd_user u join nas_bd_bind b on b.nas_uid=u.nas_uid and b.current_uk=u.uk where u.nas_uid=? and u.deleted_at=0 and b.deleted_at=0', (args.uid,)).fetchone()[0]
if count != 1:
    parser.error('该飞牛用户尚未在官方百度网盘应用绑定唯一有效账号')
root = Path(args.download_root).resolve(strict=True)
if not root.is_dir():
    parser.error('下载根目录不存在')
links = Path('/var/apps/baidu.netdisk/var/ulinks') / str(args.uid) / 'download'
matches = []
for link in links.iterdir():
    if link.is_symlink():
        base = link.resolve()
        if root.is_relative_to(base):
            suffix = root.relative_to(base).as_posix()
            matches.append((len(base.parts), '/' + link.name + (('/' + suffix) if suffix != '.' else '')))
if not matches:
    parser.error('下载目录未被飞牛百度 SDK 映射，先在官方应用确认目录可用')
sdk = max(matches)[1]
install = Path(args.install_dir).resolve()
if any(c.isspace() for c in str(install)):
    parser.error('适配服务安装目录不能包含空白字符')
install.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(install, 0o700)
shutil.copyfile(Path(__file__).with_name('baidu.py'), install / 'baidu.py')
key = install / 'pairing-code'
if not key.exists():
    key.write_text(secrets.token_urlsafe(32))
os.chmod(key, 0o600)
config = {'database': str(database), 'uid': args.uid, 'roots': [{'id': 'media', 'host': str(root), 'sdk': sdk}], 'socket': '/run/clouddock-baidu/bridge.sock', 'state': str(install / 'jobs.db'), 'keyFile': str(key)}
(install / 'config.json').write_text(json.dumps(config, ensure_ascii=False, indent=2))
unit = f'''[Unit]
Description=CloudDock fnOS Baidu adapter
After=network-online.target
[Service]
Type=simple
ExecStart=/usr/bin/python3 {install}/baidu.py {install}/config.json
Restart=on-failure
RestartSec=5
RuntimeDirectory=clouddock-baidu
RuntimeDirectoryMode=0700
RuntimeDirectoryPreserve=yes
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
[Install]
WantedBy=multi-user.target
'''
Path('/etc/systemd/system/clouddock-baidu.service').write_text(unit)
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'enable', '--now', 'clouddock-baidu.service'], check=True)
subprocess.run(['systemctl', 'restart', 'clouddock-baidu.service'], check=True)
print('适配服务已安装。请添加 compose.baidu.yaml 的 socket 挂载并在 CloudDock 设置页配对。')
print('本地下载目录：', root)
if args.show_pairing_code:
    print('配对码（仅填写到你自己的 CloudDock）：', key.read_text().strip())
else:
    print('配对码保存在：', key)
