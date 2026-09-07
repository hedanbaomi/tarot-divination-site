import Foundation
import XCTest
@testable import Quareia

#if PUBLIC_TESTING
final class ServicesIntegrationTests: XCTestCase {
    func testExplicitLoopbackFixtureExercisesSwiftWorkerAndD1Path() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["QUAREIA_PUBLIC_FIXTURE_ENVIRONMENT"] == "1",
              environment["QUAREIA_PUBLIC_FIXTURE_BASE_URL"] == "http://127.0.0.1:8787"
        else {
            throw XCTSkip(
                "Set the explicit PUBLIC_TESTING fixture environment and run the Worker at 127.0.0.1:8787"
            )
        }
        let configuration = try XCTUnwrap(ServiceConfiguration.fixtureEnvironment(
            baseURL: URL(string: environment["QUAREIA_PUBLIC_FIXTURE_BASE_URL"]!)!,
            explicitFixtureEnvironment: true,
            updateManifestPath: "/v1/ios-update"
        ))
        let buildInfo = try XCTUnwrap(AppBuildInfo.current(locale: Locale(identifier: "en")))
        XCTAssertEqual(buildInfo.displayVersion, "1.0.0")
        XCTAssertEqual(buildInfo.versionCode, 1)

        let announcements = AnnouncementService(
            configuration: configuration,
            httpClient: URLSessionHTTPClient(),
            store: MemoryServiceStore()
        )
        let context = try XCTUnwrap(AnnouncementContext(buildInfo: buildInfo))
        let announcementResult = await announcements.refresh(context: context, reason: .foreground)
        XCTAssertEqual(announcementResult.source, .network)

        let telemetry = TelemetryService(
            configuration: configuration,
            httpClient: URLSessionHTTPClient(),
            store: MemoryServiceStore(),
            buildInfo: { buildInfo },
            sleeper: { _ in }
        )
        await telemetry.markPrivacyDisclosureShown()
        let optedIn = await telemetry.setConsent(.enabled)
        XCTAssertTrue(optedIn)
        await telemetry.recordInstallSeen()
        await telemetry.recordAppActive()
        await telemetry.recordReadingCompleted(deckType: .tarot, cardCount: 3)
        await telemetry.waitUntilIdle()
        let pendingEvents = await telemetry.pendingEventCount()
        let successfulDeliveries = await telemetry.successfulDeliveryCount()
        XCTAssertEqual(pendingEvents, 0)
        XCTAssertEqual(successfulDeliveries, 3,
                       "all three Swift event shapes must receive Worker 204 success")

        var statsRequest = URLRequest(url: URL(string: "http://127.0.0.1:8787/__fixture/stats")!)
        statsRequest.httpMethod = "GET"
        statsRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        let statsResponse = try await URLSessionHTTPClient().data(
            for: statsRequest,
            owner: UUID(),
            maximumBytes: 4 * 1_024,
            redirectValidator: configuration.allowsServiceURL
        )
        XCTAssertEqual(statsResponse.statusCode, 200)
        XCTAssertEqual(statsResponse.headers["cache-control"], "no-store")
        let stats = try XCTUnwrap(
            JSONSerialization.jsonObject(with: statsResponse.data) as? [String: Any]
        )
        XCTAssertEqual(Set(stats.keys), ["events", "reading_completed", "install_state"],
                       "fixture readback must expose aggregates only")

        let events = try XCTUnwrap(stats["events"] as? [String: Any])
        XCTAssertEqual(Set(events.keys), ["install_seen", "app_active", "reading_completed"])
        XCTAssertEqual(events["install_seen"] as? Int, 1)
        XCTAssertEqual(events["app_active"] as? Int, 1)
        XCTAssertEqual(events["reading_completed"] as? Int, 1)

        let reading = try XCTUnwrap(stats["reading_completed"] as? [String: Any])
        XCTAssertEqual(Set(reading.keys), ["tarot", "mystagogus", "lxxxi", "card_count_sum"])
        XCTAssertEqual(reading["tarot"] as? Int, 1)
        XCTAssertEqual(reading["mystagogus"] as? Int, 0)
        XCTAssertEqual(reading["lxxxi"] as? Int, 0)
        XCTAssertEqual(reading["card_count_sum"] as? Int, 3)

        let installState = try XCTUnwrap(stats["install_state"] as? [String: Any])
        XCTAssertEqual(Set(installState.keys), [
            "platform", "rows", "version_code", "app_version", "ios_major"
        ])
        XCTAssertEqual(installState["platform"] as? String, "ios")
        XCTAssertEqual(installState["rows"] as? Int, 1)
        XCTAssertEqual(installState["version_code"] as? Int, buildInfo.versionCode)
        XCTAssertEqual(installState["app_version"] as? String, buildInfo.displayVersion)
        XCTAssertEqual(installState["ios_major"] as? Int, buildInfo.iosMajor)
        for forbiddenKey in ["install_hash", "uuid", "ip", "user_agent"] {
            XCTAssertNil(stats[forbiddenKey])
            XCTAssertNil(installState[forbiddenKey])
        }

        let updateDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("quareia-integration-update-\(UUID().uuidString)", isDirectory: true)
        defer {
            if FileManager.default.fileExists(atPath: updateDirectory.path) {
                try? FileManager.default.removeItem(at: updateDirectory)
            }
        }
        let updates = UpdateService(
            configuration: configuration,
            httpClient: URLSessionHTTPClient(),
            buildInfo: { buildInfo },
            downloadDirectory: updateDirectory
        )
        guard case .available(let manifest) = await updates.check() else {
            return XCTFail("real loopback update manifest must be available")
        }
        XCTAssertEqual(manifest.displayVersion, "1.0.1")
        XCTAssertEqual(manifest.build, 2)
        XCTAssertEqual(manifest.sizeBytes, 85)
        XCTAssertEqual(manifest.sha256, "1148e3aae6c847d29f11873cb73f848322fc825ff975c9bd73c182df97fff66b")
        let downloadedURL = try await updates.download(manifest).get()
        XCTAssertEqual((try FileManager.default.attributesOfItem(atPath: downloadedURL.path)[.size] as? NSNumber)?.int64Value, 85)
        XCTAssertEqual(try ServiceHash.sha256Hex(fileURL: downloadedURL), manifest.sha256)
        try FileManager.default.removeItem(at: downloadedURL)
        XCTAssertFalse(FileManager.default.fileExists(atPath: downloadedURL.path))
    }

    func testExplicitLoopbackUpdateCancellationStopsRealTransfer() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["QUAREIA_PUBLIC_FIXTURE_ENVIRONMENT"] == "1",
              environment["QUAREIA_PUBLIC_FIXTURE_BASE_URL"] == "http://127.0.0.1:8787"
        else { throw XCTSkip("explicit loopback fixture is not enabled") }
        let configuration = try XCTUnwrap(ServiceConfiguration.fixtureEnvironment(
            baseURL: URL(string: "http://127.0.0.1:8787")!,
            explicitFixtureEnvironment: true,
            updateManifestPath: "/v1/ios-update"
        ))
        let buildInfo = try XCTUnwrap(AppBuildInfo.current(locale: Locale(identifier: "en")))
        let updateDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("quareia-cancelled-update-\(UUID().uuidString)", isDirectory: true)
        defer {
            if FileManager.default.fileExists(atPath: updateDirectory.path) {
                try? FileManager.default.removeItem(at: updateDirectory)
            }
        }
        let updates = UpdateService(
            configuration: configuration,
            httpClient: URLSessionHTTPClient(),
            buildInfo: { buildInfo },
            downloadDirectory: updateDirectory
        )
        guard case .available(let manifest) = await updates.check() else {
            return XCTFail("real loopback update manifest must be available")
        }
        try await Self.setFixtureUpdateMode("blocked")
        addTeardownBlock {
            await updates.cancel()
            try await Self.setFixtureUpdateMode("normal")
        }
        let download = Task { await updates.download(manifest) }
        var started = false
        var stateRequest = URLRequest(url: URL(string: "http://127.0.0.1:8787/__fixture/update-state")!)
        stateRequest.timeoutInterval = 2
        let readinessDeadline = ProcessInfo.processInfo.systemUptime + 15
        while ProcessInfo.processInfo.systemUptime < readinessDeadline {
            stateRequest.timeoutInterval = max(0.001, min(2, readinessDeadline - ProcessInfo.processInfo.systemUptime))
            do {
                let (data, response) = try await URLSession.shared.data(for: stateRequest)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { break }
                if (try JSONSerialization.jsonObject(with: data) as? [String: Int])?["activeDownloads"] == 1 {
                    started = true
                    break
                }
            } catch let error as URLError where error.code == .timedOut {
                // This read-only readiness probe may time out while the cold
                // simulator is busy. The streaming request is started once.
            }
            try await Task<Never, Never>.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertTrue(started, "The fixture must observe a real streaming request before cancellation")
        await updates.cancel()
        let result = await download.value
        XCTAssertEqual(result, .failure(.cancelled))
        let files = (try? FileManager.default.contentsOfDirectory(at: updateDirectory, includingPropertiesForKeys: nil)) ?? []
        XCTAssertTrue(files.isEmpty)
    }

    private static func setFixtureUpdateMode(_ mode: String) async throws {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8787/__fixture/update-mode")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 5
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["mode": mode])
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    }

    func testLoopbackConfigurationCannotBeEnabledWithoutBothCompileAndRuntimeGates() throws {
        let loopback = URL(string: "http://127.0.0.1:8787")!
        XCTAssertNil(ServiceConfiguration.fixtureEnvironment(
            baseURL: loopback,
            explicitFixtureEnvironment: false
        ))
        XCTAssertNil(ServiceConfiguration.fixtureEnvironment(
            baseURL: URL(string: "http://localhost:8787")!,
            explicitFixtureEnvironment: true
        ))
        XCTAssertNil(ServiceConfiguration.fixtureEnvironment(
            baseURL: URL(string: "http://127.0.0.1:8788")!,
            explicitFixtureEnvironment: true
        ))
    }
}
#endif
