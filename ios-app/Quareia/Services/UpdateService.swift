import CoreFoundation
import Foundation

struct UpdateManifest: Equatable {
    let schemaVersion: Int
    let platform: String
    let version: String
    let build: Int
    let minimumIOS: String
    let ipaURL: URL
    let size: Int64
    let sha256: String
}

enum UpdateFailure: Error, Equatable {
    case notChecked
    case invalidCurrentVersion
    case transport
    case invalidManifest
    case incompatibleOS
    case untrustedURL
    case invalidResponse
    case invalidArtifact
    case cancelled
    case fileIO
}

enum UpdateCheckState: Equatable {
    case notConfigured
    case available(UpdateManifest)
    case upToDate
    case failed(UpdateFailure)
}

struct UpdateDownloadProgress: Equatable {
    let totalBytes: Int64
    let downloadedBytes: Int64

    var fraction: Double {
        guard totalBytes > 0 else { return 0 }
        return min(max(Double(downloadedBytes) / Double(totalBytes), 0), 1)
    }
}

actor UpdateService {
    static let maximumArtifactBytes: Int64 = 100 * 1024 * 1024
    private static let maximumManifestBytes = 64 * 1024

    private struct CheckFlight {
        let token: UUID
        let task: Task<UpdateCheckState, Never>
    }

    private let configuration: ServiceConfiguration
    private let httpClient: ServiceHTTPClient
    private let buildInfoProvider: () -> AppBuildInfo?
    private let downloadDirectory: URL
    private let owner = UUID()
    private var currentState: UpdateCheckState
    private var checkFlight: CheckFlight?
    private var generation: UInt64 = 0

    init(
        configuration: ServiceConfiguration = .unconfigured,
        httpClient: ServiceHTTPClient = URLSessionHTTPClient(),
        buildInfo: @escaping () -> AppBuildInfo? = { AppBuildInfo.current() },
        downloadDirectory: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent("QuareiaValidatedUpdates", isDirectory: true)
    ) {
        self.configuration = configuration
        self.httpClient = httpClient
        self.buildInfoProvider = buildInfo
        self.downloadDirectory = downloadDirectory
        currentState = configuration.updateManifestURL == nil ? .notConfigured : .failed(.notChecked)
    }

    func state() -> UpdateCheckState {
        currentState
    }

    func check() async -> UpdateCheckState {
        guard let manifestURL = configuration.updateManifestURL else {
            currentState = .notConfigured
            return currentState
        }
        guard let buildInfo = buildInfoProvider(), buildInfo.isValidForServices,
              let currentVersion = SemanticVersion(buildInfo.displayVersion)
        else {
            currentState = .failed(.invalidCurrentVersion)
            return currentState
        }

        let flight: CheckFlight
        if let current = checkFlight {
            flight = current
        } else {
            let token = UUID()
            let configuration = self.configuration
            let httpClient = self.httpClient
            let owner = self.owner
            let task = Task {
                await Self.performCheck(
                    manifestURL: manifestURL,
                    currentVersion: currentVersion,
                    currentBuild: buildInfo.versionCode,
                    currentIOS: IOSVersion(major: buildInfo.iosMajor, minor: buildInfo.iosMinor),
                    configuration: configuration,
                    httpClient: httpClient,
                    owner: owner
                )
            }
            flight = CheckFlight(token: token, task: task)
            checkFlight = flight
        }

        let result = await flight.task.value
        guard checkFlight?.token == flight.token else { return currentState }
        checkFlight = nil
        currentState = result
        return result
    }

    func download(
        _ manifest: UpdateManifest,
        progress: ((UpdateDownloadProgress) -> Void)? = nil
    ) async -> Result<URL, UpdateFailure> {
        guard case .available(let checkedManifest) = currentState,
              checkedManifest == manifest
        else { return .failure(.invalidManifest) }
        guard manifest.size > 0,
              manifest.size <= Self.maximumArtifactBytes,
              configuration.allowsArtifactURL(manifest.ipaURL)
        else { return .failure(.untrustedURL) }

        let expectedGeneration = generation
        var request = URLRequest(url: manifest.ipaURL)
        request.httpMethod = "GET"
        request.timeoutInterval = 30
        request.setValue("application/octet-stream", forHTTPHeaderField: "Accept")
        request.setValue("Quareia-Divination-iOS", forHTTPHeaderField: "User-Agent")

        let response: ServiceHTTPDownloadResponse
        do {
            response = try await httpClient.download(
                for: request,
                owner: owner,
                maximumBytes: min(manifest.size, Self.maximumArtifactBytes),
                progress: { downloadedBytes in
                    progress?(UpdateDownloadProgress(
                        totalBytes: manifest.size,
                        downloadedBytes: downloadedBytes
                    ))
                },
                redirectValidator: configuration.allowsArtifactURL
            )
        } catch ServiceHTTPError.cancelled {
            return .failure(.cancelled)
        } catch ServiceHTTPError.untrustedURL {
            return .failure(.untrustedURL)
        } catch ServiceHTTPError.responseTooLarge {
            return .failure(.invalidArtifact)
        } catch {
            return .failure(.transport)
        }

        guard generation == expectedGeneration else {
            try? FileManager.default.removeItem(at: response.fileURL)
            return .failure(.cancelled)
        }
        guard response.statusCode == 200,
              response.byteCount == manifest.size,
              configuration.allowsArtifactURL(response.finalURL)
        else {
            try? FileManager.default.removeItem(at: response.fileURL)
            return .failure(.invalidResponse)
        }
        if let rawLength = response.headers["content-length"],
           let contentLength = Int64(rawLength),
           contentLength != manifest.size
        {
            try? FileManager.default.removeItem(at: response.fileURL)
            return .failure(.invalidArtifact)
        }

        let actualHash: String
        do {
            actualHash = try ServiceHash.sha256Hex(fileURL: response.fileURL)
        } catch {
            try? FileManager.default.removeItem(at: response.fileURL)
            return .failure(.fileIO)
        }
        guard actualHash == manifest.sha256 else {
            try? FileManager.default.removeItem(at: response.fileURL)
            return .failure(.invalidArtifact)
        }

        do {
            try FileManager.default.createDirectory(
                at: downloadDirectory,
                withIntermediateDirectories: true
            )
            let destination = downloadDirectory.appendingPathComponent(
                "Quareia-\(manifest.version)-\(manifest.build)-\(UUID().uuidString).ipa",
                isDirectory: false
            )
            try FileManager.default.moveItem(at: response.fileURL, to: destination)
            progress?(UpdateDownloadProgress(
                totalBytes: manifest.size,
                downloadedBytes: manifest.size
            ))
            return .success(destination)
        } catch {
            try? FileManager.default.removeItem(at: response.fileURL)
            return .failure(.fileIO)
        }
    }

    func cancel() {
        generation &+= 1
        checkFlight?.task.cancel()
        checkFlight = nil
        httpClient.cancelRequests(owner: owner)
        currentState = configuration.updateManifestURL == nil ? .notConfigured : .failed(.cancelled)
    }

    private static func performCheck(
        manifestURL: URL,
        currentVersion: SemanticVersion,
        currentBuild: Int,
        currentIOS: IOSVersion,
        configuration: ServiceConfiguration,
        httpClient: ServiceHTTPClient,
        owner: UUID
    ) async -> UpdateCheckState {
        guard configuration.allowsServiceURL(manifestURL) else {
            return .failed(.untrustedURL)
        }
        var request = URLRequest(url: manifestURL)
        request.httpMethod = "GET"
        request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Quareia-Divination-iOS", forHTTPHeaderField: "User-Agent")

        let response: ServiceHTTPDataResponse
        do {
            response = try await httpClient.data(
                for: request,
                owner: owner,
                maximumBytes: maximumManifestBytes,
                redirectValidator: configuration.allowsServiceURL
            )
        } catch ServiceHTTPError.untrustedURL {
            return .failed(.untrustedURL)
        } catch ServiceHTTPError.responseTooLarge {
            return .failed(.invalidManifest)
        } catch ServiceHTTPError.cancelled {
            return .failed(.cancelled)
        } catch {
            return .failed(.transport)
        }
        guard response.statusCode == 200,
              configuration.allowsServiceURL(response.finalURL)
        else { return .failed(.invalidResponse) }
        if let contentType = response.headers["content-type"]?.lowercased(),
           !contentType.hasPrefix("application/json")
        {
            return .failed(.invalidResponse)
        }
        guard let manifest = parseManifest(response.data),
              let remoteVersion = SemanticVersion(manifest.version),
              let minimumIOS = IOSVersion(manifest.minimumIOS)
        else { return .failed(.invalidManifest) }
        guard configuration.allowsArtifactURL(manifest.ipaURL) else {
            return .failed(.untrustedURL)
        }
        if manifestURL.host?.lowercased() == "telemetry.luotianyi.fun",
           !isCanonicalProductionIPAURL(manifest.ipaURL, version: manifest.version) {
            return .failed(.invalidManifest)
        }
        guard currentIOS >= minimumIOS else {
            return .failed(.incompatibleOS)
        }

        if remoteVersion == currentVersion && manifest.build == currentBuild {
            return .upToDate
        }
        guard remoteVersion > currentVersion, manifest.build > currentBuild else {
            // The version-bound GitHub asset path is immutable. Every release
            // must advance both its public version and global CFBundleVersion.
            return .failed(.invalidManifest)
        }
        return .available(manifest)
    }

    private static func parseManifest(_ data: Data) -> UpdateManifest? {
        guard
            let raw = try? JSONSerialization.jsonObject(with: data),
            let object = raw as? [String: Any],
            Set(object.keys) == [
                "schema_version", "platform", "version", "build",
                "minimum_ios", "ipa_url", "size", "sha256"
            ],
            strictInt64(object["schema_version"]) == 1,
            object["platform"] as? String == "ios",
            let version = object["version"] as? String,
            SemanticVersion(version) != nil,
            let build64 = strictInt64(object["build"]),
            (1...Int64(AppBuildInfo.maximumVersionCode)).contains(build64),
            let minimumIOS = object["minimum_ios"] as? String,
            IOSVersion(minimumIOS) != nil,
            let rawURL = object["ipa_url"] as? String,
            rawURL.utf8.count <= 2_048,
            let downloadURL = URL(string: rawURL),
            downloadURL.user == nil,
            downloadURL.password == nil,
            downloadURL.query == nil,
            downloadURL.fragment == nil,
            downloadURL.pathExtension.lowercased() == "ipa",
            !downloadURL.lastPathComponent.isEmpty,
            let sizeBytes = strictInt64(object["size"]),
            (1...maximumArtifactBytes).contains(sizeBytes),
            let sha256 = object["sha256"] as? String,
            sha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
        else { return nil }

        return UpdateManifest(
            schemaVersion: 1,
            platform: "ios",
            version: version,
            build: Int(build64),
            minimumIOS: minimumIOS,
            ipaURL: downloadURL,
            size: sizeBytes,
            sha256: sha256
        )
    }

    private static func strictInt64(_ value: Any?) -> Int64? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID()
        else { return nil }
        let double = number.doubleValue
        guard double.isFinite,
              double.rounded(.towardZero) == double,
              double >= Double(Int64.min),
              double <= Double(Int64.max)
        else { return nil }
        return number.int64Value
    }

    private static func isCanonicalProductionIPAURL(_ url: URL, version: String) -> Bool {
        guard url.scheme?.lowercased() == "https",
              url.host?.lowercased() == "github.com",
              url.port == nil,
              url.user == nil,
              url.password == nil,
              url.query == nil,
              url.fragment == nil
        else { return false }
        return url.path ==
            "/hedanbaomi/tarot-divination-site/releases/download/ios-v\(version)/" +
            "QuareiaDivination-iOS-v\(version).ipa"
    }
}

private struct IOSVersion: Comparable {
    let major: Int
    let minor: Int

    init(major: Int, minor: Int) {
        self.major = major
        self.minor = minor
    }

    init?(_ raw: String) {
        guard raw.utf8.count <= 16,
              raw.range(
                of: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
                options: .regularExpression
              ) != nil
        else { return nil }
        let parts = raw.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 2,
              let major = Int(parts[0]),
              let minor = Int(parts[1]),
              (16...100).contains(major),
              (0...99).contains(minor)
        else { return nil }
        self.major = major
        self.minor = minor
    }

    static func < (lhs: IOSVersion, rhs: IOSVersion) -> Bool {
        lhs.major != rhs.major ? lhs.major < rhs.major : lhs.minor < rhs.minor
    }
}

private struct SemanticVersion: Comparable {
    private enum Identifier: Equatable {
        case numeric(Int)
        case text(String)
    }

    private let major: Int
    private let minor: Int
    private let patch: Int
    private let prerelease: [Identifier]

    init?(_ raw: String) {
        guard raw.utf8.count <= 64,
              raw.range(
                of: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$",
                options: .regularExpression
              ) != nil
        else { return nil }

        let withoutBuild = raw.split(separator: "+", maxSplits: 1, omittingEmptySubsequences: false)[0]
        let releaseParts = withoutBuild.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        let core = releaseParts[0].split(separator: ".", omittingEmptySubsequences: false)
        guard core.count == 3,
              core.allSatisfy({ $0 == "0" || !$0.hasPrefix("0") }),
              let major = Int(core[0]),
              let minor = Int(core[1]),
              let patch = Int(core[2])
        else { return nil }

        var identifiers: [Identifier] = []
        if releaseParts.count == 2 {
            for rawIdentifier in releaseParts[1].split(separator: ".", omittingEmptySubsequences: false) {
                guard !rawIdentifier.isEmpty else { return nil }
                if rawIdentifier.allSatisfy({ $0.isNumber }) {
                    guard rawIdentifier == "0" || !rawIdentifier.hasPrefix("0"),
                          let number = Int(rawIdentifier)
                    else { return nil }
                    identifiers.append(.numeric(number))
                } else {
                    identifiers.append(.text(String(rawIdentifier)))
                }
            }
        }
        self.major = major
        self.minor = minor
        self.patch = patch
        prerelease = identifiers
    }

    static func < (lhs: SemanticVersion, rhs: SemanticVersion) -> Bool {
        if lhs.major != rhs.major { return lhs.major < rhs.major }
        if lhs.minor != rhs.minor { return lhs.minor < rhs.minor }
        if lhs.patch != rhs.patch { return lhs.patch < rhs.patch }
        if lhs.prerelease.isEmpty { return false }
        if rhs.prerelease.isEmpty { return true }

        for index in 0..<min(lhs.prerelease.count, rhs.prerelease.count) {
            let left = lhs.prerelease[index]
            let right = rhs.prerelease[index]
            if left == right { continue }
            switch (left, right) {
            case (.numeric(let a), .numeric(let b)): return a < b
            case (.numeric, .text): return true
            case (.text, .numeric): return false
            case (.text(let a), .text(let b)): return a < b
            }
        }
        return lhs.prerelease.count < rhs.prerelease.count
    }
}
