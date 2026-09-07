import Foundation
import XCTest
@testable import Quareia

final class ServicesAnnouncementTests: XCTestCase {
    func testForegroundRefreshesJoinOneRequestAnd304RenewsPersistentCache() async throws {
        let fake = FakeServiceHTTPClient()
        let gate = ServicesAsyncGate()
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        fake.dataHandler = { request, _ in
            if request.value(forHTTPHeaderField: "If-None-Match") == nil {
                return makeDataResponse(
                    for: request,
                    status: 200,
                    headers: ["etag": "\"revision-1\""],
                    body: Self.feed(revision: 1, endsAt: 0)
                )
            }
            await gate.wait()
            return makeDataResponse(
                for: request,
                status: 304,
                headers: ["etag": "\"revision-1\""]
            )
        }
        let store = MemoryServiceStore()
        let service = AnnouncementService(
            configuration: testServiceConfiguration(telemetry: false, updates: false),
            httpClient: fake,
            store: store,
            clock: { now }
        )
        let context = AnnouncementContext(versionCode: 7, locale: "en-US")!

        let first = await service.refresh(context: context, reason: .manual)
        XCTAssertEqual(first.source, .network)
        XCTAssertEqual(first.announcements.map(\.revision), [1])
        let ordinary = await service.refresh(context: context, reason: .ordinary)
        XCTAssertEqual(ordinary.source, .cache)
        XCTAssertEqual(fake.dataRequestCount, 1, "ordinary checks are throttled for six hours")

        let firstForeground = Task {
            await service.refresh(context: context, reason: .foreground)
        }
        let firstRequestStarted = await eventually { fake.dataRequestCount == 2 }
        XCTAssertTrue(firstRequestStarted)
        let secondForeground = Task {
            await service.refresh(context: context, reason: .foreground)
        }
        try? await Task<Never, Never>.sleep(nanoseconds: 30_000_000)
        XCTAssertEqual(fake.dataRequestCount, 2, "overlapping foreground callers must share the request")
        await gate.open()

        let firstForegroundResult = await firstForeground.value
        let secondForegroundResult = await secondForeground.value
        let results = [firstForegroundResult, secondForegroundResult]
        XCTAssertTrue(results.allSatisfy { $0.announcements.map(\.revision) == [1] })
        XCTAssertTrue(results.contains(where: { $0.source == .notModified }))
        XCTAssertEqual(fake.capturedDataRequests.last?.value(forHTTPHeaderField: "If-None-Match"), "\"revision-1\"")

        let restored = AnnouncementService(
            configuration: .unconfigured,
            httpClient: FakeServiceHTTPClient(),
            store: store,
            clock: { now }
        )
        let restoredRevisions = await restored.cachedAnnouncements(for: context).map(\.revision)
        XCTAssertEqual(restoredRevisions, [1])
    }

    func testLocaleGenerationIgnoresLateOldLocaleCompletion() async {
        let fake = FakeServiceHTTPClient()
        let oldLocaleGate = ServicesAsyncGate()
        fake.dataHandler = { request, _ in
            let locale = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "locale" })?.value
            if locale == "zh-CN" {
                await oldLocaleGate.wait()
                return makeDataResponse(for: request, status: 200, body: Self.feed(title: "旧语言"))
            }
            return makeDataResponse(for: request, status: 200, body: Self.feed(title: "Current locale"))
        }
        let service = AnnouncementService(
            configuration: testServiceConfiguration(telemetry: false, updates: false),
            httpClient: fake,
            store: MemoryServiceStore()
        )
        let zh = AnnouncementContext(versionCode: 7, locale: "zh-CN")!
        let en = AnnouncementContext(versionCode: 7, locale: "en")!

        let stale = Task { await service.refresh(context: zh, reason: .foreground) }
        let staleRequestStarted = await eventually { fake.dataRequestCount == 1 }
        XCTAssertTrue(staleRequestStarted)
        let current = await service.refresh(context: en, reason: .foreground)
        XCTAssertEqual(current.announcements.first?.title, "Current locale")
        XCTAssertEqual(fake.cancellationCount, 1)
        await oldLocaleGate.open()
        let staleResult = await stale.value
        XCTAssertEqual(staleResult.source, .superseded)
        let staleCache = await service.cachedAnnouncements(for: zh)
        XCTAssertEqual(staleCache, [])
    }

    func testPresentationAcknowledgementIsForegroundOnlyRevisionScopedAndSerialized() async {
        let fake = FakeServiceHTTPClient()
        var revision = 1
        var returnsEmpty = false
        fake.dataHandler = { request, _ in
            makeDataResponse(
                for: request,
                status: 200,
                body: returnsEmpty ? Self.emptyFeed() : Self.feed(revision: revision, severity: "update")
            )
        }
        let service = AnnouncementService(
            configuration: testServiceConfiguration(telemetry: false, updates: false),
            httpClient: fake,
            store: MemoryServiceStore()
        )
        let context = AnnouncementContext(versionCode: 7, locale: "en")!
        _ = await service.refresh(context: context, reason: .manual)

        let backgroundPresentation = await service.nextPresentation(for: context, isActiveForeground: false)
        XCTAssertNil(backgroundPresentation)
        let firstCandidate = await service.nextPresentation(for: context, isActiveForeground: true)
        let first = try XCTUnwrap(firstCandidate)
        XCTAssertEqual(first.action, .openUpdater)
        await service.acknowledgePresentation(first, isActiveForeground: false)
        let stillOutstanding = await service.nextPresentation(for: context, isActiveForeground: true)
        XCTAssertEqual(stillOutstanding, first)
        await service.acknowledgePresentation(first, isActiveForeground: true)
        let afterAcknowledgement = await service.nextPresentation(for: context, isActiveForeground: true)
        XCTAssertNil(afterAcknowledgement)

        revision = 2
        _ = await service.refresh(context: context, reason: .manual)
        let revisedCandidate = await service.nextPresentation(for: context, isActiveForeground: true)
        let revised = try XCTUnwrap(revisedCandidate)
        XCTAssertEqual(revised.announcement.revision, 2, "a new revision must not inherit the old read mark")

        returnsEmpty = true
        _ = await service.refresh(context: context, reason: .manual)
        await service.acknowledgePresentation(revised, isActiveForeground: true)
        let afterWithdrawal = await service.nextPresentation(for: context, isActiveForeground: true)
        XCTAssertNil(afterWithdrawal, "an empty 200 withdraws cached presentations")
        let withdrawnList = await service.announcementList(for: context)
        XCTAssertEqual(withdrawnList, [])
    }

    func testExpiredCachedAnnouncementIsNeverPresentedAfterNetworkFailure() async {
        let fake = FakeServiceHTTPClient()
        var shouldFail = false
        var now = Date(timeIntervalSince1970: 1_700_000_000)
        fake.dataHandler = { request, _ in
            if shouldFail { throw ServiceHTTPError.transport }
            return makeDataResponse(
                for: request,
                status: 200,
                body: Self.feed(endsAt: Int64(now.timeIntervalSince1970) + 2)
            )
        }
        let service = AnnouncementService(
            configuration: testServiceConfiguration(telemetry: false, updates: false),
            httpClient: fake,
            store: MemoryServiceStore(),
            clock: { now }
        )
        let context = AnnouncementContext(versionCode: 7, locale: "en")!
        let initial = await service.refresh(context: context, reason: .manual)
        XCTAssertEqual(initial.announcements.count, 1)

        now = now.addingTimeInterval(3)
        shouldFail = true
        let failed = await service.refresh(context: context, reason: .foreground)
        XCTAssertEqual(failed.source, .cacheAfterFailure)
        XCTAssertEqual(failed.announcements, [])
        let expiredPresentation = await service.nextPresentation(for: context, isActiveForeground: true)
        XCTAssertNil(expiredPresentation)
    }

    func testInfoAnnouncementsStayInListAndNeverEnterPresentationQueue() async {
        let fake = FakeServiceHTTPClient()
        fake.dataHandler = { request, _ in
            makeDataResponse(for: request, status: 200, body: Self.feed(severity: "info"))
        }
        let service = AnnouncementService(
            configuration: testServiceConfiguration(telemetry: false, updates: false),
            httpClient: fake,
            store: MemoryServiceStore()
        )
        let context = AnnouncementContext(versionCode: 7, locale: "en")!
        _ = await service.refresh(context: context, reason: .manual)
        let candidate = await service.nextPresentation(for: context, isActiveForeground: true)
        let list = await service.announcementList(for: context)
        XCTAssertNil(candidate)
        XCTAssertEqual(list.count, 1)
        XCTAssertEqual(list.first?.severity, .info)
    }

    func testMalformed200CannotEraseOrPartiallyReplaceValidCache() async throws {
        let fake = FakeServiceHTTPClient()
        fake.dataHandler = { request, _ in
            if fake.dataRequestCount == 1 {
                return makeDataResponse(for: request, status: 200, body: Self.feed(revision: 1))
            }
            let valid = try JSONSerialization.jsonObject(with: Self.feed(revision: 2)) as! [String: Any]
            let first = (valid["announcements"] as! [[String: Any]])[0]
            let malformed: [String: Any] = ["id": 9, "revision": 1, "severity": "important"]
            return makeDataResponse(
                for: request,
                status: 200,
                body: try JSONSerialization.data(withJSONObject: [
                    "locale": "en",
                    "announcements": [first, malformed]
                ])
            )
        }
        let service = AnnouncementService(
            configuration: testServiceConfiguration(telemetry: false, updates: false),
            httpClient: fake,
            store: MemoryServiceStore()
        )
        let context = AnnouncementContext(versionCode: 7, locale: "en")!
        _ = await service.refresh(context: context, reason: .manual)
        let malformedRefresh = await service.refresh(context: context, reason: .foreground)
        XCTAssertEqual(malformedRefresh.source, .cacheAfterFailure)
        XCTAssertEqual(malformedRefresh.announcements.map(\.revision), [1])
    }

    private static func emptyFeed() -> Data {
        Data("{\"announcements\":[],\"locale\":\"en\"}".utf8)
    }

    private static func feed(
        revision: Int = 1,
        severity: String = "important",
        title: String = "Notice",
        endsAt: Int64 = 0
    ) -> Data {
        let object: [String: Any] = [
            "locale": "en",
            "announcements": [[
                "id": 1,
                "revision": revision,
                "severity": severity,
                "title": title,
                "body": "Body",
                "button": "Open",
                "action_url": "https://services.example/news",
                "platform": "ios",
                "min_version_code": 0,
                "max_version_code": Int32.max,
                "starts_at": 0,
                "ends_at": endsAt,
                "updated_at": 1
            ]]
        ]
        return try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }
}
