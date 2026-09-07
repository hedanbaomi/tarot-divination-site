import Foundation

private final class HostPreferenceStore {
    private let lock = NSLock()
    private let defaults: UserDefaults

    init(defaults: UserDefaults) { self.defaults = defaults }

    var locale: String {
        lock.lock(); defer { lock.unlock() }
        return defaults.string(forKey: Keys.locale) ?? "zh-CN"
    }

    var theme: String {
        lock.lock(); defer { lock.unlock() }
        return defaults.string(forKey: Keys.theme) ?? "celestial"
    }

    func setLocale(_ value: String) {
        lock.lock(); defaults.set(value, forKey: Keys.locale); lock.unlock()
    }

    func setTheme(_ value: String) {
        lock.lock(); defaults.set(value, forKey: Keys.theme); lock.unlock()
    }

    private enum Keys {
        static let locale = "quareia.host.locale"
        static let theme = "quareia.host.theme"
    }
}

final class NativeServicesFacade: HostServiceFacading {
    private let preferences: HostPreferenceStore
    private let bundle: Bundle
    private let telemetry: TelemetryService
    private let announcements: AnnouncementService
    private let updates: UpdateService
    private let lock = NSLock()
    private var pendingPresentations: [String: AnnouncementPresentation] = [:]
    private var availableManifest: UpdateManifest?
    private var downloadedURLs = Set<URL>()
    private var automaticAnnouncementCycleActive = false

    init(
        configuration: ServiceConfiguration = .unconfigured,
        defaults: UserDefaults = .standard,
        bundle: Bundle = .main,
        httpClientFactory: () -> ServiceHTTPClient = { URLSessionHTTPClient() }
    ) {
        let preferences = HostPreferenceStore(defaults: defaults)
        self.preferences = preferences
        self.bundle = bundle
        let buildInfo = { Self.buildInfo(bundle: bundle, locale: preferences.locale) }
        telemetry = TelemetryService(
            configuration: configuration,
            httpClient: httpClientFactory(),
            store: UserDefaultsServiceStore(suiteName: "fun.luotianyi.quareia.telemetry"),
            buildInfo: buildInfo
        )
        announcements = AnnouncementService(
            configuration: configuration,
            httpClient: httpClientFactory(),
            store: UserDefaultsServiceStore(suiteName: "fun.luotianyi.quareia.announcements")
        )
        let updateDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("QuareiaValidatedUpdates", isDirectory: true)
        Self.prepareUpdateDirectory(updateDirectory)
        updates = UpdateService(
            configuration: configuration,
            httpClient: httpClientFactory(),
            buildInfo: buildInfo,
            downloadDirectory: updateDirectory
        )
    }

    func hostInfo() async -> HostInfoValue {
        let build = Self.buildInfo(bundle: bundle, locale: preferences.locale)
        let consent = await telemetry.consentState()
        let disclosure = await telemetry.privacyDisclosureShown()
        return HostInfoValue(
            version: build?.displayVersion ?? "0",
            build: build.map { String($0.versionCode) } ?? "0",
            locale: preferences.locale,
            theme: preferences.theme,
            telemetryEnabled: consent == .undisclosed ? nil : consent == .enabled,
            privacyDisclosureShown: disclosure
        )
    }

    func setLocale(_ locale: String) async throws { preferences.setLocale(locale) }
    func setTheme(_ theme: String) async throws { preferences.setTheme(theme) }

    func telemetryState() async -> (enabled: Bool?, disclosureShown: Bool) {
        let consent = await telemetry.consentState()
        let disclosure = await telemetry.privacyDisclosureShown()
        return (consent == .undisclosed ? nil : consent == .enabled, disclosure)
    }

    func markPrivacyDisclosureShown() async { await telemetry.markPrivacyDisclosureShown() }

    func setTelemetryEnabled(_ enabled: Bool) async throws {
        let accepted = await telemetry.setConsent(enabled ? .enabled : .disabled)
        guard accepted else { throw NativeHostError.privacyRequired }
        if enabled {
            await telemetry.recordInstallSeen()
            await telemetry.recordAppActive()
        }
    }

    func recordReadingCompleted(deckType: String, cardCount: Int) async throws {
        guard let deck = TelemetryDeckType(rawValue: deckType) else { throw NativeHostError.invalidState }
        await telemetry.recordReadingCompleted(deckType: deck, cardCount: cardCount)
    }

    func recordAppActive() async { await telemetry.recordAppActive() }

    func announcements(manual: Bool, isForeground: Bool) async -> [HostAnnouncementValue] {
        guard let build = Self.buildInfo(bundle: bundle, locale: preferences.locale),
              let context = AnnouncementContext(buildInfo: build) else {
            return []
        }
        let shouldRefresh: Bool
        lock.lock()
        if manual {
            shouldRefresh = true
            automaticAnnouncementCycleActive = false
        } else if automaticAnnouncementCycleActive {
            shouldRefresh = false
        } else {
            shouldRefresh = true
            automaticAnnouncementCycleActive = true
        }
        lock.unlock()
        if shouldRefresh {
            _ = await announcements.refresh(context: context, reason: manual ? .manual : .foreground)
        }
        let presentation = await announcements.nextPresentation(for: context, isActiveForeground: isForeground)
        if !manual {
            guard let presentation else {
                lock.lock(); automaticAnnouncementCycleActive = false; lock.unlock()
                return []
            }
            return [store(presentation)]
        }
        let list = await announcements.announcementList(for: context)
        var values: [HostAnnouncementValue] = []
        if let presentation { values.append(store(presentation)) }
        for announcement in list {
            if presentation?.announcement.id == announcement.id,
               presentation?.announcement.revision == announcement.revision {
                continue
            }
            values.append(HostAnnouncementValue(
                token: "list-\(announcement.id)-\(announcement.revision)",
                title: announcement.title,
                message: announcement.body,
                action: Self.hostAction(for: announcement),
                requiresAcknowledgement: false
            ))
        }
        return values
    }

    func acknowledgeAnnouncement(token: String, wasPresentedInForeground: Bool) async {
        guard let presentation = takePresentation(token: token) else { return }
        await announcements.acknowledgePresentation(presentation, isActiveForeground: wasPresentedInForeground)
    }

    func abandonAnnouncement(token: String) async {
        lock.lock(); automaticAnnouncementCycleActive = false; lock.unlock()
        guard let presentation = takePresentation(token: token) else { return }
        await announcements.abandonPresentation(presentation)
    }

    func checkForUpdates() async -> HostUpdateValue {
        switch await updates.check() {
        case .notConfigured:
            setAvailableManifest(nil)
            return .notConfigured
        case .upToDate:
            setAvailableManifest(nil)
            return .upToDate
        case let .available(manifest):
            setAvailableManifest(manifest)
            return .available(version: manifest.displayVersion, build: manifest.build)
        case .failed:
            setAvailableManifest(nil)
            return .failure
        }
    }

    func downloadAvailableUpdate(progress: @escaping (Double) -> Void) async throws -> URL {
        lock.lock(); let manifest = availableManifest; lock.unlock()
        guard let manifest else { throw NativeHostError.invalidState }
        return try await withTaskCancellationHandler(operation: {
            switch await updates.download(manifest, progress: { value in progress(value.fraction) }) {
            case let .success(url):
                do {
                    try FileManager.default.setAttributes(
                        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                        ofItemAtPath: url.path
                    )
                    var values = URLResourceValues()
                    values.isExcludedFromBackup = true
                    var mutableURL = url
                    try mutableURL.setResourceValues(values)
                } catch {
                    try? FileManager.default.removeItem(at: url)
                    throw NativeHostError.updateFailed
                }
                lock.lock(); downloadedURLs.insert(url); lock.unlock()
                return url
            case .failure(.cancelled):
                throw CancellationError()
            case .failure:
                throw NativeHostError.updateFailed
            }
        }, onCancel: { [updates] in
            Task { await updates.cancel() }
        })
    }

    func cleanupDownloadedUpdate(_ url: URL) async {
        lock.lock(); let owned = downloadedURLs.remove(url) != nil; lock.unlock()
        if owned { try? FileManager.default.removeItem(at: url) }
    }

    private func store(_ presentation: AnnouncementPresentation) -> HostAnnouncementValue {
        let token = UUID().uuidString.lowercased()
        lock.lock(); pendingPresentations[token] = presentation; lock.unlock()
        return HostAnnouncementValue(
            token: token,
            title: presentation.announcement.title,
            message: presentation.announcement.body,
            action: Self.hostAction(presentation.action),
            requiresAcknowledgement: true
        )
    }

    private func setAvailableManifest(_ manifest: UpdateManifest?) {
        lock.lock(); availableManifest = manifest; lock.unlock()
    }

    private func takePresentation(token: String) -> AnnouncementPresentation? {
        lock.lock(); defer { lock.unlock() }
        return pendingPresentations.removeValue(forKey: token)
    }

    private static func hostAction(_ action: AnnouncementPresentationAction) -> HostAnnouncementValue.Action {
        switch action {
        case .none: return .none
        case let .openHTTPS(url): return .openHTTPS(url)
        case .openUpdater: return .openUpdater
        }
    }

    private static func hostAction(for announcement: Announcement) -> HostAnnouncementValue.Action {
        if announcement.severity == .update { return .openUpdater }
        guard let url = announcement.actionURL,
              url.scheme?.lowercased() == "https", url.host?.isEmpty == false,
              (url.port == nil || url.port == 443), url.user == nil, url.password == nil else { return .none }
        return .openHTTPS(url)
    }

    private static func buildInfo(bundle: Bundle, locale: String) -> AppBuildInfo? {
        guard let current = AppBuildInfo.current(bundle: bundle) else { return nil }
        return AppBuildInfo(
            displayVersion: current.displayVersion,
            versionCode: current.versionCode,
            locale: locale,
            iosMajor: current.iosMajor
        )
    }

    private static func prepareUpdateDirectory(_ directory: URL) {
        let manager = FileManager.default
        try? manager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        guard let urls = try? manager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        let candidates = urls.compactMap { url -> (URL, Date)? in
            guard url.lastPathComponent.hasPrefix("Quareia-"), url.pathExtension.lowercased() == "ipa",
                  let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey]),
                  values.isRegularFile == true else { return nil }
            return (url, values.contentModificationDate ?? .distantPast)
        }.sorted { $0.1 > $1.1 }
        for (index, candidate) in candidates.enumerated()
            where index >= 2 || Date().timeIntervalSince(candidate.1) > HostFileTransferStore.retentionInterval {
            try? manager.removeItem(at: candidate.0)
        }
    }
}

enum NativeHostServiceFactory {
    static let bundleConfigurationKey = "QuareiaServices"
    private static let bundleConfigurationKeys: Set<String> = [
        "trustedHosts", "announcementsURL", "telemetryURL", "updateManifestURL"
    ]

    static func make(
        arguments: [String] = ProcessInfo.processInfo.arguments,
        bundle: Bundle = .main
    ) -> HostServiceFacading {
        #if PUBLIC_TESTING
        if arguments.contains("-enable-loopback-service-fixture"),
           let baseURL = URL(string: "http://127.0.0.1:8787"),
           let configuration = ServiceConfiguration.fixtureEnvironment(
               baseURL: baseURL,
               explicitFixtureEnvironment: true,
               updateManifestPath: arguments.contains("-enable-loopback-update-fixture") ? "/v1/ios-update" : nil
           ) {
            return NativeServicesFacade(configuration: configuration, bundle: bundle)
        }
        #endif
        return NativeServicesFacade(
            configuration: configuration(from: bundle.object(forInfoDictionaryKey: bundleConfigurationKey)),
            bundle: bundle
        )
    }

    static func configuration(from value: Any?) -> ServiceConfiguration {
        guard let object = value as? [String: Any],
              Set(object.keys) == bundleConfigurationKeys,
              let hosts = object["trustedHosts"] as? [String],
              !hosts.isEmpty,
              hosts.count <= 16,
              Set(hosts).count == hosts.count,
              hosts.allSatisfy(isValidTrustedHost),
              let announcements = exactHTTPSURL(object["announcementsURL"]),
              let telemetry = exactHTTPSURL(object["telemetryURL"]),
              let updates = exactHTTPSURL(object["updateManifestURL"])
        else { return .unconfigured }
        return ServiceConfiguration.configured(
            announcementsURL: announcements,
            telemetryURL: telemetry,
            updateManifestURL: updates,
            trustedHosts: Set(hosts)
        ) ?? .unconfigured
    }

    private static func exactHTTPSURL(_ value: Any?) -> URL? {
        guard let raw = value as? String,
              raw == raw.trimmingCharacters(in: .whitespacesAndNewlines),
              (1...2_048).contains(raw.utf8.count),
              let url = URL(string: raw),
              url.scheme == "https",
              url.host?.isEmpty == false,
              (url.port == nil || url.port == 443),
              url.user == nil,
              url.password == nil,
              url.fragment == nil else { return nil }
        return url
    }

    private static func isValidTrustedHost(_ host: String) -> Bool {
        guard host == host.lowercased(),
              host == host.trimmingCharacters(in: .whitespacesAndNewlines),
              (1...253).contains(host.utf8.count),
              !host.hasSuffix(".") else { return false }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789-")
        return labels.allSatisfy { label in
            !label.isEmpty && label.utf8.count <= 63
                && label.first != "-" && label.last != "-"
                && label.unicodeScalars.allSatisfy(allowed.contains)
        }
    }
}
