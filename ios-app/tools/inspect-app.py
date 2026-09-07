#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Inspect the actual app, including Mach-O platform (arm64 alone is insufficient)."""
import argparse, hashlib, json, pathlib, plistlib, subprocess
p=argparse.ArgumentParser()
p.add_argument('app',type=pathlib.Path)
p.add_argument('--platform', choices=['IOS','IOSSIMULATOR'],required=True)
a=p.parse_args()
info=plistlib.loads((a.app/'Info.plist').read_bytes())
assert info.get('QuareiaBuildFlavor')=='public-prototype', 'Missing public prototype build marker'
assert info.get('CFBundleDisplayName')=='Quareia Prototype', 'Public build must identify itself'
assert info['CFBundleShortVersionString']=='1.0.0'
assert info['CFBundleVersion']=='1'
assert info.get('MinimumOSVersion')=='16.0'
assert sorted(info['UIDeviceFamily'])==[1,2]
assert not info.get('NSAppTransportSecurity',{}).get('NSAllowsArbitraryLoads',False)
for key in ['UIBackgroundModes','UIFileSharingEnabled','LSSupportsOpeningDocumentsInPlace']:
    assert not info.get(key), f'Unexpected capability: {key}'
binary=a.app/info['CFBundleExecutable']
build=subprocess.check_output(['xcrun','vtool','-show-build',str(binary)],text=True)
platforms=[line.split()[-1] for line in build.splitlines() if line.strip().startswith('platform ')]
assert platforms and set(platforms)=={a.platform}, build
architectures=subprocess.check_output(['lipo','-archs',str(binary)],text=True).strip()
if a.platform=='IOS': assert architectures=='arm64'
for item in a.app.rglob('*'):
    assert not item.is_symlink(), 'Unexpected symlink'
    assert item.suffix.lower() not in ['.swift','.kt','.key','.pem','.p12','.mobileprovision','.qv'], 'Forbidden public payload file'
    assert item.name not in ['.private','PrivateInputs','VaultMaterial','PlugIns'], 'Forbidden payload directory'
ent=subprocess.run(['codesign','-d','--entitlements',':-',str(a.app)],capture_output=True)
if ent.stdout.strip():
    rights=plistlib.loads(ent.stdout)
    assert set(rights).issubset({'get-task-allow'}), 'Unexpected entitlements'
    assert a.platform=='IOSSIMULATOR' or not rights, 'Device build should be unsigned'
print(json.dumps({'status':'PUBLIC_TEST_ONLY','flavor':info['QuareiaBuildFlavor'],'bundleID':info['CFBundleIdentifier'],'version':info['CFBundleShortVersionString'],'build':info['CFBundleVersion'],'platform':a.platform,'architectures':architectures,'binaryBytes':binary.stat().st_size,'binarySHA256':hashlib.sha256(binary.read_bytes()).hexdigest(),'files':sum(x.is_file() for x in a.app.rglob('*'))},sort_keys=True))
