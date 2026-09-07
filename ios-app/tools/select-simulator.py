#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Select an actually installed simulator supported by the selected stable SDK."""
import argparse
import json
import re

# This installed runtime crashes before app startup for deployment targets below
# 18.4 when Swift WebKit overlays are used. Reproduced with Xcode 16.4 and 26.3;
# https://bugs.webkit.org/show_bug.cgi?id=293831 . Do not raise the app target or
# patch system libraries to conceal it. Test the next installed older runtime.
UNUSABLE_RUNTIMES = {(18, 5): 'WebKit 293831: missing libswiftWebKit.dylib at app load'}


def select(data, sdk, family, policy):
    supported = tuple(int(n) for n in sdk.split('.')[:2])
    choices = []
    installed = set()
    excluded = {}
    for runtime, devices in data.get('devices', {}).items():
        match = re.search(r'\.iOS-(\d+)-(\d+)$', runtime)
        if not match:
            continue
        version = tuple(map(int, match.groups()))
        if version < (16, 0) or version > supported:
            continue
        for device in devices:
            if device.get('isAvailable') and device.get('name', '').startswith(family):
                installed.add(version)
                if version in UNUSABLE_RUNTIMES:
                    excluded['.'.join(map(str, version))] = UNUSABLE_RUNTIMES[version]
                    continue
                numbers = tuple(map(int, re.findall(r'\d+', device['name'])))
                choices.append((version, numbers, device['name'], runtime, device))
    if not choices:
        raise ValueError('No installed available ' + family + ' runtime supported by SDK ' + sdk)
    versions = sorted(set(item[0] for item in choices))
    chosen_version = versions[0] if policy == 'oldest' else versions[-1]
    _, _, _, runtime, device = max(
        (item for item in choices if item[0] == chosen_version), key=lambda item: item[:3]
    )
    return {
        'runtime': runtime, 'name': device['name'], 'udid': device['udid'],
        'sdk': sdk, 'policy': policy, 'family': family,
        'availableVersions': ['.'.join(map(str, version)) for version in sorted(installed)],
        'eligibleVersions': ['.'.join(map(str, version)) for version in versions],
        'excludedRuntimes': excluded,
        'minimumOSAcceptancePending': not any(version[0] == 16 for version in versions),
        'olderRuntimeAvailable': len(versions) > 1,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('devices')
    parser.add_argument('--sdk', required=True)
    parser.add_argument('--family', choices=['iPhone', 'iPad'], default='iPhone')
    parser.add_argument('--policy', choices=['latest', 'oldest'], default='latest')
    args = parser.parse_args()
    with open(args.devices, encoding='utf-8') as source:
        print(json.dumps(select(json.load(source), args.sdk, args.family, args.policy)))
