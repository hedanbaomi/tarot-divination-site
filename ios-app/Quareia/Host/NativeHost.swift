import Foundation
import UIKit

enum NativeHostError: BridgeCodedError {
    case unavailable
    case privacyRequired
    case presentationBusy
    case invalidState
    case updateFailed

    var bridgeCode: String {
        switch self {
        case .unavailable: return "SERVICE_UNAVAILABLE"
        case .privacyRequired: return "PRIVACY_DISCLOSURE_REQUIRED"
        case .presentationBusy: return "PRESENTATION_BUSY"
        case .invalidState: return "INVALID_STATE"
        case .updateFailed: return "UPDATE_FAILED"
        }
    }
}

struct HostInfoValue {
    let version: String
    let build: String
    let locale: String
    let theme: String
    let telemetryEnabled: Bool?
    let privacyDisclosureShown: Bool
}

struct HostAnnouncementValue: Equatable {
    enum Action: Equatable {
        case none
        case openHTTPS(URL)
        case openUpdater
    }

    let token: String
    let title: String
    let message: String
    let action: Action
    let requiresAcknowledgement: Bool
}

enum HostUpdateValue: Equatable {
    case notConfigured
    case upToDate
    case available(version: String, build: Int)
    case failure
}

protocol HostServiceFacading: AnyObject {
    func hostInfo() async -> HostInfoValue
    func setLocale(_ locale: String) async throws
    func setTheme(_ theme: String) async throws
    func telemetryState() async -> (enabled: Bool?, disclosureShown: Bool)
    func markPrivacyDisclosureShown() async
    func setTelemetryEnabled(_ enabled: Bool) async throws
    func recordReadingCompleted(deckType: String, cardCount: Int) async throws
    func recordAppActive() async
    func announcements(manual: Bool, isForeground: Bool) async -> [HostAnnouncementValue]
    func acknowledgeAnnouncement(token: String, wasPresentedInForeground: Bool) async
    func abandonAnnouncement(token: String) async
    func checkForUpdates() async -> HostUpdateValue
    func downloadAvailableUpdate(progress: @escaping (Double) -> Void) async throws -> URL
    func cleanupDownloadedUpdate(_ url: URL) async
}

final class LocalHostServiceFacade: HostServiceFacading {
    private let defaults: UserDefaults
    private let bundle: Bundle

    init(defaults: UserDefaults = .standard, bundle: Bundle = .main) {
        self.defaults = defaults
        self.bundle = bundle
    }

    func hostInfo() async -> HostInfoValue {
        let shown = defaults.bool(forKey: Keys.privacyShown)
        let telemetry = shown && defaults.object(forKey: Keys.telemetryEnabled) != nil
            ? defaults.bool(forKey: Keys.telemetryEnabled) : nil
        return HostInfoValue(
            version: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0",
            build: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0",
            locale: defaults.string(forKey: Keys.locale) ?? "zh-CN",
            theme: defaults.string(forKey: Keys.theme) ?? "celestial",
            telemetryEnabled: telemetry,
            privacyDisclosureShown: shown
        )
    }

    func setLocale(_ locale: String) async throws { defaults.set(locale, forKey: Keys.locale) }
    func setTheme(_ theme: String) async throws { defaults.set(theme, forKey: Keys.theme) }

    func telemetryState() async -> (enabled: Bool?, disclosureShown: Bool) {
        let shown = defaults.bool(forKey: Keys.privacyShown)
        guard shown, defaults.object(forKey: Keys.telemetryEnabled) != nil else { return (nil, shown) }
        return (defaults.bool(forKey: Keys.telemetryEnabled), shown)
    }

    func markPrivacyDisclosureShown() async { defaults.set(true, forKey: Keys.privacyShown) }

    func setTelemetryEnabled(_ enabled: Bool) async throws {
        guard defaults.bool(forKey: Keys.privacyShown) else { throw NativeHostError.privacyRequired }
        defaults.set(enabled, forKey: Keys.telemetryEnabled)
    }

    func recordReadingCompleted(deckType: String, cardCount: Int) async throws {}
    func recordAppActive() async {}
    func announcements(manual: Bool, isForeground: Bool) async -> [HostAnnouncementValue] { [] }
    func acknowledgeAnnouncement(token: String, wasPresentedInForeground: Bool) async {}
    func abandonAnnouncement(token: String) async {}
    func checkForUpdates() async -> HostUpdateValue { .notConfigured }
    func downloadAvailableUpdate(progress: @escaping (Double) -> Void) async throws -> URL { throw NativeHostError.unavailable }
    func cleanupDownloadedUpdate(_ url: URL) async {}

    private enum Keys {
        static let locale = "quareia.host.locale"
        static let theme = "quareia.host.theme"
        static let privacyShown = "quareia.host.privacyShown"
        static let telemetryEnabled = "quareia.host.telemetryEnabled"
    }
}

@MainActor
final class NativeHost {
    private let services: HostServiceFacading
    private let files: HostFileTransferStore
    private let presenter: HostPresentationCoordinating
    private let protectedBaseURL: String
    private let applyTheme: (String) -> Void
    private let applyLocale: (String) -> Void
    private var foregroundPresentationTask: Task<Void, Never>?

    init(
        services: HostServiceFacading,
        files: HostFileTransferStore,
        presenter: HostPresentationCoordinating,
        protectedBaseURL: String,
        applyTheme: @escaping (String) -> Void,
        applyLocale: @escaping (String) -> Void = { _ in }
    ) {
        self.services = services
        self.files = files
        self.presenter = presenter
        self.protectedBaseURL = protectedBaseURL
        self.applyTheme = applyTheme
        self.applyLocale = applyLocale
    }

    func handle(_ request: ValidatedBridgeRequest) async throws -> [String: Any] {
        switch (request.method, request.parameters) {
        case (.hostInfo, .none):
            let info = await services.hostInfo()
            return [
                "platform": "iOS",
                "version": info.version,
                "build": info.build,
                "locale": info.locale,
                "theme": info.theme,
                "telemetryState": telemetryLabel(enabled: info.telemetryEnabled),
                "requiresDisclosure": !info.privacyDisclosureShown,
                "capabilities": BridgeMethod.allCases.map(\.rawValue),
                "protectedAssetBaseURL": protectedBaseURL
            ]
        case let (.setLocale, .locale(locale)):
            try await services.setLocale(locale)
            applyLocale(locale)
            return ["applied": true]
        case let (.setTheme, .theme(theme)):
            try await services.setTheme(theme)
            applyTheme(theme)
            return ["applied": true]
        case (.presentAbout, .none):
            return try await presentAbout()
        case (.presentPrivacy, .none):
            return try await presentPrivacy()
        case (.presentAnnouncements, .none):
            return try await presentAnnouncements(manual: true)
        case (.checkForUpdates, .none):
            return try await presentUpdateCheck()
        case let (.readingCompleted, .readingCompleted(deckType, cardCount)):
            try await services.recordReadingCompleted(deckType: deckType, cardCount: cardCount)
            return ["recorded": true]
        case (.telemetryState, .none):
            let state = await services.telemetryState()
            return [
                "state": telemetryLabel(enabled: state.enabled),
                "requiresDisclosure": !state.disclosureShown
            ]
        case let (.setTelemetryEnabled, .telemetryEnabled(enabled)):
            let state = await services.telemetryState()
            guard state.disclosureShown else { throw NativeHostError.privacyRequired }
            try await services.setTelemetryEnabled(enabled)
            return ["applied": true, "state": enabled ? "enabled" : "disabled"]
        case let (.fileExportBegin, .exportBegin(kind, name, byteCount)):
            return ["transferID": try files.beginExport(kind: kind, name: name, expectedBytes: byteCount)]
        case let (.fileExportChunk, .exportChunk(transferID, offset, data)):
            let appended = try files.appendExport(identifier: transferID, offset: offset, chunk: data)
            return ["offset": appended.offset, "byteCount": appended.byteCount, "nextOffset": appended.nextOffset]
        case let (.fileExportFinish, .exportFinish(transferID, action)):
            let prepared = try files.prepareExport(identifier: transferID)
            defer { files.completeExport(identifier: transferID) }
            let outcome = try await presenter.presentExport(
                url: prepared.url,
                name: prepared.name,
                action: action,
                accessibilityIdentifier: action == "save" ? "host.export" : "host.backup"
            )
            return ["outcome": outcome.rawValue, "name": prepared.name]
        case let (.fileImport, .fileImport(kind)):
            let selection = try await presenter.presentImport(kind: kind, accessibilityIdentifier: "host.import")
            guard selection.outcome == .success, let url = selection.url else {
                return ["outcome": selection.outcome.rawValue]
            }
            let imported = try files.beginImport(kind: kind, url: url)
            return [
                "outcome": "success",
                "transferID": imported.identifier,
                "name": imported.name,
                "byteCount": imported.byteCount
            ]
        case let (.fileImportRead, .importRead(transferID, offset, length)):
            let chunk = try files.readImport(identifier: transferID, offset: offset, length: length)
            return [
                "base64": chunk.data.base64EncodedString(),
                "offset": chunk.offset,
                "byteCount": chunk.data.count,
                "eof": chunk.eof
            ]
        case let (.fileTransferCancel, .transferID(transferID)):
            try files.cancel(identifier: transferID)
            return [:]
        case let (.fileImportFinish, .transferID(transferID)):
            try files.finishImport(identifier: transferID)
            return [:]
        default:
            throw NativeHostError.invalidState
        }
    }

    func presentAbout() async throws -> [String: Any] {
        let info = await services.hostInfo()
        let strings = HostStrings(locale: info.locale)
        var details = strings.aboutBody(version: info.version, build: info.build)
        #if PUBLIC_TESTING
        details += strings.syntheticMarker
        #endif
        let outcome = try await presenter.presentModal(HostModal(
            accessibilityIdentifier: "host.about",
            title: "Quareia",
            message: details,
            actions: [HostModalAction(identifier: "host.about.close", title: strings.close, value: "close")]
        ))
        return ["outcome": outcome == "cancelled" ? "cancelled" : "success"]
    }

    func presentPrivacy() async throws -> [String: Any] {
        let strings = HostStrings(locale: await services.hostInfo().locale)
        let choice = try await presenter.presentModal(HostModal(
            accessibilityIdentifier: "host.privacy",
            title: strings.privacyTitle,
            message: strings.privacyBody,
            actions: [
                HostModalAction(identifier: "privacy.enable", title: strings.privacyEnable, value: "enable"),
                HostModalAction(identifier: "privacy.disable", title: strings.privacyDisable, value: "disable"),
                HostModalAction(identifier: "privacy.close", title: strings.close, value: "close")
            ]
        ))
        guard choice != "cancelled" else { return ["outcome": "cancelled"] }
        await services.markPrivacyDisclosureShown()
        if choice == "enable" || choice == "disable" {
            try await services.setTelemetryEnabled(choice == "enable")
        }
        let state = await services.telemetryState()
        return [
            "outcome": "success",
            "state": telemetryLabel(enabled: state.enabled),
            "requiresDisclosure": !state.disclosureShown
        ]
    }

    func presentAnnouncements(manual: Bool) async throws -> [String: Any] {
        guard presenter.isActiveForeground else { return ["outcome": "cancelled", "presented": 0] }
        if manual { return try await presentAnnouncementList() }
        var count = 0
        while count < 50 {
            let announcements = await services.announcements(
                manual: false,
                isForeground: presenter.isActiveForeground
            )
            guard !announcements.isEmpty else { break }
            for announcement in announcements {
                guard count < 50 else { break }
                guard presenter.isActiveForeground else {
                    await services.abandonAnnouncement(token: announcement.token)
                    return ["outcome": "cancelled", "presented": count]
                }
                let strings = HostStrings(locale: await services.hostInfo().locale)
                let choice: String
                do {
                    choice = try await presenter.presentModal(HostModal(
                        accessibilityIdentifier: "host.announcements",
                        title: announcement.title,
                        message: announcement.message,
                        actions: announcementActions(announcement, strings: strings)
                    ))
                } catch {
                    await services.abandonAnnouncement(token: announcement.token)
                    throw error
                }
                guard choice != "cancelled", presenter.isActiveForeground else {
                    await services.abandonAnnouncement(token: announcement.token)
                    return ["outcome": "cancelled", "presented": count]
                }
                if announcement.requiresAcknowledgement {
                    await services.acknowledgeAnnouncement(token: announcement.token, wasPresentedInForeground: true)
                }
                count += 1
                if choice == "open" {
                    switch announcement.action {
                    case let .openHTTPS(url): presenter.openExternalHTTPS(url)
                    case .openUpdater: _ = try await presentUpdateCheck()
                    case .none: break
                    }
                }
            }
        }
        return ["outcome": "success", "presented": count]
    }

    private func presentAnnouncementList() async throws -> [String: Any] {
        let announcements = await services.announcements(manual: true, isForeground: presenter.isActiveForeground)
        guard !announcements.isEmpty else { return ["outcome": "success", "presented": 0] }
        let strings = HostStrings(locale: await services.hostInfo().locale)
        let selection: HostAnnouncementListSelection
        do {
            selection = try await presenter.presentAnnouncementList(
                title: strings.announcementsTitle,
                announcements: announcements,
                closeTitle: strings.close,
                openTitle: strings.open
            )
        } catch {
            for announcement in announcements where announcement.requiresAcknowledgement {
                await services.abandonAnnouncement(token: announcement.token)
            }
            throw error
        }
        guard selection.outcome == .success, presenter.isActiveForeground else {
            for announcement in announcements where announcement.requiresAcknowledgement {
                await services.abandonAnnouncement(token: announcement.token)
            }
            return ["outcome": selection.outcome.rawValue, "presented": announcements.count]
        }
        for announcement in announcements where announcement.requiresAcknowledgement {
            await services.acknowledgeAnnouncement(token: announcement.token, wasPresentedInForeground: true)
        }
        if let token = selection.selectedToken,
           let announcement = announcements.first(where: { $0.token == token }) {
            switch announcement.action {
            case let .openHTTPS(url): presenter.openExternalHTTPS(url)
            case .openUpdater: _ = try await presentUpdateCheck()
            case .none: break
            }
        }
        return ["outcome": "success", "presented": announcements.count]
    }

    func presentUpdateCheck() async throws -> [String: Any] {
        let value = await services.checkForUpdates()
        let strings = HostStrings(locale: await services.hostInfo().locale)
        let content: (String, String)
        switch value {
        case .notConfigured: content = (strings.updatesTitle, strings.updateNotConfigured)
        case .upToDate: content = (strings.updatesTitle, strings.updateCurrent)
        case let .available(version, build): content = (strings.updateAvailableTitle, strings.updateAvailable(version: version, build: build))
        case .failure: content = (strings.updatesTitle, strings.updateFailed)
        }
        var actions = [HostModalAction(identifier: "host.update.close", title: strings.close, value: "close")]
        if case .available = value {
            actions.insert(HostModalAction(identifier: "host.update.download", title: strings.download, value: "download"), at: 0)
        }
        let choice = try await presenter.presentModal(HostModal(
            accessibilityIdentifier: "host.update",
            title: content.0,
            message: content.1,
            actions: actions
        ))
        guard choice == "download" else {
            return ["outcome": choice == "cancelled" ? "cancelled" : "success", "state": updateLabel(value)]
        }
        let downloaded = try await presenter.presentUpdateDownload(
            title: strings.downloading,
            cancelTitle: strings.cancel,
            accessibilityIdentifier: "host.update.download",
            operation: { [services] progress in
                try await services.downloadAvailableUpdate(progress: progress)
            }
        )
        guard downloaded.outcome == .success, let url = downloaded.url else {
            return ["outcome": downloaded.outcome.rawValue, "state": "available"]
        }
        defer { Task { await services.cleanupDownloadedUpdate(url) } }
        let handoff = try await presenter.presentExport(
            url: url,
            name: url.lastPathComponent,
            action: "share",
            accessibilityIdentifier: "host.update.handoff"
        )
        return ["outcome": handoff.rawValue, "state": "available"]
    }

    func applicationDidBecomeActive(presentPrivacyIfNeeded: Bool) {
        foregroundPresentationTask?.cancel()
        foregroundPresentationTask = Task { [weak self] in
            guard let self else { return }
            await services.recordAppActive()
            if presentPrivacyIfNeeded {
                let state = await services.telemetryState()
                if !state.disclosureShown { _ = try? await presentPrivacy() }
            }
            if !Task.isCancelled { _ = try? await presentAnnouncements(manual: false) }
        }
    }

    func applicationWillResignActive() {
        foregroundPresentationTask?.cancel()
        foregroundPresentationTask = nil
        presenter.cancelActivePresentation()
    }

    func stop() {
        applicationWillResignActive()
        files.cancelAll()
    }

    private func telemetryLabel(enabled: Bool?) -> String {
        guard let enabled else { return "undisclosed" }
        return enabled ? "enabled" : "disabled"
    }

    private func updateLabel(_ update: HostUpdateValue) -> String {
        switch update {
        case .notConfigured: return "notConfigured"
        case .upToDate: return "upToDate"
        case .available: return "available"
        case .failure: return "failure"
        }
    }

    private func announcementActions(_ announcement: HostAnnouncementValue, strings: HostStrings) -> [HostModalAction] {
        var actions = [HostModalAction(identifier: "announcement.dismiss", title: strings.dismiss, value: "dismiss")]
        if announcement.action != .none {
            actions.insert(HostModalAction(identifier: "announcement.update", title: strings.open, value: "open"), at: 0)
        }
        return actions
    }
}

private struct HostStrings {
    let isEnglish: Bool
    init(locale: String) { isEnglish = locale == "en" }
    var close: String { isEnglish ? "Close" : "关闭" }
    var cancel: String { isEnglish ? "Cancel" : "取消" }
    var dismiss: String { isEnglish ? "Dismiss" : "知道了" }
    var announcementsTitle: String { isEnglish ? "Announcements" : "公告" }
    var open: String { isEnglish ? "Open" : "打开" }
    var privacyTitle: String { isEnglish ? "Privacy" : "隐私" }
    var privacyBody: String {
        isEnglish
            ? "Optional anonymous usage telemetry is off until you choose. Reading content, account identifiers and card details are never included."
            : "在你作出选择前，可选的匿名使用统计保持关闭。统计不会包含占卜内容、账户标识或卡牌详情。"
    }
    var privacyEnable: String { isEnglish ? "Enable anonymous telemetry" : "启用匿名统计" }
    var privacyDisable: String { isEnglish ? "Keep telemetry off" : "保持关闭统计" }
    var updatesTitle: String { isEnglish ? "Updates" : "更新" }
    var updateNotConfigured: String { isEnglish ? "Update service is not configured for this build." : "此构建未配置更新服务。" }
    var updateCurrent: String { isEnglish ? "This build is up to date." : "当前已是最新版本。" }
    var updateFailed: String { isEnglish ? "The update check could not be completed." : "无法完成更新检查。" }
    var updateAvailableTitle: String { isEnglish ? "Update Available" : "有可用更新" }
    func updateAvailable(version: String, build: Int) -> String {
        isEnglish
            ? "Version \(version) (\(build)) is available. Download it, then use your trusted signing workflow to install it."
            : "版本 \(version)（\(build)）可用。下载后，请使用你信任的签名流程安装。"
    }
    var download: String { isEnglish ? "Download" : "下载" }
    var downloading: String { isEnglish ? "Downloading update" : "正在下载更新" }
    var syntheticMarker: String { isEnglish ? "\nSynthetic protected assets are used only in this public test build." : "\n此公开测试构建仅使用合成的受保护资源。" }
    func aboutBody(version: String, build: String) -> String {
        isEnglish
            ? "Version \(version) (\(build))\nOriginal public iOS software is provided under MPL-2.0. Protected content is separate and is not included in this public build. Distribution remains pending separate approval."
            : "版本 \(version)（\(build)）\n原创公开 iOS 软件采用 MPL-2.0。受保护内容范围独立，未包含在此公开构建中。分发仍需另行批准。"
    }
}
