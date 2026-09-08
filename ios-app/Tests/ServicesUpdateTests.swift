import Foundation
import XCTest
@testable import Quareia

final class ServicesUpdateTests: XCTestCase {
    func testUnconfiguredIsDistinctAndMakesNoRequest() async {
        let fake = FakeServiceHTTPClient()
        let service = UpdateService(
            configuration: .unconfigured,
            httpClient: fake,
            buildInfo: { Self.buildInfo() }
        )
        let result = await service.check()
        XCTAssertEqual(result, .notConfigured)
        XCTAssertEqual(fake.dataRequestCount, 0)
    }

    func testStrictManifestUsesSemVerAndIntegerBuild() async {
        let fake = FakeServiceHTTPClient()
        fake.dataHandler = { request, _ in
            makeDataResponse(for: request, status: 200, body: Self.manifestData(
                displayVersion: "1.2.4",
                build: 8,
                bytes: Data("artifact".utf8)
            ))
        }
        let service = UpdateService(
            configuration: testServiceConfiguration(announcements: false, telemetry: false),
            httpClient: fake,
            buildInfo: { Self.buildInfo(versionCode: 7) }
        )

        let state = await service.check()
        guard case .available(let manifest) = state else {
            return XCTFail("a newer version with a newer build must be available")
        }
        XCTAssertEqual(manifest.version, "1.2.4")
        XCTAssertEqual(manifest.build, 8)
        XCTAssertEqual(manifest.minimumIOS, "16.0")

        let malformed = FakeServiceHTTPClient()
        malformed.dataHandler = { request, _ in
            var object = try JSONSerialization.jsonObject(with: Self.manifestData(
                displayVersion: "1.2.4",
                build: 9,
                bytes: Data("artifact".utf8)
            )) as! [String: Any]
            object["unknown"] = true
            return makeDataResponse(
                for: request,
                status: 200,
                body: try JSONSerialization.data(withJSONObject: object)
            )
        }
        let strictService = UpdateService(
            configuration: testServiceConfiguration(announcements: false, telemetry: false),
            httpClient: malformed,
            buildInfo: { Self.buildInfo() }
        )
        let strictResult = await strictService.check()
        XCTAssertEqual(strictResult, .failed(.invalidManifest))
    }

    func testBuildIsGloballyMonotonicAndExactInstalledReleaseIsUpToDate() async {
        func checkedState(displayVersion: String, build: Int) async -> UpdateCheckState {
            let fake = FakeServiceHTTPClient()
            fake.dataHandler = { request, _ in
                makeDataResponse(
                    for: request,
                    status: 200,
                    body: Self.manifestData(
                        displayVersion: displayVersion,
                        build: build,
                        bytes: Data("artifact".utf8)
                    )
                )
            }
            let service = UpdateService(
                configuration: testServiceConfiguration(announcements: false, telemetry: false),
                httpClient: fake,
                buildInfo: { Self.buildInfo(versionCode: 7) }
            )
            return await service.check()
        }

        let exact = await checkedState(displayVersion: "1.2.3", build: 7)
        XCTAssertEqual(exact, .upToDate)
        let sameVersionWithNewerBuild = await checkedState(displayVersion: "1.2.3", build: 8)
        XCTAssertEqual(sameVersionWithNewerBuild, .failed(.invalidManifest))
        let newerDisplayWithoutNewerBuild = await checkedState(displayVersion: "1.2.4", build: 7)
        XCTAssertEqual(newerDisplayWithoutNewerBuild, .failed(.invalidManifest))
        let displayDowngradeWithNewerBuild = await checkedState(displayVersion: "1.2.2", build: 8)
        XCTAssertEqual(displayDowngradeWithNewerBuild, .failed(.invalidManifest))
        let coherentUpgrade = await checkedState(displayVersion: "1.2.4", build: 8)
        guard case .available = coherentUpgrade else {
            return XCTFail("newer display and globally newer build should be available")
        }
    }

    func testDownloadReturnsFileOnlyAfterExactSizeAndHashValidation() async throws {
        let artifact = Data("validated ipa bytes".utf8)
        let fake = FakeServiceHTTPClient()
        fake.dataHandler = { request, _ in
            makeDataResponse(
                for: request,
                status: 200,
                body: Self.manifestData(displayVersion: "1.2.4", build: 8, bytes: artifact)
            )
        }
        fake.downloadHandler = { request, maximumBytes, progress, validator in
            XCTAssertTrue(validator(request.url!))
            XCTAssertEqual(maximumBytes, Int64(artifact.count))
            let file = FileManager.default.temporaryDirectory
                .appendingPathComponent("services-update-\(UUID().uuidString).part")
            try artifact.write(to: file)
            progress?(Int64(artifact.count))
            return ServiceHTTPDownloadResponse(
                statusCode: 200,
                headers: ["content-length": String(artifact.count)],
                fileURL: file,
                byteCount: Int64(artifact.count),
                finalURL: request.url!
            )
        }
        let outputDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("services-output-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: outputDirectory) }
        let service = UpdateService(
            configuration: testServiceConfiguration(announcements: false, telemetry: false),
            httpClient: fake,
            buildInfo: { Self.buildInfo() },
            downloadDirectory: outputDirectory
        )
        guard case .available(let manifest) = await service.check() else {
            return XCTFail("expected available manifest")
        }
        var progress: [UpdateDownloadProgress] = []
        let result = await service.download(manifest) { progress.append($0) }
        let validatedURL = try result.get()
        XCTAssertEqual(try Data(contentsOf: validatedURL), artifact)
        XCTAssertEqual(progress.last?.downloadedBytes, Int64(artifact.count))
        XCTAssertEqual(validatedURL.pathExtension, "ipa")
    }

    func testHashAndSizeMismatchNeverHandFileToUI() async {
        let artifact = Data("artifact".utf8)
        let hashMismatch = await makeDownloadResult(
            artifact: artifact,
            manifestBytes: artifact,
            responseByteCount: Int64(artifact.count),
            overrideHash: String(repeating: "0", count: 64)
        )
        XCTAssertEqual(hashMismatch, .failure(.invalidArtifact))

        let sizeMismatch = await makeDownloadResult(
            artifact: artifact,
            manifestBytes: artifact + Data([0]),
            responseByteCount: Int64(artifact.count),
            overrideHash: nil
        )
        XCTAssertEqual(sizeMismatch, .failure(.invalidResponse))
    }

    func testUntrustedRedirectIsRejectedByTheValidatorPassedToTransport() async {
        let artifact = Data("artifact".utf8)
        let fake = FakeServiceHTTPClient()
        fake.dataHandler = { request, _ in
            makeDataResponse(
                for: request,
                status: 200,
                body: Self.manifestData(displayVersion: "1.2.4", build: 8, bytes: artifact)
            )
        }
        fake.downloadHandler = { _, _, _, validator in
            XCTAssertFalse(validator(URL(string: "https://evil.example/stolen.ipa")!))
            throw ServiceHTTPError.untrustedURL
        }
        let service = UpdateService(
            configuration: testServiceConfiguration(announcements: false, telemetry: false),
            httpClient: fake,
            buildInfo: { Self.buildInfo() }
        )
        guard case .available(let manifest) = await service.check() else {
            return XCTFail("expected available manifest")
        }
        let downloadResult = await service.download(manifest)
        XCTAssertEqual(downloadResult, .failure(.untrustedURL))

        XCTAssertNil(ServiceConfiguration.configured(
            updateManifestURL: URL(string: "https://evil.example/manifest.json"),
            trustedHosts: ["services.example"]
        ))

        let separated = try! XCTUnwrap(ServiceConfiguration.configured(
            updateManifestURL: URL(string: "https://telemetry.luotianyi.fun/v1/ios-update"),
            trustedHosts: ["telemetry.luotianyi.fun"],
            trustedArtifactHosts: ["github.com", "release-assets.githubusercontent.com"]
        ))
        XCTAssertFalse(separated.allowsServiceURL(URL(string: "https://github.com/asset.ipa")!))
        XCTAssertTrue(separated.allowsArtifactURL(URL(string: "https://github.com/asset.ipa")!))
        XCTAssertTrue(separated.allowsArtifactURL(URL(string: "https://release-assets.githubusercontent.com/asset.ipa")!))
        XCTAssertFalse(separated.allowsArtifactURL(URL(string: "https://objects.githubusercontent.com/asset.ipa")!))
    }

    func testManifestRedirectRejectionIsReportedAsUntrusted() async {
        let fake = FakeServiceHTTPClient()
        fake.dataHandler = { _, validator in
            XCTAssertFalse(validator(URL(string: "https://evil.example/manifest.json")!))
            throw ServiceHTTPError.untrustedURL
        }
        let service = UpdateService(
            configuration: testServiceConfiguration(announcements: false, telemetry: false),
            httpClient: fake,
            buildInfo: { Self.buildInfo() }
        )
        let state = await service.check()
        XCTAssertEqual(state, .failed(.untrustedURL))
    }

    func testUnavailableTimeoutAndMalformedResponsesAreFailuresNotUpToDate() async {
        let unavailable = FakeServiceHTTPClient()
        unavailable.dataHandler = { request, _ in
            makeDataResponse(for: request, status: 404, body: Data(#"{"error":"ios_update_unavailable"}"#.utf8))
        }
        let unavailableService = UpdateService(
            configuration: testServiceConfiguration(announcements: false, telemetry: false),
            httpClient: unavailable,
            buildInfo: { Self.buildInfo() }
        )
        let unavailableState = await unavailableService.check()
        XCTAssertEqual(unavailableState, .failed(.invalidResponse))

        let timeout = FakeServiceHTTPClient()
        timeout.dataHandler = { _, _ in throw URLError(.timedOut) }
        let timeoutService = UpdateService(
            configuration: testServiceConfiguration(announcements: false, telemetry: false),
            httpClient: timeout,
            buildInfo: { Self.buildInfo() }
        )
        let timeoutState = await timeoutService.check()
        XCTAssertEqual(timeoutState, .failed(.transport))

        let malformed = FakeServiceHTTPClient()
        malformed.dataHandler = { request, _ in
            makeDataResponse(for: request, status: 200, body: Data(#"{"schema_version":1}"#.utf8))
        }
        let malformedService = UpdateService(
            configuration: testServiceConfiguration(announcements: false, telemetry: false),
            httpClient: malformed,
            buildInfo: { Self.buildInfo() }
        )
        let malformedState = await malformedService.check()
        XCTAssertEqual(malformedState, .failed(.invalidManifest))
    }

    func testMinimumIOSIsStrictAndIncompatibleDevicesDoNotOfferAnUpdate() async {
        func state(minimumIOS: String, iosMajor: Int, iosMinor: Int) async -> UpdateCheckState {
            let fake = FakeServiceHTTPClient()
            fake.dataHandler = { request, _ in
                makeDataResponse(
                    for: request,
                    status: 200,
                    body: Self.manifestData(
                        displayVersion: "1.2.4",
                        build: 8,
                        bytes: Data("artifact".utf8),
                        minimumIOS: minimumIOS
                    )
                )
            }
            let service = UpdateService(
                configuration: testServiceConfiguration(announcements: false, telemetry: false),
                httpClient: fake,
                buildInfo: { Self.buildInfo(iosMajor: iosMajor, iosMinor: iosMinor) }
            )
            return await service.check()
        }

        guard case .available = await state(minimumIOS: "16.1", iosMajor: 16, iosMinor: 1) else {
            return XCTFail("an exactly compatible OS must receive the update")
        }
        let incompatible = await state(minimumIOS: "16.1", iosMajor: 16, iosMinor: 0)
        XCTAssertEqual(incompatible, .failed(.incompatibleOS))
        let partial = await state(minimumIOS: "16", iosMajor: 18, iosMinor: 0)
        XCTAssertEqual(partial, .failed(.invalidManifest))
        let padded = await state(minimumIOS: "015.0", iosMajor: 18, iosMinor: 0)
        XCTAssertEqual(padded, .failed(.invalidManifest))
    }

    func testProductionManifestAcceptsOnlyTheVersionBoundGitHubAssetPath() async {
        let configuration = try! XCTUnwrap(ServiceConfiguration.configured(
            updateManifestURL: URL(string: "https://telemetry.luotianyi.fun/v1/ios-update"),
            trustedHosts: ["telemetry.luotianyi.fun"],
            trustedArtifactHosts: ["github.com", "release-assets.githubusercontent.com"]
        ))
        func state(ipaURL: String) async -> UpdateCheckState {
            let fake = FakeServiceHTTPClient()
            fake.dataHandler = { request, _ in
                makeDataResponse(
                    for: request,
                    status: 200,
                    body: Self.manifestData(
                        displayVersion: "1.2.4",
                        build: 8,
                        bytes: Data("artifact".utf8),
                        ipaURL: ipaURL
                    )
                )
            }
            let service = UpdateService(
                configuration: configuration,
                httpClient: fake,
                buildInfo: { Self.buildInfo() }
            )
            return await service.check()
        }

        let canonical =
            "https://github.com/hedanbaomi/tarot-divination-site/releases/download/" +
            "ios-v1.2.4/QuareiaDivination-iOS-v1.2.4.ipa"
        guard case .available = await state(ipaURL: canonical) else {
            return XCTFail("canonical production asset must be available")
        }
        let arbitrary = await state(ipaURL: "https://github.com/other/repository/releases/download/v1/app.ipa")
        XCTAssertEqual(arbitrary, .failed(.invalidManifest))
    }

    private func makeDownloadResult(
        artifact: Data,
        manifestBytes: Data,
        responseByteCount: Int64,
        overrideHash: String?
    ) async -> Result<URL, UpdateFailure> {
        let fake = FakeServiceHTTPClient()
        fake.dataHandler = { request, _ in
            makeDataResponse(
                for: request,
                status: 200,
                body: Self.manifestData(
                    displayVersion: "1.2.4",
                    build: 8,
                    bytes: manifestBytes,
                    overrideHash: overrideHash
                )
            )
        }
        fake.downloadHandler = { request, _, _, _ in
            let file = FileManager.default.temporaryDirectory
                .appendingPathComponent("services-invalid-\(UUID().uuidString).part")
            try artifact.write(to: file)
            return ServiceHTTPDownloadResponse(
                statusCode: 200,
                headers: [:],
                fileURL: file,
                byteCount: responseByteCount,
                finalURL: request.url!
            )
        }
        let service = UpdateService(
            configuration: testServiceConfiguration(announcements: false, telemetry: false),
            httpClient: fake,
            buildInfo: { Self.buildInfo() }
        )
        guard case .available(let manifest) = await service.check() else {
            return .failure(.invalidManifest)
        }
        return await service.download(manifest)
    }

    private static func buildInfo(
        versionCode: Int = 7,
        iosMajor: Int = 18,
        iosMinor: Int = 0
    ) -> AppBuildInfo {
        AppBuildInfo(
            displayVersion: "1.2.3",
            versionCode: versionCode,
            locale: "en-US",
            iosMajor: iosMajor,
            iosMinor: iosMinor
        )
    }

    private static func manifestData(
        displayVersion: String,
        build: Int,
        bytes: Data,
        overrideHash: String? = nil,
        minimumIOS: String = "16.0",
        ipaURL: String? = nil
    ) -> Data {
        try! JSONSerialization.data(withJSONObject: [
            "schema_version": 1,
            "platform": "ios",
            "version": displayVersion,
            "build": build,
            "minimum_ios": minimumIOS,
            "ipa_url": ipaURL ?? "https://services.example/releases/Quareia-\(displayVersion)-\(build).ipa",
            "size": bytes.count,
            "sha256": overrideHash ?? ServiceHash.sha256Hex(bytes)
        ], options: [.sortedKeys])
    }
}
