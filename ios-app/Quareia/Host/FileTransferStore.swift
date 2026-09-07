import Foundation

enum HostFileTransferError: BridgeCodedError, Equatable {
    case notFound
    case wrongDirection
    case invalidOffset
    case sizeMismatch
    case tooLarge
    case invalidContent
    case ioFailure
    case capacityExceeded

    var bridgeCode: String {
        switch self {
        case .notFound: return "TRANSFER_NOT_FOUND"
        case .wrongDirection: return "TRANSFER_WRONG_DIRECTION"
        case .invalidOffset: return "INVALID_OFFSET"
        case .sizeMismatch: return "SIZE_MISMATCH"
        case .tooLarge: return "TRANSFER_TOO_LARGE"
        case .invalidContent: return "INVALID_FILE_CONTENT"
        case .ioFailure: return "FILE_IO_FAILURE"
        case .capacityExceeded: return "TRANSFER_CAPACITY_EXCEEDED"
        }
    }
}

struct HostImportChunk: Equatable {
    let data: Data
    let offset: Int
    let eof: Bool
}

final class HostFileTransferStore {
    private enum Transfer {
        case exporting(kind: BridgeFileKind, name: String, expectedBytes: Int, data: Data, preparedURL: URL?)
        case importing(kind: BridgeFileKind, name: String, data: Data)
    }

    static let retentionInterval: TimeInterval = 24 * 60 * 60
    static let maximumRetainedFiles = 8
    static let maximumActiveTransfers = 4
    static let maximumBufferedBytes = 32 * 1024 * 1024
    private static let filePrefix = "transfer-"

    private let lock = NSRecursiveLock()
    private let fileManager: FileManager
    private let cacheDirectory: URL
    private var transfers: [String: Transfer] = [:]

    init(fileManager: FileManager = .default, cacheDirectory: URL? = nil) {
        self.fileManager = fileManager
        let base = cacheDirectory ?? fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first!
        self.cacheDirectory = base.appendingPathComponent("QuareiaTransfers", isDirectory: true)
        prepareCache()
    }

    func beginExport(kind: BridgeFileKind, name: String, expectedBytes: Int) throws -> String {
        let maximum = kind == .qsp ? BridgeValidator.maximumQSPBytes : BridgeValidator.maximumTransferBytes
        guard expectedBytes >= 0, expectedBytes <= maximum else { throw HostFileTransferError.tooLarge }
        let identifier = UUID().uuidString.lowercased()
        lock.lock()
        guard transfers.count < Self.maximumActiveTransfers else {
            lock.unlock()
            throw HostFileTransferError.capacityExceeded
        }
        transfers[identifier] = .exporting(
            kind: kind,
            name: name,
            expectedBytes: expectedBytes,
            data: Data(),
            preparedURL: nil
        )
        lock.unlock()
        return identifier
    }

    func appendExport(identifier: String, offset: Int, chunk: Data) throws -> (offset: Int, byteCount: Int, nextOffset: Int) {
        guard chunk.count <= BridgeValidator.maximumChunkBytes else { throw HostFileTransferError.tooLarge }
        lock.lock()
        defer { lock.unlock() }
        guard case let .exporting(kind, name, expectedBytes, existing, preparedURL) = transfers[identifier] else {
            throw transfers[identifier] == nil ? HostFileTransferError.notFound : HostFileTransferError.wrongDirection
        }
        guard preparedURL == nil else { throw HostFileTransferError.wrongDirection }
        guard offset == existing.count else { throw HostFileTransferError.invalidOffset }
        guard existing.count + chunk.count <= expectedBytes,
              existing.count + chunk.count <= BridgeValidator.maximumTransferBytes else {
            throw HostFileTransferError.tooLarge
        }
        guard totalBufferedBytes() + chunk.count <= Self.maximumBufferedBytes else {
            throw HostFileTransferError.capacityExceeded
        }
        var data = existing
        data.append(chunk)
        transfers[identifier] = .exporting(
            kind: kind,
            name: name,
            expectedBytes: expectedBytes,
            data: data,
            preparedURL: nil
        )
        return (offset, chunk.count, data.count)
    }

    func prepareExport(identifier: String) throws -> (url: URL, name: String) {
        lock.lock()
        defer { lock.unlock() }
        guard case let .exporting(kind, name, expectedBytes, data, preparedURL) = transfers[identifier] else {
            throw transfers[identifier] == nil ? HostFileTransferError.notFound : HostFileTransferError.wrongDirection
        }
        if let preparedURL { return (preparedURL, name) }
        guard data.count == expectedBytes else { throw HostFileTransferError.sizeMismatch }
        try Self.validate(data: data, kind: kind)
        let url = cacheDirectory.appendingPathComponent(Self.filePrefix + identifier + "-" + name, isDirectory: false)
        do {
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var mutableURL = url
            try mutableURL.setResourceValues(values)
        } catch {
            try? fileManager.removeItem(at: url)
            throw HostFileTransferError.ioFailure
        }
        transfers[identifier] = .exporting(
            kind: kind,
            name: name,
            expectedBytes: expectedBytes,
            data: Data(),
            preparedURL: url
        )
        return (url, name)
    }

    func beginImport(kind: BridgeFileKind, url: URL) throws -> (identifier: String, name: String, byteCount: Int) {
        let didAccess = url.startAccessingSecurityScopedResource()
        defer { if didAccess { url.stopAccessingSecurityScopedResource() } }
        let data: Data
        do {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            let maximum = kind == .qsp ? BridgeValidator.maximumQSPBytes : BridgeValidator.maximumTransferBytes
            let size = try handle.seekToEnd()
            guard size <= UInt64(maximum) else { throw HostFileTransferError.tooLarge }
            try handle.seek(toOffset: 0)
            data = try handle.readToEnd() ?? Data()
            guard data.count == Int(size) else { throw HostFileTransferError.ioFailure }
        } catch let error as HostFileTransferError {
            throw error
        } catch {
            throw HostFileTransferError.ioFailure
        }
        return try beginImport(kind: kind, name: Self.safeImportedName(url.lastPathComponent, kind: kind), data: data)
    }

    func beginImport(kind: BridgeFileKind, name: String, data: Data) throws -> (identifier: String, name: String, byteCount: Int) {
        let maximum = kind == .qsp ? BridgeValidator.maximumQSPBytes : BridgeValidator.maximumTransferBytes
        guard data.count <= maximum else { throw HostFileTransferError.tooLarge }
        try Self.validate(data: data, kind: kind)
        let identifier = UUID().uuidString.lowercased()
        lock.lock()
        guard transfers.count < Self.maximumActiveTransfers,
              totalBufferedBytes() + data.count <= Self.maximumBufferedBytes else {
            lock.unlock()
            throw HostFileTransferError.capacityExceeded
        }
        transfers[identifier] = .importing(kind: kind, name: name, data: data)
        lock.unlock()
        return (identifier, name, data.count)
    }

    func readImport(identifier: String, offset: Int, length: Int) throws -> HostImportChunk {
        guard length > 0, length <= BridgeValidator.maximumChunkBytes else { throw HostFileTransferError.tooLarge }
        lock.lock()
        defer { lock.unlock() }
        guard case let .importing(_, _, data) = transfers[identifier] else {
            throw transfers[identifier] == nil ? HostFileTransferError.notFound : HostFileTransferError.wrongDirection
        }
        guard offset >= 0, offset <= data.count else { throw HostFileTransferError.invalidOffset }
        let end = min(offset + length, data.count)
        return HostImportChunk(data: data.subdata(in: offset..<end), offset: offset, eof: end == data.count)
    }

    func finishImport(identifier: String) throws {
        lock.lock()
        defer { lock.unlock() }
        guard case .importing = transfers[identifier] else {
            throw transfers[identifier] == nil ? HostFileTransferError.notFound : HostFileTransferError.wrongDirection
        }
        transfers.removeValue(forKey: identifier)
    }

    func cancel(identifier: String) throws {
        lock.lock()
        defer { lock.unlock() }
        guard let transfer = transfers.removeValue(forKey: identifier) else { throw HostFileTransferError.notFound }
        if case let .exporting(_, _, _, _, preparedURL) = transfer, let preparedURL {
            try? fileManager.removeItem(at: preparedURL)
        }
    }

    func completeExport(identifier: String) {
        try? cancel(identifier: identifier)
    }

    func cancelAll() {
        lock.lock()
        let urls = transfers.values.compactMap { transfer -> URL? in
            if case let .exporting(_, _, _, _, url) = transfer { return url }
            return nil
        }
        transfers.removeAll()
        lock.unlock()
        urls.forEach { try? fileManager.removeItem(at: $0) }
    }

    private func prepareCache() {
        do {
            try fileManager.createDirectory(
                at: cacheDirectory,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
            )
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var directory = cacheDirectory
            try directory.setResourceValues(values)
        } catch {
            return
        }
        cleanupRetainedFiles(now: Date())
    }

    func cleanupRetainedFiles(now: Date) {
        guard let urls = try? fileManager.contentsOfDirectory(
            at: cacheDirectory,
            includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        let candidates = urls.compactMap { url -> (URL, Date)? in
            guard url.lastPathComponent.hasPrefix(Self.filePrefix),
                  let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey]),
                  values.isRegularFile == true else { return nil }
            return (url, values.contentModificationDate ?? .distantPast)
        }.sorted { $0.1 > $1.1 }
        for (index, candidate) in candidates.enumerated()
            where index >= Self.maximumRetainedFiles || now.timeIntervalSince(candidate.1) > Self.retentionInterval {
            try? fileManager.removeItem(at: candidate.0)
        }
    }

    private static func validate(data: Data, kind: BridgeFileKind) throws {
        let maximum = kind == .qsp ? BridgeValidator.maximumQSPBytes : BridgeValidator.maximumTransferBytes
        guard data.count <= maximum else { throw HostFileTransferError.tooLarge }
        guard String(data: data, encoding: .utf8) != nil else { throw HostFileTransferError.invalidContent }
        guard kind != .qsp else { return }
        guard let object = try? JSONSerialization.jsonObject(with: data),
              object is [String: Any] || object is [Any] else {
            throw HostFileTransferError.invalidContent
        }
    }

    private func totalBufferedBytes() -> Int {
        transfers.values.reduce(into: 0) { total, transfer in
            switch transfer {
            case let .exporting(_, _, _, data, _): total += data.count
            case let .importing(_, _, data): total += data.count
            }
        }
    }

    private static func safeImportedName(_ name: String, kind: BridgeFileKind) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty, trimmed.utf8.count <= 128,
           !trimmed.hasPrefix("."), !trimmed.contains("/"), !trimmed.contains("\\"), !trimmed.contains(":") {
            return trimmed
        }
        return kind == .qsp ? "import.qsp" : "import.json"
    }
}
