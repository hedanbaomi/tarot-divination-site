import XCTest
@testable import Quareia

@MainActor
final class HostLifecycleTests: XCTestCase {
    func testMissingBundleServiceConfigurationStaysUnconfiguredWithoutNetwork() {
        XCTAssertEqual(NativeHostServiceFactory.configuration(from: nil), .unconfigured)
    }

    func testValidExactBundleServiceConfigurationUsesOnlyTrustedHTTPSHosts() throws {
        let configuration = NativeHostServiceFactory.configuration(from: [
            "trustedHosts": ["api.example.test", "updates.example.test"],
            "announcementsURL": "https://api.example.test/v1/announcements",
            "telemetryURL": "https://api.example.test/v1/events",
            "updateManifestURL": "https://updates.example.test/ios/manifest.json"
        ] as [String: Any])
        XCTAssertNotEqual(configuration, .unconfigured)
        XCTAssertEqual(configuration.announcementsURL, URL(string: "https://api.example.test/v1/announcements"))
        XCTAssertEqual(configuration.telemetryURL, URL(string: "https://api.example.test/v1/events"))
        XCTAssertEqual(configuration.updateManifestURL, URL(string: "https://updates.example.test/ios/manifest.json"))
        XCTAssertTrue(configuration.allowsServiceURL(try XCTUnwrap(configuration.announcementsURL)))
        XCTAssertFalse(configuration.allowsServiceURL(URL(string: "https://untrusted.example.test/v1/events")!))
    }

    func testMalformedOrUnsafeBundleServiceConfigurationFailsClosed() {
        let baseline: [String: Any] = [
            "trustedHosts": ["api.example.test"],
            "announcementsURL": "https://api.example.test/v1/announcements",
            "telemetryURL": "https://api.example.test/v1/events",
            "updateManifestURL": "https://api.example.test/ios/manifest.json"
        ]
        let rejected: [Any] = [
            ["trustedHosts": ["api.example.test"]],
            baseline.merging(["extra": true]) { _, new in new },
            baseline.merging(["trustedHosts": "api.example.test"]) { _, new in new },
            baseline.merging(["trustedHosts": ["API.example.test"]]) { _, new in new },
            baseline.merging(["trustedHosts": ["api.example.test", "api.example.test"]]) { _, new in new },
            baseline.merging(["announcementsURL": "http://api.example.test/v1/announcements"]) { _, new in new },
            baseline.merging(["telemetryURL": "https://user@api.example.test/v1/events"]) { _, new in new },
            baseline.merging(["updateManifestURL": "https://untrusted.example.test/manifest.json"]) { _, new in new },
            baseline.merging(["updateManifestURL": 7]) { _, new in new }
        ]
        for value in rejected {
            XCTAssertEqual(NativeHostServiceFactory.configuration(from: value), .unconfigured)
        }
    }

    func testHostInfoReportsCapabilitiesWithoutCreatingIdentityMetadata() async throws {
        let fixture = makeFixture()
        let result = try await fixture.host.handle(request(.hostInfo, .none))
        XCTAssertEqual(result["platform"] as? String, "iOS")
        XCTAssertEqual(result["telemetryState"] as? String, "undisclosed")
        XCTAssertEqual(result["requiresDisclosure"] as? Bool, true)
        XCTAssertTrue((result["capabilities"] as? [String])?.contains("fileImportRead") == true)
    }

    func testTelemetryCannotBeEnabledBeforePrivacyWasActuallyPresented() async throws {
        let fixture = makeFixture()
        do {
            _ = try await fixture.host.handle(request(.setTelemetryEnabled, .telemetryEnabled(true)))
            XCTFail("Expected disclosure gate")
        } catch {
            XCTAssertEqual((error as? NativeHostError)?.bridgeCode, "PRIVACY_DISCLOSURE_REQUIRED")
        }

        fixture.presenter.modalResult = "enable"
        _ = try await fixture.host.presentPrivacy()
        XCTAssertTrue(fixture.services.disclosureShown)
        XCTAssertEqual(fixture.services.telemetryEnabled, true)
    }

    func testDismissedPrivacyDoesNotMarkDisclosure() async throws {
        let fixture = makeFixture()
        fixture.presenter.modalResult = "cancelled"
        let result = try await fixture.host.presentPrivacy()
        XCTAssertEqual(result["outcome"] as? String, "cancelled")
        XCTAssertFalse(fixture.services.disclosureShown)
        XCTAssertNil(fixture.services.telemetryEnabled)
    }

    func testAnnouncementIsAcknowledgedOnlyAfterForegroundPresentation() async throws {
        let fixture = makeFixture()
        fixture.services.pendingAnnouncements = [HostAnnouncementValue(
            token: "token",
            title: "Notice",
            message: "Message",
            action: .none,
            requiresAcknowledgement: true
        )]
        fixture.presenter.foreground = false
        let cancelled = try await fixture.host.presentAnnouncements(manual: false)
        XCTAssertEqual(cancelled["outcome"] as? String, "cancelled")
        XCTAssertTrue(fixture.services.acknowledged.isEmpty)

        fixture.presenter.foreground = true
        fixture.presenter.modalResult = "dismiss"
        let presented = try await fixture.host.presentAnnouncements(manual: false)
        XCTAssertEqual(presented["presented"] as? Int, 1)
        XCTAssertEqual(fixture.services.acknowledged, ["token"])
    }

    func testManualAnnouncementListIncludesInformationalAndReadItemsWithoutFalseAcknowledgement() async throws {
        let fixture = makeFixture()
        fixture.services.pendingAnnouncements = [
            HostAnnouncementValue(token: "eligible", title: "Important", message: "One", action: .none, requiresAcknowledgement: true),
            HostAnnouncementValue(token: "informational", title: "Info", message: "Two", action: .none, requiresAcknowledgement: false)
        ]
        let result = try await fixture.host.presentAnnouncements(manual: true)
        XCTAssertEqual(result["presented"] as? Int, 2)
        XCTAssertEqual(fixture.presenter.listAnnouncements.map(\.token), ["eligible", "informational"])
        XCTAssertEqual(fixture.services.acknowledged, ["eligible"])
    }

    func testFileBridgeLifecycleUsesExactResultShapes() async throws {
        let fixture = makeFixture()
        let data = Data(#"{"items":[]}"#.utf8)
        let begun = try await fixture.host.handle(request(
            .fileExportBegin,
            .exportBegin(kind: .history, name: "history.json", byteCount: data.count)
        ))
        let identifier = try XCTUnwrap(begun["transferID"] as? String)
        let chunked = try await fixture.host.handle(request(
            .fileExportChunk,
            .exportChunk(transferID: identifier, offset: 0, data: data)
        ))
        XCTAssertEqual(chunked["nextOffset"] as? Int, data.count)
        fixture.presenter.exportOutcome = .success
        let finished = try await fixture.host.handle(request(
            .fileExportFinish,
            .exportFinish(transferID: identifier, action: "save")
        ))
        XCTAssertEqual(finished["outcome"] as? String, "success")
        XCTAssertEqual(finished["name"] as? String, "history.json")
    }

    private func request(_ method: BridgeMethod, _ parameters: BridgeParameters) -> ValidatedBridgeRequest {
        ValidatedBridgeRequest(id: UUID().uuidString, method: method, parameters: parameters)
    }

    private func makeFixture() -> (host: NativeHost, services: FakeHostServices, presenter: FakeHostPresenter) {
        let services = FakeHostServices()
        let presenter = FakeHostPresenter()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let host = NativeHost(
            services: services,
            files: HostFileTransferStore(cacheDirectory: root),
            presenter: presenter,
            protectedBaseURL: "quareia-app://app/_m/token",
            applyTheme: { _ in }
        )
        return (host, services, presenter)
    }
}

private final class FakeHostServices: HostServiceFacading {
    var disclosureShown = false
    var telemetryEnabled: Bool?
    var pendingAnnouncements: [HostAnnouncementValue] = []
    var acknowledged: [String] = []

    func hostInfo() async -> HostInfoValue {
        HostInfoValue(
            version: "1.0.0", build: "1", locale: "zh-CN", theme: "celestial",
            telemetryEnabled: telemetryEnabled, privacyDisclosureShown: disclosureShown
        )
    }
    func setLocale(_ locale: String) async throws {}
    func setTheme(_ theme: String) async throws {}
    func telemetryState() async -> (enabled: Bool?, disclosureShown: Bool) { (telemetryEnabled, disclosureShown) }
    func markPrivacyDisclosureShown() async { disclosureShown = true }
    func setTelemetryEnabled(_ enabled: Bool) async throws {
        guard disclosureShown else { throw NativeHostError.privacyRequired }
        telemetryEnabled = enabled
    }
    func recordReadingCompleted(deckType: String, cardCount: Int) async throws {}
    func recordAppActive() async {}
    func announcements(manual: Bool, isForeground: Bool) async -> [HostAnnouncementValue] {
        if manual { return pendingAnnouncements }
        guard !pendingAnnouncements.isEmpty else { return [] }
        return [pendingAnnouncements.removeFirst()]
    }
    func acknowledgeAnnouncement(token: String, wasPresentedInForeground: Bool) async { acknowledged.append(token) }
    func abandonAnnouncement(token: String) async {}
    func checkForUpdates() async -> HostUpdateValue { .notConfigured }
    func downloadAvailableUpdate(progress: @escaping (Double) -> Void) async throws -> URL { throw NativeHostError.unavailable }
    func cleanupDownloadedUpdate(_ url: URL) async {}
}

@MainActor
private final class FakeHostPresenter: HostPresentationCoordinating {
    var foreground = true
    var modalResult = "close"
    var exportOutcome = HostPresentationOutcome.cancelled
    var importSelection = HostFileSelection(outcome: .cancelled, url: nil)
    var listAnnouncements: [HostAnnouncementValue] = []
    var isActiveForeground: Bool { foreground }
    func presentModal(_ modal: HostModal) async throws -> String { modalResult }
    func presentAnnouncementList(title: String, announcements: [HostAnnouncementValue], closeTitle: String, openTitle: String) async throws -> HostAnnouncementListSelection {
        listAnnouncements = announcements
        return .init(outcome: .success, selectedToken: nil)
    }
    func presentImport(kind: BridgeFileKind, accessibilityIdentifier: String) async throws -> HostFileSelection { importSelection }
    func presentExport(url: URL, name: String, action: String, accessibilityIdentifier: String) async throws -> HostPresentationOutcome { exportOutcome }
    func presentUpdateDownload(title: String, cancelTitle: String, accessibilityIdentifier: String, operation: @escaping (@escaping (Double) -> Void) async throws -> URL) async throws -> HostFileSelection { .init(outcome: .cancelled, url: nil) }
    func openExternalHTTPS(_ url: URL) {}
    func cancelActivePresentation() {}
}
