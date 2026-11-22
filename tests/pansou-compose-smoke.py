"""Isolated Docker smoke test; never transfers or downloads resources."""
import argparse
from pathlib import Path
import json, os, secrets, socket, subprocess, tempfile, time, urllib.error, urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--image', default=os.environ.get('CLOUDDOCK_TEST_IMAGE', 'lulalulaluobo/clouddock:1.3.0'))
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
project = 'clouddock-pansou-smoke-' + secrets.token_hex(3)
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='clouddock-pansou-') as name:
    base = Path(name).resolve()
    for folder in ('data', 'config', 'logs', 'aria2-config', 'media'): (base / folder).mkdir(mode=0o777)
    media = base / 'media'
    values = {'BIND_IP':'127.0.0.1', 'APP_PORT':str(port), 'NAS_DOWNLOAD_PATH':str(media), 'PUID':str(media.stat().st_uid), 'PGID':str(media.stat().st_gid), 'ADMIN_USER_CODE':'13579246', 'ARIA2_RPC_SECRET':secrets.token_hex(32)}
    lines = []
    for line in (root / '.env.example').read_text().splitlines():
        key = line.split('=', 1)[0]; lines.append(key + '=' + values[key] if key in values else line)
    env = base / '.env'; env.write_text('\n'.join(lines) + '\n'); env.chmod(0o600)
    override = base / 'test.yaml'; override.write_text(f'services:\n  app:\n    image: {args.image}\n')
    compose = ['docker','compose','-f',str(root/'compose.yaml'),'-f',str(root/'compose.pansou.yaml'),'-f',str(override),'--project-directory',str(base),'--env-file',str(env),'-p',project]
    endpoint = f'http://127.0.0.1:{port}'
    def call(route, body=None, token=None):
        headers={'Content-Type':'application/json'}
        if token: headers['Authorization']='Bearer '+token
        req=urllib.request.Request(endpoint+route, json.dumps(body).encode() if body is not None else None, headers)
        try:
            with urllib.request.urlopen(req, timeout=45) as result: return result.status, json.load(result)
        except urllib.error.HTTPError as error: return error.code, json.load(error)
    try:
        subprocess.run(compose + ['up','-d','--pull','never','--wait','--wait-timeout','150'],check=True)
        for svc in ('app', 'aria2', 'pansou'):
            cid = subprocess.check_output(compose + ['ps','-q',svc], text=True).strip()
            info = json.loads(subprocess.check_output(['docker','inspect',cid], text=True))[0]
            assert info['State']['Health']['Status'] == 'healthy', f'{svc} 健康检查未通过'
            assert info['HostConfig']['LogConfig']['Type'] == 'json-file', f'{svc} 日志驱动异常'
            assert info['HostConfig']['LogConfig']['Config'] == {'max-size': '10m', 'max-file': '3'}, f'{svc} 日志轮转配置异常'
        password='Smoke-'+secrets.token_hex(12)+'Aa1!'
        status, registered=call('/api/user/register', {'username':'pansou_smoke','password':password,'registerCode':values['ADMIN_USER_CODE']})
        assert status==200 and registered.get('success'), '测试管理员注册失败'
        status, login=call('/api/user/login', {'username':'pansou_smoke','password':password})
        assert status==200 and login.get('success'), '测试管理员登录失败'
        token=login['data']['token']
        assert call('/api/clouddock-pansou/search', {'keyword':'test'})[0] in (401,403)
        status, cfg=call('/api/clouddock-pansou/config', token=token)
        assert status==200 and cfg['data']['enabled'] and cfg['data']['url']=='http://pansou:8888'
        for attempt in range(20):
            status, health=call('/api/clouddock-pansou/health', token=token)
            if status==200 and health['data']['connected']: break
            time.sleep(1)
        else: raise AssertionError('PanSou 内网健康检查失败')
        js = "fetch('http://pansou:8888/api/health').then(r=>r.json()).then(x=>{console.log('PanSou 插件数:',x.plugin_count);process.exit(x.plugin_count>0?0:1)}).catch(()=>process.exit(1))"
        subprocess.run(compose+['exec','-T','app','node','-e',js],check=True)
        assert call('/api/clouddock-pansou/search', {'keyword':''}, token)[0]==400
        assert call('/api/clouddock-pansou/check', {'items':[]}, token)[0]==400
        assert call('/api/clouddock-pansou/config', {'enabled':True,'url':'file:///etc/passwd'}, token)[0]==400
        js = "fetch('http://pansou:8888/api/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kw:'Python',src:'plugin',res:'results',cloud_types:['baidu','quark']})}).then(async r=>{const x=await r.json();console.log(JSON.stringify({status:r.status,keys:Object.keys(x),dataKeys:x.data&&Object.keys(x.data),resultsArray:Array.isArray(x.results),dataResultsArray:Array.isArray(x.data&&x.data.results)}))}).catch(()=>process.exit(1))"
        subprocess.run(compose+['exec','-T','app','node','-e',js],check=True)
        status, search=call('/api/clouddock-pansou/search', {'keyword':'Python'}, token)
        assert status==200 and isinstance(search.get('data'),list), f"PanSou 搜索返回格式异常：HTTP {status} {search.get('message','')}"
        # Empty check is rejected by the actual PanSou API before contacting any cloud provider.
        # Avoid an external network lookup: this request contains no share link.
        js="fetch('http://pansou:8888/api/check/links',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:[]})}).then(r=>{console.log(r.status);process.exit(r.status===400?0:1)}).catch(()=>process.exit(1))"
        subprocess.run(compose+['exec','-T','app','node','-e',js],check=True)
        print('PASS: PanSou 独立容器、内网 API、登录鉴权与搜索格式；未转存或下载资源')
    finally:
        subprocess.run(compose+['down','--remove-orphans'],check=False)
