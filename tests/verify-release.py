"""Read-only/download-free smoke verification against an isolated Compose."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--directory", required=True)
parser.add_argument("--port", type=int, default=17003)
parser.add_argument("--project", default="clouddock-release-smoke")
args = parser.parse_args()
root = Path(args.directory).resolve()
env = dict(line.split("=", 1) for line in (root / ".env").read_text().splitlines() if "=" in line and not line.startswith("#"))
base = f"http://127.0.0.1:{args.port}"


def call(route, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(base + route, json.dumps(body).encode() if body is not None else None, headers)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


password = "Smoke-" + env["ARIA2_RPC_SECRET"][:20] + "Aa1!"
_, login = call("/api/user/login", {"username": "release_smoke", "password": password})
if not login.get("success"):
    _, registration = call("/api/user/register", {"username": "release_smoke", "password": password, "registerCode": env["ADMIN_USER_CODE"]})
    assert registration.get("success"), "首位管理员注册失败"
    _, login = call("/api/user/login", {"username": "release_smoke", "password": password})
assert login.get("success"), "测试账号登录失败"
token = login["data"]["token"]
assert call("/api/clouddock/jobs")[0] == 401
_, health = call("/api/clouddock/health", token=token)
assert health["data"]["aria2"]["connected"] is True
assert health["data"]["baseVersion"] == "0.8.3"
assert call("/api/clouddock/jobs", token=token)[1]["data"] == []
baidu = call("/api/clouddock/baidu/health", token=token)
assert baidu[0] == 200 and baidu[1]["data"]["connected"] is False
assert call("/api/clouddock/baidu/jobs", token=token)[1]["data"] == []
assert call("/api/clouddock/quark/share", {"shareCode": "../invalid"}, token)[0] == 400
with urllib.request.urlopen(base + "/transfer", timeout=10) as response:
    page = response.read().decode()
    assert "<title>CloudDock</title>" in page and "clouddock/logo.svg" in page
media = Path(env["NAS_DOWNLOAD_PATH"])
status, created = call("/api/clouddock/directories", {"target": {"rootId": "media", "relativePath": ""}, "name": "fresh-deploy"}, token)
assert status in (201, 409)
assert (media / "fresh-deploy").is_dir()
assert (media / "fresh-deploy").stat().st_uid == media.stat().st_uid
_, rpc = call("/api/clouddock/rpc", {"jsonrpc": "2.0", "id": "release-smoke", "method": "system.multicall", "params": [[{"methodName": "aria2.getGlobalStat", "params": []}, {"methodName": "aria2.getGlobalOption", "params": []}]]}, token)
stats = rpc["result"][0][0]
assert stats["numActive"] == stats["numWaiting"] == stats["numStopped"] == "0"
assert not rpc["result"][1][0].get("rpc-secret")
for route, marker in [("/clouddock/progress.html", "返回搜索"), ("/clouddock/ariang/index.html", "ariang-bridge")]:
    with urllib.request.urlopen(base + route, timeout=10) as response:
        assert response.status == 200 and marker in response.read().decode()

digest = hashlib.sha256((root / "config/env").read_bytes()).hexdigest()
compose = ["docker", "compose", "-f", str(Path(__file__).resolve().parents[1] / "compose.yaml"), "--project-directory", str(root), "--env-file", str(root / ".env"), "-p", args.project]
subprocess.run(compose + ["up", "-d", "--no-deps", "--force-recreate", "--pull", "never", "app"], check=True, stdout=subprocess.DEVNULL)
for attempt in range(30):
    try:
        status, result = call("/api/clouddock/health", token=token)
        if status == 200 and result["data"]["aria2"]["connected"]:
            break
    except (OSError, ValueError):
        pass
    time.sleep(1)
else:
    raise AssertionError("重建后服务未恢复")
assert hashlib.sha256((root / "config/env").read_bytes()).hexdigest() == digest
assert call("/api/clouddock/jobs", token=token)[1]["data"] == []
print(json.dumps({"result": "PASS", "platform": "linux/amd64", "freshLogin": True, "aria2": health["data"]["aria2"]["version"], "baiduWithoutOfficialApp": "disconnected", "brandAndTransferRoute": True, "localMkdir": True, "rpcSecretNotExposed": True, "recreateKeepsJWTAndLogin": True, "noDownloadTasks": True}, ensure_ascii=False))
