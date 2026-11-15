"""Sync the public README using Docker's credential helper; never print tokens."""
import base64
import json
import ssl
from pathlib import Path
import subprocess
import urllib.error
import urllib.request

registry = 'https://index.docker.io/v1/'
config = json.loads((Path.home()/'.docker/config.json').read_text())
context = ssl.create_default_context(cafile='/etc/ssl/cert.pem') if Path('/etc/ssl/cert.pem').exists() else ssl.create_default_context()
helper = config.get('credHelpers', {}).get(registry) or config.get('credsStore')
if not helper:
    raise SystemExit('需要 Docker 凭据助手，请先在 Docker Desktop 登录 Docker Hub')
credentials = json.loads(subprocess.check_output(['docker-credential-'+helper,'get'], input=registry.encode()))
def request(url, body=None, token=None):
    headers = {'Content-Type':'application/json'}
    if token: headers['Authorization'] = 'JWT '+token
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers, method='PATCH' if body is not None and '/repositories/' in url else None)
    with urllib.request.urlopen(req, timeout=30, context=context) as response:
        return json.load(response)

try:
    # Desktop stores either a Hub access token or a password/PAT in its helper.
    secret = credentials['Secret']
    if secret.count('.') == 2:
        claims = json.loads(base64.urlsafe_b64decode(secret.split('.')[1]+'==='))
        assert claims.get('sub') or claims.get('access_token'), 'Unknown Hub credential'
        token = secret
    else:
        token = request('https://hub.docker.com/v2/users/login/', {'username':credentials['Username'],'password':secret})['token']
    endpoint = 'https://hub.docker.com/v2/repositories/lulalulaluobo/clouddock/'
    readme = (Path(__file__).resolve().parents[1]/'README.md').read_text()
    result = request(endpoint, {'description':'CloudDock: Quark/Baidu transfers, fnOS NAS downloads, built-in AriaNg. x86-64 Docker Compose.','full_description':readme}, token)
    assert result['full_description'] == readme, 'README response differs'
    assert request(endpoint, token=token)['full_description'] == readme, 'README read-back differs'
    print('PASS: Docker Hub README updated and read-back matches local README')
except urllib.error.HTTPError as error:
    try:
        details = json.loads(error.read())
        reason = json.dumps(details, ensure_ascii=False)[:1000]
        for private in [credentials.get('Secret',''), locals().get('token','')]:
            if private: reason = reason.replace(private,'[redacted]')
    except (ValueError, TypeError): reason = '请求未被接受'
    raise SystemExit('Docker Hub README 同步失败，'+error.url+' HTTP '+str(error.code)+'：'+reason) from None
except urllib.error.URLError:
    raise SystemExit('Docker Hub README 同步失败，请检查 HTTPS 连接及系统 CA 证书') from None
