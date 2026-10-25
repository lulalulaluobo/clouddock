"""Prepare an isolated NAS v0.8.3 instance without exporting user secrets."""
from pathlib import Path
import argparse
import os
import re
import secrets
import shutil
import sqlite3
from runtime_config import generate_config


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--media", required=True)
    args = parser.parse_args()
    source, target = Path(args.source).resolve(), Path(args.target).resolve()
    database = target / "data/database.sqlite"
    if source == target or database.exists() or (target / ".env").exists():
        raise SystemExit("目标已有数据或与来源相同，停止以避免覆盖")
    target.mkdir(parents=True, exist_ok=True)
    os.chmod(target, 0o700)
    for directory in ("data", "config", "logs", "aria2-config"):
        (target / directory).mkdir(exist_ok=True)
        os.chmod(target / directory, 0o700)
    old = sqlite3.connect((source / "data/database.sqlite").as_uri() + "?mode=ro", uri=True)
    new = sqlite3.connect(database)
    old.backup(new)
    # The obsolete QAS bridge remains on the original service, but is disabled
    # in this isolated native-download instance to avoid duplicate downloads.
    with new:
        disabled = new.execute("UPDATE plugins SET enabled=0 WHERE name IN (?,?)", ("QAS 临时转存并下载", "QuarkAutoSavePlugin")).rowcount
    channels = new.execute("SELECT count(*),sum(isEnabled) FROM search_channels").fetchone()
    new.close()
    old.close()
    generate_config(source / "config/env", target / "config/env")
    owner = Path(args.media).stat()
    values = {"BIND_IP": "192.168.2.61", "APP_PORT": "7003", "RELEASE_PATH": args.release,
              "NAS_DOWNLOAD_PATH": args.media, "PUID": str(owner.st_uid), "PGID": str(owner.st_gid),
              "ARIA2_RPC_SECRET": secrets.token_hex(32)}
    with (target / ".env").open("x") as stream:
        for key, value in values.items():
            stream.write(key + "='" + value.replace("'", "\\'") + "'\n")
    for file in (database, target / "config/env", target / ".env"):
        os.chmod(file, 0o600)
    print(f"NAS 原版隔离数据已复制：频道 {channels[0]} 个，启用 {channels[1]} 个；停用旧 QAS 桥接 {disabled} 项；未输出凭据")


if __name__ == "__main__":
    main()
