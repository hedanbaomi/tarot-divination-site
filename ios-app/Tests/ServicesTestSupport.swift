import Foundation
import XCTest
@testable import Quareia

final class MemoryServiceStore: ServiceKeyValueStore {
    private let lock = NSLock()
    private var values: [String: Data] = [:]

    func data(forKey key: String) -> Data? {
        lock.lock()
        defer { lock.unlock() }
        return values[key]
    }

    func set(_ data: Data?, forKey key: String) {
        lock.lock()
        defer { lock.unlock() }
        values[key] = data
    }
}

final class FakeServiceHTTPClient: ServiceHTTPClient {
    typealias DataHandler = (URLRequest, (URL) -> Bool) async throws -> ServiceHTTPDataResponse
    typealias DownloadHandler = (
        URLRequest,
        Int64,
        ((Int64) -> Void)?,
        (URL) -> Bool
    ) async throws -> ServiceHTTPDownloadResponse

    private let lock = NSLock()
    private var dataRequests: [URLRequest] = []
    private var downloadRequests: [URLRequest] = []
    private var cancelledOwners: [UUID] = []
    var dataHandler: DataHandler?
    var downloadHandler: DownloadHandler?

    func data(
        for request: URLRequest,
        owner: UUID,
        maximumBytes: Int,
        redirectValidator: @escaping (URL) -> Bool
    ) async throws -> ServiceHTTPDataResponse {
        lock.lock()
        dataRequests.append(request)
        let handler = dataHandler
        lock.unlock()
        guard let handler else { throw ServiceHTTPError.transport }
        let response = try await handler(request, redirectValidator)
        guard response.data.count <= maximumBytes else { throw ServiceHTTPError.responseTooLarge }
        return response
    }

    func download(
        for request: URLRequest,
        owner: UUID,
        maximumBytes: Int64,
        progress: ((Int64) -> Void)?,
        redirectValidator: @escaping (URL) -> Bool
    ) async throws -> ServiceHTTPDownloadResponse {
        lock.lock()
        downloadRequests.append(request)
        let handler = downloadHandler
        lock.unlock()
        guard let handler else { throw ServiceHTTPError.transport }
        return try await handler(request, maximumBytes, progress, redirectValidator)
    }

    func cancelRequests(owner: UUID) {
        lock.lock()
        cancelledOwners.append(owner)
        lock.unlock()
    }

    var dataRequestCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return dataRequests.count
    }

    var downloadRequestCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return downloadRequests.count
    }

    var cancellationCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return cancelledOwners.count
    }

    var capturedDataRequests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return dataRequests
    }
}

actor ServicesAsyncGate {
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { continuation in
            waiters.append(continuation)
        }
    }

    func open() {
        isOpen = true
        let pending = waiters
        waiters.removeAll()
        pending.forEach { $0.resume() }
    }
}

func testServiceConfiguration(
    announcements: Bool = true,
    telemetry: Bool = true,
    updates: Bool = true,
    trustedHosts: Set<String> = ["services.example"]
) -> ServiceConfiguration {
    let root = "https://services.example"
    return ServiceConfiguration.configured(
        announcementsURL: announcements ? URL(string: root + "/v1/announcements") : nil,
        telemetryURL: telemetry ? URL(string: root + "/v1/events") : nil,
        updateManifestURL: updates ? URL(string: root + "/ios/manifest.json") : nil,
        trustedHosts: trustedHosts
    )!
}

func makeDataResponse(
    for request: URLRequest,
    status: Int,
    headers: [String: String] = [:],
    body: Data = Data(),
    finalURL: URL? = nil
) -> ServiceHTTPDataResponse {
    ServiceHTTPDataResponse(
        statusCode: status,
        headers: headers,
        data: body,
        finalURL: finalURL ?? request.url!
    )
}

func eventually(
    timeout: TimeInterval = 2,
    condition: @escaping () async -> Bool
) async -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if await condition() { return true }
        try? await Task<Never, Never>.sleep(nanoseconds: 10_000_000)
    }
    return await condition()
}
