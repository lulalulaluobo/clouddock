"""Validate the shipped Compose files and README without exposing real secrets."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
readme = (root/'README.md').read_text()
snippets = re.findall(r'```yaml\n(.*?)```', readme, re.S)
def normalized(value):
    return '\n'.join(line.rstrip() for line in value.splitlines() if line.strip() and not line.lstrip().startswith('#'))
assert normalized(snippets[0]) == normalized((root/'compose.yaml').read_text())
assert normalized(snippets[1]) == normalized((root/'compose.baidu.yaml').read_text())
with tempfile.TemporaryDirectory(prefix='clouddock-compose-') as directory:
    temp = Path(directory)
    example = (root/'.env.example').read_text().replace('ADMIN_USER_CODE=\n', 'ADMIN_USER_CODE=12345678\n').replace('ARIA2_RPC_SECRET=\n', 'ARIA2_RPC_SECRET='+'a'*64+'\n')
    (temp/'.env').write_text(example)
    # Do not let a developer's shell variables override the test fixture.
    fixture_keys = [line.split('=', 1)[0] for line in example.splitlines() if line and not line.startswith('#') and '=' in line]
    clean_env = {key: value for key, value in os.environ.items() if key not in fixture_keys}
    command = ['docker','compose','--project-directory',directory,'--env-file',str(temp/'.env'),'-f',str(root/'compose.yaml')]
    def config(extra):
        return json.loads(subprocess.check_output(command+extra+['config','--format','json'], env=clean_env))
    basic = config([])['services']
    assert basic['app']['image'] == 'lulalulaluobo/clouddock:1.2.0'
    assert basic['app']['platform'] == basic['aria2']['platform'] == 'linux/amd64'
    assert 'BAIDU_NAS_UID' not in basic['app']['environment']
    assert basic['app']['environment']['ARIA2_RPC_SECRET'] == basic['aria2']['environment']['RPC_SECRET']
    merged = config(['-f',str(root/'compose.baidu.yaml')])['services']
    assert set(merged) == {'app','aria2'}
    assert merged['app']['environment']['BAIDU_NAS_UID'] == '1000'
    assert merged['app']['environment']['BAIDU_HOST_DOWNLOAD_PATH'] == '/vol3/1000/2T/飞牛影视'
    mounts = {item['target']: item for item in merged['app']['volumes']}
    for target in ['/run/fnos-baidu/db','/run/fnos-baidu/ulinks']:
        assert mounts[target]['read_only'] and not mounts[target]['bind'].get('create_host_path',False)
    assert mounts['/downloads']['source'] == '/vol3/1000/2T/飞牛影视'
    assert set(mounts) == {'/app/data','/app/config','/app/logs','/downloads','/run/fnos-baidu/db','/run/fnos-baidu/ulinks'}
print('PASS: README matches Compose; generic/fnOS configuration, version, platform and mounts validated')
