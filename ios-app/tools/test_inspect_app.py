# SPDX-License-Identifier: MPL-2.0
"""Adversarial gate tests; mocked tool outputs are not actual Xcode evidence."""
import contextlib
import io
import pathlib
import plistlib
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

INSPECTOR = pathlib.Path(__file__).with_name('inspect-app.py')

class PayloadGateTests(unittest.TestCase):
    def inspect(self, *, platform='IOS', library_platform='IOS', flavor='public-prototype', forbidden=False):
        with tempfile.TemporaryDirectory() as directory:
            app=pathlib.Path(directory)/'Quareia.app'
            app.mkdir()
            (app/'Info.plist').write_bytes(plistlib.dumps({
                'QuareiaBuildFlavor':flavor, 'CFBundleDisplayName':'Quareia Prototype',
                'CFBundleShortVersionString':'1.0.0', 'CFBundleVersion':'1',
                'MinimumOSVersion':'16.0', 'UIDeviceFamily':[1,2],
                'CFBundleExecutable':'Quareia', 'CFBundleIdentifier':'test.public',
                'CFBundleSupportedPlatforms':['iPhoneOS']
            }))
            (app/'Quareia').write_bytes(b'\xcf\xfa\xed\xfe'+b'synthetic executable')
            (app/'Linked.dylib').write_bytes(b'\xcf\xfa\xed\xfe'+b'synthetic library')
            if forbidden: (app/'material.key').write_text('synthetic forbidden file')
            def output(command, **kwargs):
                if command[0]=='lipo': return 'arm64\n'
                kind=library_platform if command[-1].endswith('Linked.dylib') else platform
                return f'Load command 1\n  platform {kind}\n'
            with patch.object(sys,'argv',[str(INSPECTOR),str(app),'--platform','IOS']), \
                 patch.object(subprocess,'check_output',side_effect=output), \
                 patch.object(subprocess,'run',return_value=subprocess.CompletedProcess([],1,b'',b'unsigned')), \
                 contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(str(INSPECTOR),run_name='__main__')

    def test_public_device_shape(self):
        self.inspect()

    def test_simulator_executable_rejected_even_when_arm64(self):
        with self.assertRaises(AssertionError): self.inspect(platform='IOSSIMULATOR')

    def test_simulator_library_rejected_even_with_device_executable(self):
        with self.assertRaises(AssertionError): self.inspect(library_platform='IOSSIMULATOR')

    def test_unmarked_package_rejected(self):
        with self.assertRaises(AssertionError): self.inspect(flavor='')

    def test_raw_key_file_rejected(self):
        with self.assertRaises(AssertionError): self.inspect(forbidden=True)

if __name__=='__main__': unittest.main()
