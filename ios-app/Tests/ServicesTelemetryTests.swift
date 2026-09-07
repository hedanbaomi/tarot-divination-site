import Foundation
import XCTest
@testable import Quareia

final class ServicesTelemetryTests: XCTestCase {
    func testConsentAndDisclosureStatePersistWithoutCreatingAnIdentity() async {
        let store = MemoryServiceStore()
        let first = TelemetryService(
            configuration: .unconfigured,
            httpClient: FakeServiceHTTPClient(),
            store: store,
            buildInfo: { Self.buildInfo(versionCode: 7) }
        )
        await first.markPrivacyDisclosureShown()
        _ = await first.setConsent(.disabled)

        let restored = TelemetryService(
            configuration: .unconfigured,
            httpClient: FakeServiceHTTPClient(),
            store: store,
            buildInfo: { Self.buildInfo(versionCode: 7) }
        )
        let consent = await restored.consentState()
        let disclosureShown = await restored.privacyDisclosureShown()
        XCTAssertEqual(consent, .disabled)
        XCTAssertTrue(disclosureShown)
    }

    func testUndisclosedConsentSendsNothingAndEnabledPayloadIsClosed() async throws {
        let fake = FakeServiceHTTPClient()
        fake.dataHandler = { request, _ in makeDataResponse(for: request, status: 204) }
        let service = TelemetryService(
            configuration: testServiceConfiguration(announcements: false, updates: false),
            httpClient: fake,
            store: MemoryServiceStore(),
            buildInfo: { Self.buildInfo(versionCode: 7) }
        )

        await service.recordInstallSeen()
        await service.recordAppActive()
        await service.recordReadingCompleted(deckType: .tarot, cardCount: 3)
        XCTAssertEqual(fake.dataRequestCount, 0)
        let prematureOptIn = await service.setConsent(.enabled)
        XCTAssertFalse(prematureOptIn, "opt-in before actual privacy presentation must be refused")
        let initialConsent = await service.consentState()
        XCTAssertEqual(initialConsent, .undisclosed)

        await service.markPrivacyDisclosureShown()
        let optedIn = await service.setConsent(.enabled)
        XCTAssertTrue(optedIn)
        await service.recordInstallSeen()
        await service.recordAppActive()
        await service.recordReadingCompleted(deckType: .mystagogus, cardCount: 5)
        await service.recordReadingCompleted(deckType: .lxxxi, cardCount: 0)
        await service.waitUntilIdle()

        XCTAssertEqual(fake.dataRequestCount, 3)
        let payloads = try fake.capturedDataRequests.map(Self.payload)
        XCTAssertEqual(payloads.compactMap { $0["event"] as? String }, [
            "install_seen", "app_active", "reading_completed"
        ])
        for payload in payloads {
            XCTAssertEqual(payload["schema_version"] as? Int, 1)
            XCTAssertEqual(payload["platform"] as? String, "ios")
            XCTAssertEqual(payload["ios_major"] as? Int, 18)
            XCTAssertNil(payload["android_major"])
            XCTAssertNil(payload["env_version"])
            XCTAssertEqual((payload["install_hash"] as? String)?.count, 64)
        }
        XCTAssertEqual(payloads[1]["version_code"] as? Int, 7)
        XCTAssertNil(payloads[0]["version_code"])
        XCTAssertNil(payloads[2]["version_code"])
        XCTAssertEqual(payloads[2]["deck_type"] as? String, "mystagogus")
        XCTAssertEqual(payloads[2]["card_count"] as? Int, 5)
    }

    func testOptOutCancelsInFlightAndOldCompletionCannotRestoreMarksOrIdentity() async throws {
        let fake = FakeServiceHTTPClient()
        let gate = ServicesAsyncGate()
        fake.dataHandler = { request, _ in
            await gate.wait()
            return makeDataResponse(for: request, status: 204)
        }
        let service = TelemetryService(
            configuration: testServiceConfiguration(announcements: false, updates: false),
            httpClient: fake,
            store: MemoryServiceStore(),
            buildInfo: { Self.buildInfo(versionCode: 7) }
        )
        await service.markPrivacyDisclosureShown()
        let optedIn = await service.setConsent(.enabled)
        XCTAssertTrue(optedIn)
        await service.recordAppActive()
        let requestStarted = await eventually { fake.dataRequestCount == 1 }
        XCTAssertTrue(requestStarted)
        let firstHash = try Self.payload(fake.capturedDataRequests[0])["install_hash"] as? String

        let optedOut = await service.setConsent(.disabled)
        XCTAssertTrue(optedOut)
        XCTAssertEqual(fake.cancellationCount, 1)
        let pendingAfterOptOut = await service.pendingEventCount()
        XCTAssertEqual(pendingAfterOptOut, 0)
        await gate.open()
        try? await Task<Never, Never>.sleep(nanoseconds: 30_000_000)
        let disabledConsent = await service.consentState()
        XCTAssertEqual(disabledConsent, .disabled)

        let optedBackIn = await service.setConsent(.enabled)
        XCTAssertTrue(optedBackIn)
        await service.recordAppActive()
        await service.waitUntilIdle()
        XCTAssertEqual(fake.dataRequestCount, 2, "the stale completion must not set the six-hour delivery mark")
        let secondHash = try Self.payload(fake.capturedDataRequests[1])["install_hash"] as? String
        XCTAssertNotEqual(firstHash, secondHash, "re-enabling after opt-out must create a new random identity")
    }

    func testAppActiveIsSixHourlyPerBuildAndBuildChangeSendsImmediately() async throws {
        let fake = FakeServiceHTTPClient()
        fake.dataHandler = { request, _ in makeDataResponse(for: request, status: 204) }
        var now = Date(timeIntervalSince1970: 1_700_000_000)
        var versionCode = 7
        let service = TelemetryService(
            configuration: testServiceConfiguration(announcements: false, updates: false),
            httpClient: fake,
            store: MemoryServiceStore(),
            buildInfo: { Self.buildInfo(versionCode: versionCode) },
            clock: { now }
        )
        await service.markPrivacyDisclosureShown()
        _ = await service.setConsent(.enabled)

        await service.recordAppActive()
        await service.waitUntilIdle()
        await service.recordAppActive()
        await service.waitUntilIdle()
        XCTAssertEqual(fake.dataRequestCount, 1)

        versionCode = 8
        await service.recordAppActive()
        await service.waitUntilIdle()
        XCTAssertEqual(fake.dataRequestCount, 2)
        XCTAssertEqual(try Self.payload(fake.capturedDataRequests[1])["version_code"] as? Int, 8)

        now = now.addingTimeInterval(6 * 60 * 60 + 1)
        await service.recordAppActive()
        await service.waitUntilIdle()
        XCTAssertEqual(fake.dataRequestCount, 3)
    }

    func testOnly204MarksSuccessAndRetryUsesBoundedBackoff() async {
        let fake = FakeServiceHTTPClient()
        fake.dataHandler = { request, _ in
            makeDataResponse(for: request, status: fake.dataRequestCount == 1 ? 200 : 204)
        }
        var now = Date(timeIntervalSince1970: 1_700_000_000)
        var observedSleeps: [TimeInterval] = []
        let service = TelemetryService(
            configuration: testServiceConfiguration(announcements: false, updates: false),
            httpClient: fake,
            store: MemoryServiceStore(),
            buildInfo: { Self.buildInfo(versionCode: 7) },
            clock: { now },
            sleeper: { seconds in
                observedSleeps.append(seconds)
                now = now.addingTimeInterval(seconds)
            }
        )
        await service.markPrivacyDisclosureShown()
        _ = await service.setConsent(.enabled)
        await service.recordInstallSeen()
        await service.waitUntilIdle()

        XCTAssertEqual(fake.dataRequestCount, 2)
        XCTAssertEqual(observedSleeps, [30])
        let pending = await service.pendingEventCount()
        XCTAssertEqual(pending, 0)
        await service.recordInstallSeen()
        await service.waitUntilIdle()
        XCTAssertEqual(fake.dataRequestCount, 2, "a 204 delivery persists the install_seen mark")
    }

    func testReadingQueueIsBoundedWhileTransportIsBlocked() async {
        let fake = FakeServiceHTTPClient()
        let gate = ServicesAsyncGate()
        fake.dataHandler = { request, _ in
            await gate.wait()
            return makeDataResponse(for: request, status: 204)
        }
        let service = TelemetryService(
            configuration: testServiceConfiguration(announcements: false, updates: false),
            httpClient: fake,
            store: MemoryServiceStore(),
            buildInfo: { Self.buildInfo(versionCode: 7) }
        )
        await service.markPrivacyDisclosureShown()
        _ = await service.setConsent(.enabled)
        for _ in 0..<100 {
            await service.recordReadingCompleted(deckType: .tarot, cardCount: 3)
        }
        let pending = await service.pendingEventCount()
        XCTAssertEqual(pending, 64)
        await service.setConsent(.disabled)
        await gate.open()
    }

    private static func buildInfo(versionCode: Int) -> AppBuildInfo {
        AppBuildInfo(
            displayVersion: "1.2.3",
            versionCode: versionCode,
            locale: "en-US",
            iosMajor: 18
        )
    }

    private static func payload(_ request: URLRequest) throws -> [String: Any] {
        let data = try XCTUnwrap(request.httpBody)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}
