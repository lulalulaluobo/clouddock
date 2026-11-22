"""Deploy a verified web/native bundle and private PanSou service to an existing NAS Compose."""
from pathlib import Path
import argparse, copy, hashlib, json, os, shlex, shutil, sqlite3, subprocess, sys, tarfile, time, urllib.error, urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--base', required=True)
parser.add_argument('--archive', required=True)
parser.add_argument('--archive-sha256', required=True)
parser.add_argument('--index-sha256', required=True)
args = parser.parse_args()
base, archive = Path(args.base).resolve(), Path(args.archive).resolve()
name = 'nas-pansou-' + time.strftime('%Y%m%d-%H%M%S')
release, backup = base/'releases'/name, base/'backups'/name
env, overlay = base/'.env', base/'compose.pansou.yaml'
image = 'ghcr.io/fish2018/pansou@sha256:d371fe5caa87794414dd54cda063fcfc456d5013e18b65dbf1f6ca17f6299492'

def digest(file):
    h = hashlib.sha256()
    with file.open('rb') as source:
        for chunk in iter(lambda: source.read(1024*1024), b''): h.update(chunk)
    return h.hexdigest()
def docker(*values): return subprocess.check_output(['docker', *values], text=True).strip()
def compose(*values, pansou=False, capture=False):
    command = ['docker','compose','-f','compose.yaml'] + (['-f','compose.pansou.yaml'] if pansou else []) + list(values)
    if capture: return subprocess.check_output(command, cwd=base, text=True)
    subprocess.run(command, cwd=base, check=True)
def write_env(content):
    temporary = env.with_name('.env.clouddock-tmp-' + str(os.getpid()))
    try:
        with os.fdopen(os.open(temporary, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600), 'w') as stream: stream.write(content)
        shutil.copystat(env, temporary); os.replace(temporary, env)
    finally: temporary.unlink(missing_ok=True)
def health_from_app(script):
    return compose('exec','-T','app','node','-e',script,pansou=True,capture=True).strip()

assert archive.is_file() and digest(archive) == args.archive_sha256, '部署包校验失败'
assert not release.exists() and not backup.exists() and not overlay.exists(), '发布、备份或 PanSou 配置已存在'
assert not (base/'config/pansou.json').exists(), 'PanSou 配置已存在，请先检查原配置'
docker('image','inspect',image)
app = json.loads(docker('inspect','clouddock-nas'))[0]
assert app['Config']['Labels'].get('com.docker.compose.project.working_dir') == str(base), '现有 Compose 项目目录不匹配'
mounts = {row['Destination']: Path(row['Source']) for row in app['Mounts']}
old = mounts['/usr/share/nginx/html'].parent
assert old.parent == base/'releases' and mounts['/app/clouddock'] == old/'native', '现有代码挂载不匹配'
original = env.read_text()
entries = [line for line in original.splitlines() if line.startswith('RELEASE_PATH=')]
assert len(entries)==1 and shlex.split(entries[0].split('=',1)[1]) == [str(old)], '当前 RELEASE_PATH 与服务不一致'
assert not any(line.startswith('COMPOSE_FILE=') for line in original.splitlines()), '已有 COMPOSE_FILE 配置，请先检查'
assert (base/'data/database.sqlite').is_file(), '数据库路径不匹配'
before = json.loads(compose('config','--format','json',capture=True))
aria_before = docker('inspect','-f','{{.Id}} {{.State.StartedAt}}','clouddock-aria2')

backup.mkdir(parents=True, mode=0o700)
shutil.copy2(env, backup/'.env'); shutil.copy2(base/'compose.yaml', backup/'compose.yaml')
shutil.copytree(base/'config', backup/'config', symlinks=True)
with sqlite3.connect((base/'data/database.sqlite').as_uri()+'?mode=ro', uri=True) as source, sqlite3.connect(backup/'database.sqlite') as target:
    source.backup(target)
os.chmod(backup/'database.sqlite',0o600)
release.mkdir(parents=True)
with tarfile.open(archive,'r:gz') as bundle:
    for item in bundle.getmembers():
        assert not item.name.startswith('/') and '..' not in Path(item.name).parts and (item.isdir() or item.isfile()), '部署包包含不安全文件'
    bundle.extractall(release)
assert digest(release/'web/index.html') == args.index_sha256, '网页解包校验失败'
for file in (old/'native').rglob('*'):
    if file.is_file() and file.name != 'boot.cjs':
        candidate = release/'native'/file.relative_to(old/'native')
        assert candidate.is_file() and digest(candidate) == digest(file), '现有后端包含未合并改动，停止更新'
assert (release/'native/pansou.cjs').is_file() and (release/'native/pansou-router.cjs').is_file()
shutil.copy2(release/'compose.pansou.yaml', overlay)

started_pan = False
app_attempted = False
try:
    new_env = original.replace(entries[0], 'RELEASE_PATH='+shlex.quote(str(release)), 1)
    new_env = new_env.rstrip('\n') + '\nCOMPOSE_FILE=compose.yaml:compose.pansou.yaml\n'
    write_env(new_env)
    compose('config','--quiet',pansou=True)
    after = json.loads(compose('config','--format','json',pansou=True,capture=True))
    default_after = json.loads(subprocess.check_output(['docker','compose','config','--format','json'],cwd=base,text=True))
    assert default_after['services'] == after['services'], '默认 Compose 未包含 PanSou 覆盖配置'
    assert set(after['services']) == set(before['services']) | {'pansou'}, '服务列表不匹配'
    assert after['services']['aria2'] == before['services']['aria2'], 'aria2 配置发生变化'
    assert not after['services']['pansou'].get('ports'), 'PanSou 不应向宿主机开放端口'
    after_app = copy.deepcopy(after['services']['app'])
    assert after_app['environment'].pop('PANSOU_URL',None) == 'http://pansou:8888', 'PanSou 地址不匹配'
    after_app['environment'].pop('PANSOU_TOKEN',None)
    normalized = json.loads(json.dumps(after_app,ensure_ascii=False).replace(str(release),str(old)))
    assert normalized == before['services']['app'], '原应用配置发生意外变化'
    started_pan = True
    compose('up','-d','--no-deps','--no-build','--pull','never','pansou',pansou=True)
    health_script = "fetch('http://pansou:8888/api/health').then(r=>r.json()).then(x=>{if(x.status!=='ok'||!x.plugin_count)process.exit(1);console.log('PanSou 插件数:',x.plugin_count)}).catch(()=>process.exit(1))"
    for _ in range(40):
        try:
            print(health_from_app(health_script)); break
        except subprocess.CalledProcessError: time.sleep(1)
    else: raise RuntimeError('PanSou 内网健康检查失败')
    app_attempted = True
    compose('up','-d','--no-deps','--no-build','--pull','never','app',pansou=True)
    for _ in range(60):
        if docker('inspect','-f','{{.State.Health.Status}}','clouddock-nas') == 'healthy': break
        time.sleep(1)
    else: raise RuntimeError('CloudDock 健康检查超时')
    assert docker('inspect','-f','{{.Id}} {{.State.StartedAt}}','clouddock-aria2') == aria_before, 'aria2 状态发生变化'
    with urllib.request.urlopen('http://192.168.2.61:7003/',timeout=8) as response:
        assert hashlib.sha256(response.read()).hexdigest() == args.index_sha256, '对外页面与部署版本不一致'
    try: urllib.request.urlopen('http://192.168.2.61:7003/api/clouddock-pansou/config',timeout=8)
    except urllib.error.HTTPError as error: assert error.code in (401,403), 'PanSou 配置接口缺少鉴权'
    else: raise AssertionError('PanSou 配置接口缺少鉴权')
    print('DEPLOYED',release)
    print('BACKUP',backup)
    print('HEALTH CloudDock healthy; PanSou connected; aria2 unchanged')
except BaseException:
    write_env(original)
    if app_attempted: compose('up','-d','--no-deps','--no-build','--pull','never','app')
    if started_pan:
        ident = compose('ps','-q','pansou',pansou=True,capture=True).strip()
        if ident:
            subprocess.run(['docker','stop',ident],check=False,stdout=subprocess.DEVNULL)
            subprocess.run(['docker','container','rm',ident],check=False,stdout=subprocess.DEVNULL)
    overlay.unlink(missing_ok=True)
    print('ROLLBACK restored previous release',file=sys.stderr)
    raise
