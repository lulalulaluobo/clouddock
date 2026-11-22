"""Package public deployment files only; never include .env or runtime data."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--version', default='1.3.0')
parser.add_argument('--digest', required=True)
args = parser.parse_args()
assert re.fullmatch(r'\d+\.\d+\.\d+', args.version)
assert re.fullmatch(r'sha256:[a-f0-9]{64}', args.digest)
root = Path(__file__).resolve().parents[1]
files = {'README.md':root/'README.md', 'compose.yaml':root/'compose.yaml',
         'compose.baidu.yaml':root/'compose.baidu.yaml', 'compose.pansou.yaml':root/'compose.pansou.yaml',
         '.env.example':root/'.env.example', 'TESTING.md':root/'TESTING.md',
         'docs/BAIDU-SETUP.md':root/'docs/BAIDU-SETUP.md', 'docs/PANSOU.md':root/'docs/PANSOU.md',
         'RELEASE-'+args.version+'.md':root/'release'/('RELEASE-'+args.version+'.md')}
assert 'CLOUDDOCK_VERSION='+args.version in files['.env.example'].read_text()
archive = root/'release'/('clouddock-'+args.version+'-compose.zip')
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
    for name, source in files.items(): output.write(source, name)
with zipfile.ZipFile(archive) as output:
    assert output.testzip() is None
    assert set(output.namelist()) == set(files)
manifest = {'image':'lulalulaluobo/clouddock:'+args.version, 'platform':'linux/amd64',
            'digest':args.digest, 'composePackage':archive.name,
            'packageSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
            'files':{name:hashlib.sha256(source.read_bytes()).hexdigest() for name, source in files.items()}}
(root/'release'/('manifest-'+args.version+'.json')).write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
print('Packaged:', archive)
print('SHA256:', manifest['packageSha256'])
