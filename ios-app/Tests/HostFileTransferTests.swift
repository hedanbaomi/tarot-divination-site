import XCTest
@testable import Quareia

final class HostFileTransferTests: XCTestCase {
    private var roots: [URL] = []

    override func tearDown() {
        for root in roots { try? FileManager.default.removeItem(at: root) }
        roots.removeAll()
        super.tearDown()
    }

    func testExportRequiresSequentialCompleteValidJSONAndCleansPreparedFile() throws {
        let store = makeStore()
        let data = Data(#"{"version":1,"items":[]}"#.utf8)
        let identifier = try store.beginExport(kind: .history, name: "history.json", expectedBytes: data.count)
        let first = try store.appendExport(identifier: identifier, offset: 0, chunk: data.prefix(8))
        XCTAssertEqual(first.nextOffset, 8)
        XCTAssertThrowsError(try store.appendExport(identifier: identifier, offset: 7, chunk: data.dropFirst(8))) {
            XCTAssertEqual($0 as? HostFileTransferError, .invalidOffset)
        }
        _ = try store.appendExport(identifier: identifier, offset: 8, chunk: data.dropFirst(8))
        let prepared = try store.prepareExport(identifier: identifier)
        XCTAssertEqual(try Data(contentsOf: prepared.url), data)
        XCTAssertTrue(FileManager.default.fileExists(atPath: prepared.url.path))
        store.completeExport(identifier: identifier)
        XCTAssertFalse(FileManager.default.fileExists(atPath: prepared.url.path))
    }

    func testIncompleteAndInvalidJSONNeverReachPickerFile() throws {
        let store = makeStore()
        let incomplete = try store.beginExport(kind: .backup, name: "backup.json", expectedBytes: 10)
        _ = try store.appendExport(identifier: incomplete, offset: 0, chunk: Data("{}".utf8))
        XCTAssertThrowsError(try store.prepareExport(identifier: incomplete)) {
            XCTAssertEqual($0 as? HostFileTransferError, .sizeMismatch)
        }

        let invalidData = Data("not-json".utf8)
        let invalid = try store.beginExport(kind: .history, name: "history.json", expectedBytes: invalidData.count)
        _ = try store.appendExport(identifier: invalid, offset: 0, chunk: invalidData)
        XCTAssertThrowsError(try store.prepareExport(identifier: invalid)) {
            XCTAssertEqual($0 as? HostFileTransferError, .invalidContent)
        }
    }

    func testImportIsChunkedBoundedAndRemovedOnFinish() throws {
        let store = makeStore()
        let data = Data(#"{"items":[1,2,3]}"#.utf8)
        let imported = try store.beginImport(kind: .history, name: "history.json", data: data)
        let first = try store.readImport(identifier: imported.identifier, offset: 0, length: 5)
        XCTAssertEqual(first.data, data.prefix(5))
        XCTAssertFalse(first.eof)
        let last = try store.readImport(identifier: imported.identifier, offset: 5, length: 32)
        XCTAssertEqual(first.data + last.data, data)
        XCTAssertTrue(last.eof)
        try store.finishImport(identifier: imported.identifier)
        XCTAssertThrowsError(try store.readImport(identifier: imported.identifier, offset: 0, length: 1)) {
            XCTAssertEqual($0 as? HostFileTransferError, .notFound)
        }
    }

    func testQSPUsesTighterUTF8BoundAndJSONKindsRejectScalars() throws {
        let store = makeStore()
        let qsp = Data("QSP2.payload.checksum".utf8)
        XCTAssertNoThrow(try store.beginImport(kind: .qsp, name: "spread.qsp", data: qsp))
        XCTAssertThrowsError(try store.beginImport(
            kind: .qsp,
            name: "spread.qsp",
            data: Data(repeating: 0x61, count: BridgeValidator.maximumQSPBytes + 1)
        )) {
            XCTAssertEqual($0 as? HostFileTransferError, .tooLarge)
        }
        XCTAssertThrowsError(try store.beginImport(kind: .backup, name: "backup.json", data: Data("1".utf8))) {
            XCTAssertEqual($0 as? HostFileTransferError, .invalidContent)
        }
    }

    func testStartupCleanupIsPrefixAgeAndCountBounded() throws {
        let root = temporaryRoot()
        let directory = root.appendingPathComponent("QuareiaTransfers", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let stale = directory.appendingPathComponent("transfer-stale.json")
        let unrelated = directory.appendingPathComponent("keep.txt")
        try Data("{}".utf8).write(to: stale)
        try Data("keep".utf8).write(to: unrelated)
        try FileManager.default.setAttributes(
            [.modificationDate: Date().addingTimeInterval(-HostFileTransferStore.retentionInterval - 1)],
            ofItemAtPath: stale.path
        )
        _ = HostFileTransferStore(cacheDirectory: root)
        XCTAssertFalse(FileManager.default.fileExists(atPath: stale.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: unrelated.path))
    }

    func testActiveTransferCountIsBounded() throws {
        let store = makeStore()
        for index in 0..<HostFileTransferStore.maximumActiveTransfers {
            _ = try store.beginExport(kind: .history, name: "history-\(index).json", expectedBytes: 0)
        }
        XCTAssertThrowsError(try store.beginExport(kind: .history, name: "overflow.json", expectedBytes: 0)) {
            XCTAssertEqual($0 as? HostFileTransferError, .capacityExceeded)
        }
    }

    private func makeStore() -> HostFileTransferStore {
        HostFileTransferStore(cacheDirectory: temporaryRoot())
    }

    private func temporaryRoot() -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        roots.append(root)
        return root
    }
}
