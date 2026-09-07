import CoreFoundation
import Foundation

enum AnnouncementSeverity: String, Codable, CaseIterable {
    case info
    case important
    case update
}

struct Announcement: Codable, Equatable, Identifiable {
    let id: Int64
    let revision: Int
    let severity: AnnouncementSeverity
    let title: String
    let body: String
    let button: String
    let actionURL: URL?
    let startsAt: Int64
    let endsAt: Int64
}

struct AnnouncementContext: Hashable, Codable {
    let versionCode: Int
    let locale: String

    init?(versionCode: Int, locale: String) {
        let normalizedLocale = ServiceLocale.normalized(locale)
        guard
            (1...AppBuildInfo.maximumVersionCode).contains(versionCode),
            ServiceLocale.isValid(normalizedLocale)
        else { return nil }
        self.versionCode = versionCode
        self.locale = normalizedLocale
    }

    init?(buildInfo: AppBuildInfo) {
        self.init(versionCode: buildInfo.versionCode, locale: buildInfo.locale)
    }

    fileprivate var cacheKey: String {
        "ios|\(versionCode)|\(Data(locale.utf8).base64EncodedString())"
    }
}

enum AnnouncementRefreshReason: Equatable {
    case ordinary
    case foreground
    case manual
}

enum AnnouncementRefreshSource: Equatable {
    case cache
    case network
    case notModified
    case cacheAfterFailure
    case notConfigured
    case superseded
}

struct AnnouncementRefreshResult: Equatable {
    let announcements: [Announcement]
    let source: AnnouncementRefreshSource
}

enum AnnouncementPresentationAction: Equatable {
    case none
    case openHTTPS(URL)
    case openUpdater
}

struct AnnouncementPresentation: Equatable {
    let announcement: Announcement
    let action: AnnouncementPresentationAction
    fileprivate let token: UUID
    fileprivate let cacheKey: String
}

actor AnnouncementService {
    private static let ordinaryRefreshInterval: TimeInterval = 6 * 60 * 60
    private static let maximumResponseBytes = 64 * 1024
    private static let maximumReadMarks = 200
    private static let maximumCacheRecords = 16
    private static let persistenceKey = "announcement-state-v1"

    private struct CacheRecord: Codable {
        var announcements: [Announcement]
        var etag: String?
        var fetchedAt: Date
    }

    private struct ReadMark: Codable, Equatable {
        let id: Int64
        let revision: Int
    }

    private struct PersistentState: Codable {
        var caches: [String: CacheRecord] = [:]
        var readMarks: [ReadMark] = []
    }

    private enum FetchOutcome {
        case fetched([Announcement], etag: String?)
        case notModified(etag: String?)
        case failed
    }

    private struct InFlight {
        let token: UUID
        let generation: UInt64
        let context: AnnouncementContext
        let task: Task<FetchOutcome, Never>
    }

    private let configuration: ServiceConfiguration
    private let httpClient: ServiceHTTPClient
    private let store: ServiceKeyValueStore
    private let clock: () -> Date
    private let owner = UUID()
    private var persisted: PersistentState
    private var activeCacheKey: String?
    private var contextGeneration: UInt64 = 0
    private var inFlight: InFlight?
    private var outstandingPresentation: AnnouncementPresentation?

    init(
        configuration: ServiceConfiguration = .unconfigured,
        httpClient: ServiceHTTPClient = URLSessionHTTPClient(),
        store: ServiceKeyValueStore = UserDefaultsServiceStore(suiteName: "fun.luotianyi.quareia.announcements"),
        clock: @escaping () -> Date = Date.init
    ) {
        self.configuration = configuration
        self.httpClient = httpClient
        self.store = store
        self.clock = clock
        if
            let data = store.data(forKey: Self.persistenceKey),
            let state = try? JSONDecoder().decode(PersistentState.self, from: data)
        {
            persisted = state
        } else {
            persisted = PersistentState()
        }
    }

    func cachedAnnouncements(for context: AnnouncementContext) -> [Announcement] {
        activate(context)
        return currentAnnouncements(for: context)
    }

    func announcementList(for context: AnnouncementContext) -> [Announcement] {
        cachedAnnouncements(for: context)
    }

    func refresh(
        context: AnnouncementContext,
        reason: AnnouncementRefreshReason
    ) async -> AnnouncementRefreshResult {
        activate(context)
        let cached = currentAnnouncements(for: context)
        let key = context.cacheKey
        if reason == .ordinary,
           let record = persisted.caches[key],
           clock().timeIntervalSince(record.fetchedAt) >= 0,
           clock().timeIntervalSince(record.fetchedAt) < Self.ordinaryRefreshInterval
        {
            return AnnouncementRefreshResult(announcements: cached, source: .cache)
        }

        guard let endpoint = configuration.announcementsURL else {
            return AnnouncementRefreshResult(announcements: cached, source: .notConfigured)
        }
        guard let request = makeRequest(endpoint: endpoint, context: context, etag: persisted.caches[key]?.etag) else {
            return AnnouncementRefreshResult(announcements: cached, source: .cacheAfterFailure)
        }

        let requestGeneration = contextGeneration
        let flight: InFlight
        if let current = inFlight,
           current.context == context,
           current.generation == requestGeneration
        {
            flight = current
        } else {
            let token = UUID()
            let httpClient = self.httpClient
            let configuration = self.configuration
            let owner = self.owner
            let task = Task {
                await Self.fetch(
                    request: request,
                    httpClient: httpClient,
                    owner: owner,
                    configuration: configuration
                )
            }
            flight = InFlight(token: token, generation: requestGeneration, context: context, task: task)
            inFlight = flight
        }

        let outcome = await flight.task.value
        guard activeCacheKey == key, contextGeneration == flight.generation else {
            if inFlight?.token == flight.token { inFlight = nil }
            return AnnouncementRefreshResult(
                announcements: currentAnnouncements(for: context),
                source: .superseded
            )
        }

        guard inFlight?.token == flight.token else {
            return AnnouncementRefreshResult(
                announcements: currentAnnouncements(for: context),
                source: .cache
            )
        }
        inFlight = nil

        switch outcome {
        case .fetched(let announcements, let etag):
            persisted.caches[key] = CacheRecord(
                announcements: announcements,
                etag: etag,
                fetchedAt: clock()
            )
            pruneCaches()
            invalidateWithdrawnPresentation(context: context)
            save()
            return AnnouncementRefreshResult(
                announcements: currentAnnouncements(for: context),
                source: .network
            )
        case .notModified(let etag):
            guard var record = persisted.caches[key] else {
                return AnnouncementRefreshResult(announcements: [], source: .cacheAfterFailure)
            }
            record.fetchedAt = clock()
            if let etag, !etag.isEmpty { record.etag = etag }
            persisted.caches[key] = record
            pruneCaches()
            save()
            return AnnouncementRefreshResult(
                announcements: currentAnnouncements(for: context),
                source: .notModified
            )
        case .failed:
            return AnnouncementRefreshResult(
                announcements: currentAnnouncements(for: context),
                source: .cacheAfterFailure
            )
        }
    }

    func nextPresentation(
        for context: AnnouncementContext,
        isActiveForeground: Bool
    ) -> AnnouncementPresentation? {
        activate(context)
        guard isActiveForeground else { return nil }
        if let outstandingPresentation { return outstandingPresentation }

        guard let announcement = currentAnnouncements(for: context).first(where: {
            $0.severity != .info && !isRead($0)
        }) else { return nil }

        let presentation = AnnouncementPresentation(
            announcement: announcement,
            action: presentationAction(for: announcement),
            token: UUID(),
            cacheKey: context.cacheKey
        )
        outstandingPresentation = presentation
        return presentation
    }

    func acknowledgePresentation(
        _ presentation: AnnouncementPresentation,
        isActiveForeground: Bool
    ) {
        guard
            isActiveForeground,
            let outstandingPresentation,
            outstandingPresentation.token == presentation.token,
            outstandingPresentation.cacheKey == activeCacheKey
        else { return }

        let mark = ReadMark(
            id: outstandingPresentation.announcement.id,
            revision: outstandingPresentation.announcement.revision
        )
        if !persisted.readMarks.contains(mark) {
            persisted.readMarks.append(mark)
            if persisted.readMarks.count > Self.maximumReadMarks {
                persisted.readMarks.removeFirst(persisted.readMarks.count - Self.maximumReadMarks)
            }
            save()
        }
        self.outstandingPresentation = nil
    }

    func abandonPresentation(_ presentation: AnnouncementPresentation) {
        guard outstandingPresentation?.token == presentation.token else { return }
        outstandingPresentation = nil
    }

    private func activate(_ context: AnnouncementContext) {
        let key = context.cacheKey
        guard activeCacheKey != key else { return }
        activeCacheKey = key
        contextGeneration &+= 1
        outstandingPresentation = nil
        if inFlight != nil {
            httpClient.cancelRequests(owner: owner)
            inFlight = nil
        }
    }

    private func currentAnnouncements(for context: AnnouncementContext) -> [Announcement] {
        guard let record = persisted.caches[context.cacheKey] else { return [] }
        let nowSeconds = Int64(clock().timeIntervalSince1970)
        return record.announcements.filter { announcement in
            announcement.startsAt <= nowSeconds &&
                (announcement.endsAt == 0 || announcement.endsAt >= nowSeconds)
        }
    }

    private func isRead(_ announcement: Announcement) -> Bool {
        persisted.readMarks.contains(ReadMark(id: announcement.id, revision: announcement.revision))
    }

    private func invalidateWithdrawnPresentation(context: AnnouncementContext) {
        guard let outstandingPresentation else { return }
        let stillPublished = currentAnnouncements(for: context).contains {
            $0.id == outstandingPresentation.announcement.id &&
                $0.revision == outstandingPresentation.announcement.revision
        }
        if !stillPublished { self.outstandingPresentation = nil }
    }

    private func presentationAction(for announcement: Announcement) -> AnnouncementPresentationAction {
        if announcement.severity == .update { return .openUpdater }
        guard let url = announcement.actionURL,
              url.scheme?.lowercased() == "https",
              url.host != nil,
              url.port == nil || url.port == 443,
              url.user == nil,
              url.password == nil
        else { return .none }
        return .openHTTPS(url)
    }

    private func makeRequest(
        endpoint: URL,
        context: AnnouncementContext,
        etag: String?
    ) -> URLRequest? {
        guard configuration.allowsServiceURL(endpoint),
              var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        else { return nil }
        var queryItems = components.queryItems ?? []
        queryItems.append(contentsOf: [
            URLQueryItem(name: "platform", value: "ios"),
            URLQueryItem(name: "version_code", value: String(context.versionCode)),
            URLQueryItem(name: "locale", value: context.locale)
        ])
        components.queryItems = queryItems
        guard let url = components.url, configuration.allowsServiceURL(url) else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Quareia-Divination-iOS", forHTTPHeaderField: "User-Agent")
        if let etag, !etag.isEmpty {
            request.setValue(etag, forHTTPHeaderField: "If-None-Match")
        }
        return request
    }

    private static func fetch(
        request: URLRequest,
        httpClient: ServiceHTTPClient,
        owner: UUID,
        configuration: ServiceConfiguration
    ) async -> FetchOutcome {
        do {
            let response = try await httpClient.data(
                for: request,
                owner: owner,
                maximumBytes: maximumResponseBytes,
                redirectValidator: configuration.allowsServiceURL
            )
            let etag = response.headers["etag"]
            if response.statusCode == 304 {
                return .notModified(etag: etag)
            }
            guard response.statusCode == 200,
                  let announcements = parse(response.data)
            else { return .failed }
            return .fetched(announcements, etag: etag)
        } catch {
            return .failed
        }
    }

    private static func parse(_ data: Data) -> [Announcement]? {
        guard
            let root = try? JSONSerialization.jsonObject(with: data),
            let object = root as? [String: Any],
            let rawAnnouncements = object["announcements"] as? [Any]
        else { return nil }

        let parsed = rawAnnouncements.compactMap { raw -> Announcement? in
            guard let item = raw as? [String: Any],
                  let id = strictInt64(item["id"]), id > 0,
                  let revision64 = strictInt64(item["revision"]),
                  revision64 > 0, revision64 <= Int64(Int.max),
                  let rawSeverity = item["severity"] as? String,
                  let severity = AnnouncementSeverity(rawValue: rawSeverity),
                  let title = boundedString(item["title"], maximumBytes: 1_024),
                  let body = boundedString(item["body"], maximumBytes: 16 * 1_024),
                  let button = boundedString(item["button"], maximumBytes: 1_024),
                  let startsAt = strictInt64(item["starts_at"]), startsAt >= 0,
                  let endsAt = strictInt64(item["ends_at"]), endsAt >= 0
            else { return nil }

            let actionURL: URL?
            if let rawURL = item["action_url"] as? String,
               rawURL.utf8.count <= 2_048,
               let url = URL(string: rawURL),
               url.scheme?.lowercased() == "https",
               url.host != nil,
               url.user == nil,
               url.password == nil
            {
                actionURL = url
            } else {
                actionURL = nil
            }
            return Announcement(
                id: id,
                revision: Int(revision64),
                severity: severity,
                title: title,
                body: body,
                button: button,
                actionURL: actionURL,
                startsAt: startsAt,
                endsAt: endsAt
            )
        }
        guard parsed.count == rawAnnouncements.count else { return nil }
        return parsed
    }

    private static func strictInt64(_ value: Any?) -> Int64? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID()
        else { return nil }
        let double = number.doubleValue
        guard double.isFinite, double.rounded(.towardZero) == double,
              double >= Double(Int64.min), double <= Double(Int64.max)
        else { return nil }
        return number.int64Value
    }

    private static func boundedString(_ value: Any?, maximumBytes: Int) -> String? {
        guard let string = value as? String, string.utf8.count <= maximumBytes else { return nil }
        return string
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(persisted) else { return }
        store.set(data, forKey: Self.persistenceKey)
    }

    private func pruneCaches() {
        while persisted.caches.count > Self.maximumCacheRecords,
              let oldest = persisted.caches.min(by: { $0.value.fetchedAt < $1.value.fetchedAt })?.key
        {
            persisted.caches.removeValue(forKey: oldest)
        }
    }
}
