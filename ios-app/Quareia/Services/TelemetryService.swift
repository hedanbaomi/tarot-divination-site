import Foundation

enum TelemetryConsent: String, Codable, Equatable {
    case undisclosed
    case disabled
    case enabled
}

enum TelemetryDeckType: String, Codable, CaseIterable {
    case tarot
    case mystagogus
    case lxxxi
}

actor TelemetryService {
    private static let persistenceKey = "telemetry-state-v1"
    private static let schemaVersion = 1
    private static let maximumBodyBytes = 1_024
    private static let maximumResponseBytes = 1_024
    private static let maximumQueuedEvents = 64
    private static let maximumAttempts = 5
    private static let appActiveInterval: TimeInterval = 6 * 60 * 60
    private static let maximumRememberedBuilds = 8

    private enum EventKind: String, Codable, Equatable {
        case installSeen = "install_seen"
        case appActive = "app_active"
        case readingCompleted = "reading_completed"
    }

    private struct QueuedEvent: Codable, Equatable {
        let id: UUID
        let kind: EventKind
        let buildInfo: AppBuildInfoSnapshot
        let deckType: TelemetryDeckType?
        let cardCount: Int?
        var attempt: Int
        var nextAttemptAt: Date
    }

    private struct AppBuildInfoSnapshot: Codable, Equatable {
        let displayVersion: String
        let versionCode: Int
        let locale: String
        let iosMajor: Int

        init(_ buildInfo: AppBuildInfo) {
            displayVersion = buildInfo.displayVersion
            versionCode = buildInfo.versionCode
            locale = buildInfo.locale
            iosMajor = buildInfo.iosMajor
        }
    }

    private struct BuildActivityMark: Codable, Equatable {
        let versionCode: Int
        var sentAt: Date
    }

    private struct PersistentState: Codable {
        var consent: TelemetryConsent = .undisclosed
        var privacyDisclosureShown = false
        var installUUID: String?
        var installSeenSent = false
        var buildActivityMarks: [BuildActivityMark] = []
        var queue: [QueuedEvent] = []
    }

    private let configuration: ServiceConfiguration
    private let httpClient: ServiceHTTPClient
    private let store: ServiceKeyValueStore
    private let buildInfoProvider: () -> AppBuildInfo?
    private let clock: () -> Date
    private let sleeper: (TimeInterval) async -> Void
    private let owner = UUID()
    private var persisted: PersistentState
    private var generation: UInt64 = 0
    private var processingTask: Task<Void, Never>?
    private var processingToken: UUID?
    private var successfulDeliveries = 0

    init(
        configuration: ServiceConfiguration = .unconfigured,
        httpClient: ServiceHTTPClient = URLSessionHTTPClient(),
        store: ServiceKeyValueStore = UserDefaultsServiceStore(suiteName: "fun.luotianyi.quareia.telemetry"),
        buildInfo: @escaping () -> AppBuildInfo? = { AppBuildInfo.current() },
        clock: @escaping () -> Date = Date.init,
        sleeper: @escaping (TimeInterval) async -> Void = { seconds in
            guard seconds > 0 else { return }
            let nanos = UInt64(min(seconds, 30 * 60) * 1_000_000_000)
            try? await Task<Never, Never>.sleep(nanoseconds: nanos)
        }
    ) {
        self.configuration = configuration
        self.httpClient = httpClient
        self.store = store
        self.buildInfoProvider = buildInfo
        self.clock = clock
        self.sleeper = sleeper
        if
            let data = store.data(forKey: Self.persistenceKey),
            let state = try? JSONDecoder().decode(PersistentState.self, from: data)
        {
            persisted = state
        } else {
            persisted = PersistentState()
        }
        if persisted.consent != .enabled || !persisted.privacyDisclosureShown {
            persisted.queue.removeAll()
        }
    }

    func consentState() -> TelemetryConsent {
        persisted.consent
    }

    func privacyDisclosureShown() -> Bool {
        persisted.privacyDisclosureShown
    }

    func markPrivacyDisclosureShown() {
        guard !persisted.privacyDisclosureShown else { return }
        persisted.privacyDisclosureShown = true
        save()
    }

    @discardableResult
    func setConsent(_ consent: TelemetryConsent) -> Bool {
        if consent == .enabled && !persisted.privacyDisclosureShown {
            return false
        }
        if consent == .enabled {
            persisted.consent = .enabled
            save()
            startProcessingIfNeeded()
            return true
        }

        // Invalidate state before touching transport. An old completion can no
        // longer mark delivery or recreate an identity after this point.
        generation &+= 1
        processingTask?.cancel()
        processingTask = nil
        processingToken = nil
        persisted.consent = consent
        persisted.installUUID = nil
        persisted.installSeenSent = false
        persisted.buildActivityMarks.removeAll()
        persisted.queue.removeAll()
        successfulDeliveries = 0
        save()
        httpClient.cancelRequests(owner: owner)
        return true
    }

    func recordInstallSeen() {
        guard canCollect, !persisted.installSeenSent else { return }
        guard !persisted.queue.contains(where: { $0.kind == .installSeen }) else { return }
        guard let buildInfo = buildInfoProvider(), buildInfo.isValidForServices else { return }
        ensureIdentity()
        enqueue(QueuedEvent(
            id: UUID(),
            kind: .installSeen,
            buildInfo: AppBuildInfoSnapshot(buildInfo),
            deckType: nil,
            cardCount: nil,
            attempt: 0,
            nextAttemptAt: clock()
        ))
    }

    func recordAppActive() {
        guard canCollect, let buildInfo = buildInfoProvider(), buildInfo.isValidForServices else { return }
        let now = clock()
        if let mark = persisted.buildActivityMarks.first(where: { $0.versionCode == buildInfo.versionCode }),
           now.timeIntervalSince(mark.sentAt) >= 0,
           now.timeIntervalSince(mark.sentAt) < Self.appActiveInterval
        {
            return
        }
        guard !persisted.queue.contains(where: {
            $0.kind == .appActive && $0.buildInfo.versionCode == buildInfo.versionCode
        }) else { return }
        ensureIdentity()
        enqueue(QueuedEvent(
            id: UUID(),
            kind: .appActive,
            buildInfo: AppBuildInfoSnapshot(buildInfo),
            deckType: nil,
            cardCount: nil,
            attempt: 0,
            nextAttemptAt: now
        ))
    }

    func recordReadingCompleted(deckType: TelemetryDeckType, cardCount: Int) {
        guard canCollect,
              (1...81).contains(cardCount),
              let buildInfo = buildInfoProvider(),
              buildInfo.isValidForServices
        else { return }
        ensureIdentity()
        enqueue(QueuedEvent(
            id: UUID(),
            kind: .readingCompleted,
            buildInfo: AppBuildInfoSnapshot(buildInfo),
            deckType: deckType,
            cardCount: cardCount,
            attempt: 0,
            nextAttemptAt: clock()
        ))
    }

    func waitUntilIdle() async {
        _ = await processingTask?.value
    }

    func pendingEventCount() -> Int {
        persisted.queue.count
    }

    func successfulDeliveryCount() -> Int {
        successfulDeliveries
    }

    private var canCollect: Bool {
        persisted.privacyDisclosureShown && persisted.consent == .enabled
    }

    private func ensureIdentity() {
        if persisted.installUUID == nil {
            persisted.installUUID = UUID().uuidString.lowercased()
            save()
        }
    }

    private func enqueue(_ event: QueuedEvent) {
        if persisted.queue.count >= Self.maximumQueuedEvents {
            if event.kind == .readingCompleted {
                return
            }
            if let expendable = persisted.queue.firstIndex(where: { $0.kind == .readingCompleted }) {
                persisted.queue.remove(at: expendable)
            } else {
                persisted.queue.removeFirst()
            }
        }
        persisted.queue.append(event)
        save()
        startProcessingIfNeeded()
    }

    private func startProcessingIfNeeded() {
        guard
            processingTask == nil,
            canCollect,
            !persisted.queue.isEmpty,
            configuration.telemetryURL != nil
        else { return }
        let token = UUID()
        let expectedGeneration = generation
        processingToken = token
        processingTask = Task { [weak self] in
            guard let self else { return }
            await self.drainQueue(token: token, expectedGeneration: expectedGeneration)
        }
    }

    private func drainQueue(token: UUID, expectedGeneration: UInt64) async {
        defer {
            if processingToken == token {
                processingToken = nil
                processingTask = nil
            }
        }

        while !Task.isCancelled {
            guard canCollect,
                  generation == expectedGeneration,
                  let endpoint = configuration.telemetryURL,
                  let event = persisted.queue.first
            else { return }

            let delay = event.nextAttemptAt.timeIntervalSince(clock())
            if delay > 0 {
                await sleeper(min(delay, 30 * 60))
                guard !Task.isCancelled else { return }
            }

            let result = await send(event: event, endpoint: endpoint)
            guard canCollect,
                  generation == expectedGeneration,
                  persisted.queue.first?.id == event.id
            else { return }

            if result {
                persisted.queue.removeFirst()
                successfulDeliveries += 1
                markSuccessful(event)
            } else {
                var retry = persisted.queue.removeFirst()
                retry.attempt += 1
                if retry.attempt < Self.maximumAttempts {
                    retry.nextAttemptAt = clock().addingTimeInterval(Self.backoff(forAttempt: retry.attempt))
                    persisted.queue.insert(retry, at: 0)
                }
            }
            save()
        }
    }

    private func send(event: QueuedEvent, endpoint: URL) async -> Bool {
        guard canCollect,
              configuration.allowsServiceURL(endpoint),
              let body = payload(for: event),
              body.count <= Self.maximumBodyBytes
        else { return false }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.httpBody = body
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        request.setValue(String(body.count), forHTTPHeaderField: "Content-Length")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Quareia-Divination-iOS", forHTTPHeaderField: "User-Agent")
        do {
            let response = try await httpClient.data(
                for: request,
                owner: owner,
                maximumBytes: Self.maximumResponseBytes,
                redirectValidator: configuration.allowsServiceURL
            )
            return response.statusCode == 204
        } catch {
            return false
        }
    }

    private func payload(for event: QueuedEvent) -> Data? {
        guard canCollect, let rawUUID = persisted.installUUID else { return nil }
        let installHash = ServiceHash.sha256Hex("quareia:ios:install:v1:" + rawUUID)
        var object: [String: Any] = [
            "schema_version": Self.schemaVersion,
            "event": event.kind.rawValue,
            "install_hash": installHash,
            "app_version": event.buildInfo.displayVersion,
            "locale": event.buildInfo.locale,
            "platform": "ios",
            "ios_major": event.buildInfo.iosMajor
        ]
        switch event.kind {
        case .installSeen:
            break
        case .appActive:
            object["version_code"] = event.buildInfo.versionCode
        case .readingCompleted:
            guard let deckType = event.deckType, let cardCount = event.cardCount else { return nil }
            object["deck_type"] = deckType.rawValue
            object["card_count"] = cardCount
        }
        guard JSONSerialization.isValidJSONObject(object) else { return nil }
        return try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    private func markSuccessful(_ event: QueuedEvent) {
        switch event.kind {
        case .installSeen:
            persisted.installSeenSent = true
        case .appActive:
            if let index = persisted.buildActivityMarks.firstIndex(where: {
                $0.versionCode == event.buildInfo.versionCode
            }) {
                persisted.buildActivityMarks[index].sentAt = clock()
            } else {
                persisted.buildActivityMarks.append(BuildActivityMark(
                    versionCode: event.buildInfo.versionCode,
                    sentAt: clock()
                ))
                if persisted.buildActivityMarks.count > Self.maximumRememberedBuilds {
                    persisted.buildActivityMarks.sort { $0.sentAt < $1.sentAt }
                    persisted.buildActivityMarks.removeFirst(
                        persisted.buildActivityMarks.count - Self.maximumRememberedBuilds
                    )
                }
            }
        case .readingCompleted:
            break
        }
    }

    private static func backoff(forAttempt attempt: Int) -> TimeInterval {
        min(30 * pow(2, Double(max(0, attempt - 1))), 30 * 60)
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(persisted) else { return }
        store.set(data, forKey: Self.persistenceKey)
    }
}
