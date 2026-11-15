"""Deploy the reviewed UI release on the existing NAS without changing Compose."""
from pathlib import Path
import shutil, sqlite3, subprocess, tarfile, time

base = Path('/vol2/1000/4T硬盘/dockerdata/clouddock')
name = 'nas-0.8.3-brand-20261026-r1'
release, backup = base/'releases'/name, base/'backups'/name
assert not release.exists() and not backup.exists(), 'Release already exists'
env = base/'.env'
original = env.read_text()
assert sum(line.startswith('RELEASE_PATH=') for line in original.splitlines()) == 1
assert 'BAIDU_NAS_UID' in (base/'compose.yaml').read_text()
def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()
aria = docker('inspect', '-f', '{{.Id}}', 'clouddock-aria2')
backup.mkdir(parents=True, mode=0o700)
shutil.copy2(env, backup/'.env')
shutil.copy2(base/'compose.yaml', backup/'compose.yaml')
shutil.copytree(base/'config', backup/'config')
with sqlite3.connect(f'file:{base}/data/database.sqlite?mode=ro', uri=True) as db, sqlite3.connect(backup/'database.sqlite') as target:
    db.backup(target)
release.mkdir(parents=True)
with tarfile.open('/tmp/clouddock-brand-release.tar.gz') as archive:
    assert all(not m.name.startswith('/') and '..' not in Path(m.name).parts and not m.issym() and not m.islnk() for m in archive.getmembers())
    archive.extractall(release)
try:
    env.write_text('\n'.join('RELEASE_PATH="'+str(release)+'"' if line.startswith('RELEASE_PATH=') else line for line in original.splitlines())+'\n')
    subprocess.run(['docker','compose','config','--quiet'], cwd=base, check=True)
    subprocess.run(['docker','compose','up','-d','--no-deps','app'], cwd=base, check=True)
    for attempt in range(45):
        if docker('inspect','-f','{{.State.Health.Status}}','clouddock-nas') == 'healthy': break
        time.sleep(1)
    else: raise RuntimeError('Health timeout')
    assert docker('inspect','-f','{{.Id}}','clouddock-aria2') == aria
    print('DEPLOYED', name, 'aria2 unchanged; backup:', backup)
except Exception:
    env.write_text(original)
    subprocess.run(['docker','compose','up','-d','--no-deps','app'], cwd=base, check=True)
    raise
