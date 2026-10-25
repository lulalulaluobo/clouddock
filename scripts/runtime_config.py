"""Keep upstream settings; give an isolated instance its own signing key."""
from pathlib import Path
import os
import re
import secrets
import sys


def generate_config(source_path, target_path):
    source, target = Path(source_path).resolve(), Path(target_path).resolve()
    if source == target:
        raise RuntimeError("不能覆盖原实例的配置")
    text = source.read_text()
    text = re.sub(r"(?m)^(?:export\s+)?(?:TG_BOT_TOKEN|TELEGRAM_BOT_TOKEN|BOT_TOKEN|JWT_SECRET|NODE_ENV)=.*$", "", text)
    text = text.rstrip() + "\nNODE_ENV=production\nJWT_SECRET=" + secrets.token_hex(32) + "Aa1!\n"
    target.write_text(text)
    os.chmod(target, 0o600)


if __name__ == "__main__":
    generate_config(sys.argv[1], sys.argv[2])
    print("独立实例的运行配置已生成，原配置未改动，密钥未输出")
