# SPDX-License-Identifier: MPL-2.0
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('selection', pathlib.Path(__file__).with_name('select-simulator.py'))
selection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selection)


class SimulatorSelectionTests(unittest.TestCase):
    def devices(self):
        return {'devices': {
            'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [
                {'name': 'iPhone 16', 'udid': 'old', 'isAvailable': True},
                {'name': 'iPad Pro 13-inch', 'udid': 'pad', 'isAvailable': True}],
            'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [
                {'name': 'iPhone 17', 'udid': 'new', 'isAvailable': True}],
            'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
                {'name': 'iPhone 18', 'udid': 'unsupported-sdk', 'isAvailable': True}],
            'com.apple.CoreSimulator.SimRuntime.iOS-16-0': [
                {'name': 'iPhone 14', 'udid': 'unavailable', 'isAvailable': False}],
        }}

    def test_never_chooses_future_sdk_or_unavailable_runtime(self):
        result = selection.select(self.devices(), '26.2', 'iPhone', 'latest')
        self.assertEqual(result['udid'], 'new')
        self.assertTrue(result['minimumOSAcceptancePending'])

    def test_oldest_and_device_family_are_real_distinct_selections(self):
        self.assertEqual(selection.select(self.devices(), '26.2', 'iPhone', 'oldest')['udid'], 'old')
        self.assertEqual(selection.select(self.devices(), '26.2', 'iPad', 'latest')['udid'], 'pad')

    def test_missing_compatible_runtime_fails_instead_of_fabricating_one(self):
        with self.assertRaises(ValueError):
            selection.select(self.devices(), '16.0', 'iPhone', 'latest')


if __name__ == '__main__':
    unittest.main()
