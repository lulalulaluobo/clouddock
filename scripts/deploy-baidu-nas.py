"""Run on this NAS after uploading the reviewed release archive. No secret output."""
from pathlib import Path
import os, shutil, sqlite3, subprocess, tarfile, time

base = Path('/vol2/1000/4T硬盘/dockerdata/clouddock')
name = 'nas-0.8.3-baidu-20261025-r1'
release, backup = base/'releases'/name, base/'backups'/name
assert not release.exists() and not backup.exists(), 'Release already exists'
compose, env = base/'compose.yaml', base/'.env'
original_compose, original_env = compose.read_text(), env.read_text()
assert 'BAIDU_NAS_UID' not in original_compose
assert '    volumes:\n' in original_compose and '      NODE_ENV: production\n' in original_compose
aria = subprocess.check_output(['docker','inspect','-f','{{.Id}}','clouddock-aria2'], text=True).strip()
backup.mkdir(parents=True, mode=0o700)
shutil.copy2(compose, backup/'compose.yaml'); shutil.copy2(env, backup/'.env')
shutil.copytree(base/'config', backup/'config')
for source in (base/'data').rglob('*'):
    if source.suffix not in ('.db', '.sqlite', '.sqlite3'): continue
    dest = backup/'data'/source.relative_to(base/'data'); dest.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as db, sqlite3.connect(dest) as target: db.backup(target)
(backup/'aria-id').write_text(aria)
release.mkdir(parents=True)
with tarfile.open('/tmp/clouddock-builtin-release.tar.gz') as archive:
    assert all(not m.name.startswith('/') and '..' not in Path(m.name).parts and not m.issym() and not m.islnk() for m in archive.getmembers())
    archive.extractall(release)
new_compose = original_compose.replace('      NODE_ENV: production\n', '      NODE_ENV: production\n      BAIDU_NAS_UID: "1000"\n      BAIDU_HOST_DOWNLOAD_PATH: ${NAS_DOWNLOAD_PATH:?Set NAS_DOWNLOAD_PATH}\n', 1)
mounts = '''    volumes:
      - type: bind
        source: /var/apps/baidu.netdisk/var/db
        target: /run/fnos-baidu/db
        read_only: true
        bind:
          create_host_path: false
      - type: bind
        source: /var/apps/baidu.netdisk/var/ulinks
        target: /run/fnos-baidu/ulinks
        read_only: true
        bind:
          create_host_path: false
'''
new_compose = new_compose.replace('    volumes:\n', mounts, 1)
lines = original_env.splitlines(); assert sum(x.startswith('RELEASE_PATH=') for x in lines) == 1
new_env = '\n'.join('RELEASE_PATH="'+str(release)+'"' if x.startswith('RELEASE_PATH=') else x for x in lines)+'\n'
try:
    compose.write_text(new_compose); env.write_text(new_env)
    subprocess.run(['docker','compose','config','--quiet'], cwd=base, check=True)
    subprocess.run(['docker','compose','up','-d','--no-deps','app'], cwd=base, check=True)
    for attempt in range(45):
        state = subprocess.check_output(['docker','inspect','-f','{{.State.Health.Status}}','clouddock-nas'], text=True).strip()
        if state == 'healthy': break
        time.sleep(1)
    else: raise RuntimeError('Health timeout')
    assert subprocess.check_output(['docker','inspect','-f','{{.Id}}','clouddock-aria2'], text=True).strip() == aria
    print('DEPLOYED', name, 'aria2 unchanged; backup:', backup)
except Exception:
    compose.write_text(original_compose); env.write_text(original_env)
    subprocess.run(['docker','compose','up','-d','--no-deps','app'], cwd=base, check=True)
    raise
