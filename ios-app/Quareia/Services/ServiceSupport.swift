import CryptoKit
import Foundation

enum ServiceLocale {
    private static let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-")

    static func normalized(_ raw: String) -> String {
        let candidate = raw.replacingOccurrences(of: "_", with: "-")
        return isValid(candidate) ? candidate : "und"
    }

    static func isValid(_ value: String) -> Bool {
        guard !value.isEmpty, value.utf8.count <= 64,
              !value.hasPrefix("-"), !value.hasSuffix("-"), !value.contains("--")
        else { return false }
        return value.unicodeScalars.allSatisfy { allowed.contains($0) }
    }
}

struct AppBuildInfo: Equatable {
    static let maximumVersionCode = Int(Int32.max)

    let displayVersion: String
    let versionCode: Int
    let locale: String
    let iosMajor: Int
    let iosMinor: Int

    init(
        displayVersion: String,
        versionCode: Int,
        locale: String,
        iosMajor: Int,
        iosMinor: Int = 0
    ) {
        self.displayVersion = displayVersion
        self.versionCode = versionCode
        self.locale = locale
        self.iosMajor = iosMajor
        self.iosMinor = iosMinor
    }

    var isValidForServices: Bool {
        !displayVersion.isEmpty &&
            displayVersion.utf8.count <= 64 &&
            (1...Self.maximumVersionCode).contains(versionCode) &&
            ServiceLocale.isValid(locale) &&
            (1...100).contains(iosMajor) &&
            (0...99).contains(iosMinor)
    }

    static func current(
        bundle: Bundle = .main,
        locale currentLocale: Locale = .current,
        operatingSystemVersion: OperatingSystemVersion = ProcessInfo.processInfo.operatingSystemVersion
    ) -> AppBuildInfo? {
        guard
            let rawDisplayVersion = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
            let rawVersionCode = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        else { return nil }

        let displayVersion = rawDisplayVersion.trimmingCharacters(in: .whitespacesAndNewlines)
        let versionCodeString = rawVersionCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            !displayVersion.isEmpty,
            displayVersion.utf8.count <= 64,
            !versionCodeString.isEmpty,
            versionCodeString.unicodeScalars.allSatisfy({ CharacterSet.decimalDigits.contains($0) }),
            let versionCode = Int(versionCodeString),
            (1...maximumVersionCode).contains(versionCode),
            (1...100).contains(operatingSystemVersion.majorVersion)
        else { return nil }

        let locale = ServiceLocale.normalized(currentLocale.identifier)
        return AppBuildInfo(
            displayVersion: displayVersion,
            versionCode: versionCode,
            locale: locale,
            iosMajor: operatingSystemVersion.majorVersion,
            iosMinor: operatingSystemVersion.minorVersion
        )
    }
}

struct ServiceConfiguration: Equatable {
    let announcementsURL: URL?
    let telemetryURL: URL?
    let updateManifestURL: URL?
    let trustedHosts: Set<String>
    let trustedArtifactHosts: Set<String>
    fileprivate let permitsExplicitLoopbackFixture: Bool

    static let unconfigured = ServiceConfiguration(
        announcementsURL: nil,
        telemetryURL: nil,
        updateManifestURL: nil,
        trustedHosts: [],
        trustedArtifactHosts: [],
        permitsExplicitLoopbackFixture: false
    )

    static func configured(
        announcementsURL: URL? = nil,
        telemetryURL: URL? = nil,
        updateManifestURL: URL? = nil,
        trustedHosts: Set<String>,
        trustedArtifactHosts: Set<String>? = nil
    ) -> ServiceConfiguration? {
        let normalizedHosts = Set(trustedHosts.map { $0.lowercased() })
        let normalizedArtifactHosts = Set((trustedArtifactHosts ?? trustedHosts).map { $0.lowercased() })
        guard !normalizedHosts.isEmpty else { return nil }
        let configuration = ServiceConfiguration(
            announcementsURL: announcementsURL,
            telemetryURL: telemetryURL,
            updateManifestURL: updateManifestURL,
            trustedHosts: normalizedHosts,
            trustedArtifactHosts: normalizedArtifactHosts,
            permitsExplicitLoopbackFixture: false
        )
        let endpoints = [announcementsURL, telemetryURL, updateManifestURL].compactMap { $0 }
        guard !endpoints.isEmpty, endpoints.allSatisfy(configuration.allowsServiceURL) else { return nil }
        return configuration
    }

    #if PUBLIC_TESTING
    static func fixtureEnvironment(
        baseURL: URL,
        explicitFixtureEnvironment: Bool,
        updateManifestPath: String? = nil
    ) -> ServiceConfiguration? {
        guard
            explicitFixtureEnvironment,
            baseURL.scheme?.lowercased() == "http",
            baseURL.host?.lowercased() == "127.0.0.1",
            baseURL.port == 8787,
            baseURL.user == nil,
            baseURL.password == nil,
            baseURL.query == nil,
            baseURL.fragment == nil,
            baseURL.path.isEmpty || baseURL.path == "/"
        else { return nil }

        let root = URL(string: "http://127.0.0.1:8787")!
        let manifestURL: URL?
        if let updateManifestPath {
            guard
                updateManifestPath.hasPrefix("/"),
                !updateManifestPath.contains(".."),
                !updateManifestPath.contains("\\"),
                let resolved = URL(string: updateManifestPath, relativeTo: root)?.absoluteURL
            else { return nil }
            manifestURL = resolved
        } else {
            manifestURL = nil
        }
        return ServiceConfiguration(
            announcementsURL: URL(string: "/v1/announcements", relativeTo: root)?.absoluteURL,
            telemetryURL: URL(string: "/v1/events", relativeTo: root)?.absoluteURL,
            updateManifestURL: manifestURL,
            trustedHosts: ["127.0.0.1"],
            trustedArtifactHosts: ["127.0.0.1"],
            permitsExplicitLoopbackFixture: true
        )
    }
    #endif

    func allowsServiceURL(_ url: URL) -> Bool {
        allowsURL(url, trustedHosts: trustedHosts)
    }

    func allowsArtifactURL(_ url: URL) -> Bool {
        allowsURL(url, trustedHosts: trustedArtifactHosts)
    }

    private func allowsURL(_ url: URL, trustedHosts: Set<String>) -> Bool {
        guard
            url.user == nil,
            url.password == nil,
            let host = url.host?.lowercased(),
            trustedHosts.contains(host)
        else { return false }

        if url.scheme?.lowercased() == "https" {
            return url.port == nil || url.port == 443
        }
        return permitsExplicitLoopbackFixture &&
            url.scheme?.lowercased() == "http" &&
            host == "127.0.0.1" &&
            url.port == 8787
    }
}

protocol ServiceKeyValueStore: AnyObject {
    func data(forKey key: String) -> Data?
    func set(_ data: Data?, forKey key: String)
}

final class UserDefaultsServiceStore: ServiceKeyValueStore {
    private let defaults: UserDefaults

    init(suiteName: String) {
        defaults = UserDefaults(suiteName: suiteName) ?? .standard
    }

    init(defaults: UserDefaults) {
        self.defaults = defaults
    }

    func data(forKey key: String) -> Data? {
        defaults.data(forKey: key)
    }

    func set(_ data: Data?, forKey key: String) {
        if let data {
            defaults.set(data, forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
    }
}

enum ServiceHTTPError: Error, Equatable {
    case invalidURL
    case untrustedURL
    case responseTooLarge
    case invalidResponse
    case cancelled
    case transport
    case fileIO
}

struct ServiceHTTPDataResponse {
    let statusCode: Int
    let headers: [String: String]
    let data: Data
    let finalURL: URL
}

struct ServiceHTTPDownloadResponse {
    let statusCode: Int
    let headers: [String: String]
    let fileURL: URL
    let byteCount: Int64
    let finalURL: URL
}

protocol ServiceHTTPClient: AnyObject {
    func data(
        for request: URLRequest,
        owner: UUID,
        maximumBytes: Int,
        redirectValidator: @escaping (URL) -> Bool
    ) async throws -> ServiceHTTPDataResponse

    func download(
        for request: URLRequest,
        owner: UUID,
        maximumBytes: Int64,
        progress: ((Int64) -> Void)?,
        redirectValidator: @escaping (URL) -> Bool
    ) async throws -> ServiceHTTPDownloadResponse

    func cancelRequests(owner: UUID)
}

private final class ServiceTaskToken {
    private let lock = NSLock()
    private var task: URLSessionTask?
    private var cancellationRequested = false

    func install(_ task: URLSessionTask) {
        lock.lock()
        self.task = task
        let shouldCancel = cancellationRequested
        lock.unlock()
        if shouldCancel { task.cancel() }
    }

    func cancel() {
        lock.lock()
        cancellationRequested = true
        let task = self.task
        lock.unlock()
        task?.cancel()
    }
}

final class URLSessionHTTPClient: NSObject, ServiceHTTPClient {
    private enum Completion {
        case data(CheckedContinuation<ServiceHTTPDataResponse, Error>)
        case download(CheckedContinuation<ServiceHTTPDownloadResponse, Error>)
    }

    private enum Sink {
        case memory(Data)
        case file(URL, FileHandle, Int64)
    }

    private final class RequestState {
        let owner: UUID
        let maximumBytes: Int64
        let redirectValidator: (URL) -> Bool
        let completion: Completion
        let downloadProgress: ((Int64) -> Void)?
        weak var task: URLSessionTask?
        var sink: Sink
        var response: HTTPURLResponse?
        var terminalError: ServiceHTTPError?

        init(
            owner: UUID,
            maximumBytes: Int64,
            redirectValidator: @escaping (URL) -> Bool,
            completion: Completion,
            downloadProgress: ((Int64) -> Void)?,
            sink: Sink
        ) {
            self.owner = owner
            self.maximumBytes = maximumBytes
            self.redirectValidator = redirectValidator
            self.completion = completion
            self.downloadProgress = downloadProgress
            self.sink = sink
        }
    }

    private let lock = NSLock()
    private var requests: [Int: RequestState] = [:]
    private let delegateQueue: OperationQueue
    private var session: URLSession!

    init(configuration: URLSessionConfiguration = .ephemeral) {
        let copy = configuration.copy() as? URLSessionConfiguration ?? configuration
        copy.httpShouldSetCookies = false
        copy.httpCookieAcceptPolicy = .never
        copy.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        copy.urlCache = nil
        copy.timeoutIntervalForRequest = 10
        copy.timeoutIntervalForResource = 30
        copy.httpMaximumConnectionsPerHost = 2
        let queue = OperationQueue()
        queue.name = "fun.luotianyi.quareia.services.http"
        queue.maxConcurrentOperationCount = 1
        delegateQueue = queue
        super.init()
        session = URLSession(
            configuration: copy,
            delegate: self,
            delegateQueue: queue
        )
    }

    func data(
        for request: URLRequest,
        owner: UUID,
        maximumBytes: Int,
        redirectValidator: @escaping (URL) -> Bool
    ) async throws -> ServiceHTTPDataResponse {
        guard maximumBytes > 0, let url = request.url else { throw ServiceHTTPError.invalidURL }
        guard redirectValidator(url) else { throw ServiceHTTPError.untrustedURL }
        let token = ServiceTaskToken()
        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                let task = session.dataTask(with: request)
                let state = RequestState(
                    owner: owner,
                    maximumBytes: Int64(maximumBytes),
                    redirectValidator: redirectValidator,
                    completion: .data(continuation),
                    downloadProgress: nil,
                    sink: .memory(Data())
                )
                state.task = task
                lock.lock()
                requests[task.taskIdentifier] = state
                lock.unlock()
                token.install(task)
                task.resume()
            }
        }, onCancel: {
            token.cancel()
        })
    }

    func download(
        for request: URLRequest,
        owner: UUID,
        maximumBytes: Int64,
        progress: ((Int64) -> Void)?,
        redirectValidator: @escaping (URL) -> Bool
    ) async throws -> ServiceHTTPDownloadResponse {
        guard maximumBytes > 0, let url = request.url else { throw ServiceHTTPError.invalidURL }
        guard redirectValidator(url) else { throw ServiceHTTPError.untrustedURL }

        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("quareia-download-\(UUID().uuidString).part", isDirectory: false)
        guard FileManager.default.createFile(atPath: fileURL.path, contents: nil),
              let handle = try? FileHandle(forWritingTo: fileURL)
        else { throw ServiceHTTPError.fileIO }

        let token = ServiceTaskToken()
        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                let task = session.dataTask(with: request)
                let state = RequestState(
                    owner: owner,
                    maximumBytes: maximumBytes,
                    redirectValidator: redirectValidator,
                    completion: .download(continuation),
                    downloadProgress: progress,
                    sink: .file(fileURL, handle, 0)
                )
                state.task = task
                lock.lock()
                requests[task.taskIdentifier] = state
                lock.unlock()
                token.install(task)
                task.resume()
            }
        }, onCancel: {
            token.cancel()
        })
    }

    func cancelRequests(owner: UUID) {
        lock.lock()
        let ownedStates = requests.values.filter { $0.owner == owner }
        ownedStates.forEach { $0.terminalError = .cancelled }
        let tasks = ownedStates.compactMap(\.task)
        lock.unlock()
        tasks.forEach { $0.cancel() }
    }

    private func headers(from response: HTTPURLResponse) -> [String: String] {
        var result: [String: String] = [:]
        for (key, value) in response.allHeaderFields {
            guard let key = key as? String else { continue }
            result[key.lowercased()] = String(describing: value)
        }
        return result
    }
}

extension URLSessionHTTPClient: URLSessionDataDelegate, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        lock.lock()
        let state = requests[task.taskIdentifier]
        lock.unlock()
        guard let state, let url = request.url, state.redirectValidator(url) else {
            if let state {
                lock.lock()
                state.terminalError = .untrustedURL
                lock.unlock()
            }
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let http = response as? HTTPURLResponse else {
            lock.lock()
            requests[dataTask.taskIdentifier]?.terminalError = .invalidResponse
            lock.unlock()
            completionHandler(.cancel)
            return
        }
        lock.lock()
        guard let state = requests[dataTask.taskIdentifier] else {
            lock.unlock()
            completionHandler(.cancel)
            return
        }
        state.response = http
        let announcedLength = response.expectedContentLength
        if announcedLength > state.maximumBytes {
            state.terminalError = .responseTooLarge
            lock.unlock()
            completionHandler(.cancel)
            return
        }
        lock.unlock()
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard let state = requests[dataTask.taskIdentifier], state.terminalError == nil else {
            lock.unlock()
            return
        }
        do {
            switch state.sink {
            case .memory(var buffered):
                guard Int64(buffered.count) + Int64(data.count) <= state.maximumBytes else {
                    state.terminalError = .responseTooLarge
                    lock.unlock()
                    dataTask.cancel()
                    return
                }
                buffered.append(data)
                state.sink = .memory(buffered)
            case .file(let url, let handle, let byteCount):
                let nextCount = byteCount + Int64(data.count)
                guard nextCount <= state.maximumBytes else {
                    state.terminalError = .responseTooLarge
                    lock.unlock()
                    dataTask.cancel()
                    return
                }
                try handle.write(contentsOf: data)
                state.sink = .file(url, handle, nextCount)
                let progress = state.downloadProgress
                lock.unlock()
                progress?(nextCount)
                return
            }
            lock.unlock()
        } catch {
            state.terminalError = .fileIO
            lock.unlock()
            dataTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        guard let state = requests.removeValue(forKey: task.taskIdentifier) else {
            lock.unlock()
            return
        }
        lock.unlock()

        var fileURLToRemove: URL?
        if case .file(let url, let handle, _) = state.sink {
            try? handle.close()
            fileURLToRemove = url
        }

        if let terminalError = state.terminalError {
            if let fileURLToRemove { try? FileManager.default.removeItem(at: fileURLToRemove) }
            resume(state.completion, throwing: terminalError)
            return
        }
        if let urlError = error as? URLError, urlError.code == .cancelled {
            if let fileURLToRemove { try? FileManager.default.removeItem(at: fileURLToRemove) }
            resume(state.completion, throwing: ServiceHTTPError.cancelled)
            return
        }
        guard error == nil, let response = state.response, let finalURL = response.url else {
            if let fileURLToRemove { try? FileManager.default.removeItem(at: fileURLToRemove) }
            resume(state.completion, throwing: ServiceHTTPError.transport)
            return
        }

        let responseHeaders = headers(from: response)
        switch (state.completion, state.sink) {
        case (.data(let continuation), .memory(let data)):
            continuation.resume(returning: ServiceHTTPDataResponse(
                statusCode: response.statusCode,
                headers: responseHeaders,
                data: data,
                finalURL: finalURL
            ))
        case (.download(let continuation), .file(let fileURL, _, let byteCount)):
            continuation.resume(returning: ServiceHTTPDownloadResponse(
                statusCode: response.statusCode,
                headers: responseHeaders,
                fileURL: fileURL,
                byteCount: byteCount,
                finalURL: finalURL
            ))
        default:
            if let fileURLToRemove { try? FileManager.default.removeItem(at: fileURLToRemove) }
            resume(state.completion, throwing: ServiceHTTPError.invalidResponse)
        }
    }

    private func resume(_ completion: Completion, throwing error: Error) {
        switch completion {
        case .data(let continuation): continuation.resume(throwing: error)
        case .download(let continuation): continuation.resume(throwing: error)
        }
    }
}

enum ServiceHash {
    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func sha256Hex(_ string: String) -> String {
        sha256Hex(Data(string.utf8))
    }

    static func sha256Hex(fileURL: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let chunk = try handle.read(upToCount: 64 * 1024) ?? Data()
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
