import CryptoKit
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

/// Private compatibility adapter. All plaintext remains in process memory.
/// Neither key derivation nor associated data depends on signing or bundle identity.
final class IntegratedLxxxiProvider: LxxxiImageProviding {
    enum Failure: Error { case invalidInput, unavailable, invalidImage }
    static let logicalKeys = ["lxxxi-back"] + (1...81).map { String(format: "lxxxi-%02d", $0) }
    private static let allowedKeys = Set(logicalKeys)
    static let maximumRecordBytes = 512 * 1024
    private let bundle: Bundle

    init(bundle: Bundle = .main) { self.bundle = bundle }

    func imageData(for logicalKey: String) throws -> Data? {
        guard Self.isAllowed(logicalKey) else { return nil }
        let record = try encryptedRecord(for: logicalKey)
        var master = try Self.deriveMasterKey()
        defer { master.resetBytes(in: 0..<master.count) }
        var entry = Self.entryKey(master: master, logicalKey: logicalKey)
        defer { entry.resetBytes(in: 0..<entry.count) }
        var webp = try Self.decryptRecord(record, entryKey: entry, logicalKey: logicalKey)
        defer { webp.resetBytes(in: 0..<webp.count) }
        return try Self.pngData(from: webp)
    }

    static func isAllowed(_ logicalKey: String) -> Bool { allowedKeys.contains(logicalKey) }

    // The fixed logical allowlist is the only resource selection interface.
    func encryptedRecord(for logicalKey: String) throws -> Data {
        guard Self.isAllowed(logicalKey), let resources = bundle.resourceURL else { throw Failure.invalidInput }
        let url = resources.appendingPathComponent("PrivateAssets", isDirectory: true)
            .appendingPathComponent("lxxxi", isDirectory: true)
            .appendingPathComponent(logicalKey + ".qv", isDirectory: false)
        let attributes = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard attributes.isRegularFile == true, attributes.isSymbolicLink == false,
              let size = attributes.fileSize, (28...Self.maximumRecordBytes).contains(size) else { throw Failure.unavailable }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: Self.maximumRecordBytes + 1) ?? Data()
        guard data.count == size else { throw Failure.unavailable }
        return data
    }

    static func entryKey(master: Data, logicalKey: String) -> Data {
        hmac(master, IntegratedVaultMaterial.entry_context() + Data(logicalKey.utf8))
    }

    static func decryptRecord(_ record: Data, entryKey: Data, logicalKey: String,
                              marker: Data = IntegratedVaultMaterial.marker()) throws -> Data {
        guard isAllowed(logicalKey), entryKey.count == 32, marker.count == 8,
              (28...maximumRecordBytes).contains(record.count) else { throw Failure.invalidInput }
        let aad = IntegratedVaultMaterial.record_aad_context() + marker + Data(logicalKey.utf8)
        let plain = try openGCM(key: entryKey, nonce: Data(record.prefix(12)),
                                ciphertextAndTag: Data(record.dropFirst(12)), aad: aad)
        guard (32...maximumRecordBytes).contains(plain.count),
              plain.prefix(4) == Data("RIFF".utf8),
              plain.subdata(in: 8..<12) == Data("WEBP".utf8) else { throw Failure.invalidImage }
        return plain
    }

    static func deriveMasterKey() throws -> Data {
        var marker = IntegratedVaultMaterial.marker()
        var salt = IntegratedVaultMaterial.salt()
        var shards = [IntegratedVaultMaterial.shard_a(), IntegratedVaultMaterial.shard_b(),
                      IntegratedVaultMaterial.shard_c(), IntegratedVaultMaterial.shard_d(),
                      IntegratedVaultMaterial.shard_e()]
        var seed = Data(count: 32)
        defer {
            marker.resetBytes(in: 0..<marker.count); salt.resetBytes(in: 0..<salt.count)
            seed.resetBytes(in: 0..<seed.count)
            for i in shards.indices { shards[i].resetBytes(in: 0..<shards[i].count) }
        }
        guard marker.count == 8, salt.count == 16, shards.allSatisfy({ $0.count == 32 }) else { throw Failure.invalidInput }
        for index in 0..<32 {
            let left = Int(shards[0][(index * 5 + 7) % 32])
            let middle = rotate8(Int(shards[1][(index * 11 + 3) % 32]), (index % 5) + 1)
            let right = Int(shards[2][(index * 13 + 17) % 32])
            let subtract = Int(shards[3][(index * 7 + 19) % 32])
            let mixed = ((left ^ middle) + right - subtract) & 255
            seed[index] = UInt8(mixed ^ Int(shards[4][(index * 3 + 23) % 32]))
        }
        var wrapKey = hmac(seed, IntegratedVaultMaterial.wrap_context() + marker + salt)
        defer { wrapKey.resetBytes(in: 0..<wrapKey.count) }
        let wrapped = IntegratedVaultMaterial.wrapped_master()
        guard wrapped.count == 48 else { throw Failure.invalidInput }
        let master = try openGCM(key: wrapKey, nonce: IntegratedVaultMaterial.wrap_iv(),
                                  ciphertextAndTag: wrapped, aad: marker + salt)
        guard master.count == 32 else { throw Failure.invalidInput }
        return master
    }

    private static func rotate8(_ value: Int, _ amount: Int) -> Int {
        let shift = amount & 7
        return ((value << shift) | (value >> (8 - shift))) & 255
    }

    private static func hmac(_ key: Data, _ message: Data) -> Data {
        Data(HMAC<SHA256>.authenticationCode(for: message, using: SymmetricKey(data: key)))
    }

    private static func openGCM(key: Data, nonce: Data, ciphertextAndTag: Data, aad: Data) throws -> Data {
        guard key.count == 32, nonce.count == 12, ciphertextAndTag.count >= 16 else { throw Failure.invalidInput }
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce),
                                       ciphertext: ciphertextAndTag.dropLast(16), tag: ciphertextAndTag.suffix(16))
        // CryptoKit releases plaintext only after authenticating the entire record.
        return try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: aad)
    }

    static func pngData(from webp: Data) throws -> Data {
        guard webp.count <= maximumRecordBytes,
              let source = CGImageSourceCreateWithData(webp as CFData, nil),
              CGImageSourceGetCount(source) == 1, CGImageSourceGetStatus(source) == .statusComplete,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              (1...4096).contains(width), (1...4096).contains(height), width * height <= 16_777_216,
              let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary),
              CGImageSourceGetStatusAtIndex(source, 0) == .statusComplete,
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw Failure.invalidImage }
        context.draw(image, in: CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
        guard let decoded = context.makeImage() else { throw Failure.invalidImage }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output as CFMutableData, UTType.png.identifier as CFString, 1, nil) else { throw Failure.invalidImage }
        CGImageDestinationAddImage(destination, decoded, nil)
        guard CGImageDestinationFinalize(destination) else { throw Failure.invalidImage }
        let png = output as Data
        guard AppRoute.isValidPNG(png) else { throw Failure.invalidImage }
        return png
    }
}
