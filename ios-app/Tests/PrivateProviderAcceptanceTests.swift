import Foundation
import XCTest
@testable import Quareia

// This test is absent from public test execution. Only the separately approved
// ephemeral private build may supply the concrete provider and encrypted input.
#if PRIVATE_LXXXI_PROVIDER
final class PrivateProviderAcceptanceTests: XCTestCase {
    func testIntegratedProviderDecodesExactRecordSet() throws {
        let keys = ["lxxxi-back"] + (1...81).map { String(format: "lxxxi-%02d", $0) }
        let directory = try XCTUnwrap(Bundle.main.resourceURL?
            .appendingPathComponent("PrivateAssets/lxxxi", isDirectory: true))
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        XCTAssertEqual(Set(files.map(\.lastPathComponent)), Set(keys.map { $0 + ".qv" }))
        for file in files {
            let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            XCTAssertEqual(values.isRegularFile, true)
            XCTAssertEqual(values.isSymbolicLink, false)
        }
        let provider = try XCTUnwrap(LxxxiImageProviderFactory.make())
        for key in keys {
            let bytes = try XCTUnwrap(provider.imageData(for: key), "Missing logical image")
            XCTAssertTrue(AppRoute.isValidPNG(bytes), "Provider returned an undecodable image")
            print("PRIVATE_PROVIDER_DECODE_OK:" + key)
        }
        print("PRIVATE_PROVIDER_82_DECODE_PASS")
    }
}
#endif
