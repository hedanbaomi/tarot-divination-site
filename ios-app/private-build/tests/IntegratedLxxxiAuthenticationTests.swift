import CryptoKit
import Foundation
import ImageIO
import XCTest
@testable import Quareia

final class IntegratedLxxxiAuthenticationTests: XCTestCase {
    func testAuthenticatedFormatRejectsInvalidInputs() throws {
        let provider = IntegratedLxxxiProvider()
        var master = try IntegratedLxxxiProvider.deriveMasterKey()
        defer { master.resetBytes(in: 0..<master.count) }
        for logicalKey in IntegratedLxxxiProvider.logicalKeys {
            let record = try provider.encryptedRecord(for: logicalKey)
            var key = IntegratedLxxxiProvider.entryKey(master: master, logicalKey: logicalKey)
            defer { key.resetBytes(in: 0..<key.count) }
            var plain = try IntegratedLxxxiProvider.decryptRecord(record, entryKey: key, logicalKey: logicalKey)
            defer { plain.resetBytes(in: 0..<plain.count) }
            // Both Android WebP and the route's PNG are fully decoded by ImageIO.
            let png = try IntegratedLxxxiProvider.pngData(from: plain)
            XCTAssertTrue(AppRoute.isValidPNG(png))
            var wrongKey = key; wrongKey[0] ^= 1
            XCTAssertThrowsError(try IntegratedLxxxiProvider.decryptRecord(record, entryKey: wrongKey, logicalKey: logicalKey))
            var badNonce = record; badNonce[0] ^= 1
            XCTAssertThrowsError(try IntegratedLxxxiProvider.decryptRecord(badNonce, entryKey: key, logicalKey: logicalKey))
            var badTag = record; badTag[badTag.count - 1] ^= 1
            XCTAssertThrowsError(try IntegratedLxxxiProvider.decryptRecord(badTag, entryKey: key, logicalKey: logicalKey))
            var badCiphertext = record; badCiphertext[12] ^= 1
            XCTAssertThrowsError(try IntegratedLxxxiProvider.decryptRecord(badCiphertext, entryKey: key, logicalKey: logicalKey))
            XCTAssertThrowsError(try IntegratedLxxxiProvider.decryptRecord(Data(record.dropLast()), entryKey: key, logicalKey: logicalKey))
            var wrongMarker = IntegratedVaultMaterial.marker(); wrongMarker[0] ^= 1
            XCTAssertThrowsError(try IntegratedLxxxiProvider.decryptRecord(record, entryKey: key, logicalKey: logicalKey, marker: wrongMarker))
            let otherKey = logicalKey == "lxxxi-back" ? "lxxxi-01" : "lxxxi-back"
            XCTAssertThrowsError(try IntegratedLxxxiProvider.decryptRecord(record, entryKey: key, logicalKey: otherKey))
        }
        for bad in ["", "lxxxi-00", "lxxxi-82", "lxxxi-1", "lxxxi-001", "LXXXI-BACK", "../lxxxi-back", "/lxxxi-back", "lxxxi-back/..", "lxxxi-back%00", "lxxxi-back\u{0}"] {
            XCTAssertNil(try provider.imageData(for: bad))
            XCTAssertThrowsError(try provider.encryptedRecord(for: bad))
            XCTAssertThrowsError(try IntegratedLxxxiProvider.decryptRecord(Data(repeating: 0, count: 32), entryKey: Data(repeating: 0, count: 32), logicalKey: bad))
        }
        for count in [0, 1, 11, 12, 27, IntegratedLxxxiProvider.maximumRecordBytes + 1] {
            XCTAssertThrowsError(try IntegratedLxxxiProvider.decryptRecord(Data(repeating: 0, count: count), entryKey: Data(repeating: 0, count: 32), logicalKey: "lxxxi-back"))
        }
        XCTAssertThrowsError(try IntegratedLxxxiProvider.pngData(from: Data("RIFF0000WEBPnot-an-image".utf8)))
        let backKey = IntegratedLxxxiProvider.entryKey(master: master, logicalKey: "lxxxi-back")
        let aad = IntegratedVaultMaterial.record_aad_context() + IntegratedVaultMaterial.marker() + Data("lxxxi-back".utf8)
        for invalidImage in [Data(repeating: 65, count: 40), Data("RIFF0000WEBP".utf8) + Data(repeating: 0, count: 40)] {
            let box = try AES.GCM.seal(invalidImage, using: SymmetricKey(data: backKey), authenticating: aad)
            let authenticatedNonImage = try XCTUnwrap(box.combined)
            XCTAssertThrowsError(try IntegratedLxxxiProvider.pngData(from:
                IntegratedLxxxiProvider.decryptRecord(authenticatedNonImage, entryKey: backKey, logicalKey: "lxxxi-back")))
        }
        // Exercise bundled resources synchronously through the shipping route;
        // no URLSession or external service is involved in this offline path.
        let route = AppRoute(token: UUID().uuidString + UUID().uuidString,
                             publicResources: BundledPublicResourceStore(), imageProvider: provider)
        for path in ["index.html", "assets/cards/major-00.jpeg", "assets/cards/m/m-back.jpeg"] {
            let response = route.response(for: URL(string: "quareia-app://app/" + path), method: "GET")
            XCTAssertEqual(response.statusCode, 200)
            XCTAssertFalse(response.data.isEmpty)
            if path.hasSuffix(".jpeg") {
                let source = try XCTUnwrap(CGImageSourceCreateWithData(response.data as CFData, nil))
                XCTAssertNotNil(CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary))
                XCTAssertEqual(CGImageSourceGetStatusAtIndex(source, 0), .statusComplete)
            }
        }
        for logicalKey in ["lxxxi-back", "lxxxi-01", "lxxxi-20", "lxxxi-55", "lxxxi-81"] {
            let url = try XCTUnwrap(URL(string: route.protectedBaseURL + "/" + logicalKey))
            let response = route.response(for: url, method: "GET")
            XCTAssertEqual(response.statusCode, 200)
            XCTAssertEqual(response.mimeType, "image/png")
            XCTAssertEqual(response.headers["Cache-Control"], "no-store")
            XCTAssertTrue(AppRoute.isValidPNG(response.data))
            for method in ["POST", "PUT", "DELETE", "HEAD"] {
                XCTAssertEqual(route.response(for: url, method: method).statusCode, 404)
            }
            let wrong = URL(string: "quareia-app://app/_m/wrong/" + logicalKey)
            XCTAssertEqual(route.response(for: wrong, method: "GET").statusCode, 404)
        }
        print("PRIVATE_PROVIDER_OFFLINE_RESOURCE_PASS")
        print("PRIVATE_PROVIDER_AUTHENTICATION_NEGATIVE_PASS")
    }
}
