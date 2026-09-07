import UIKit
import WebKit
#if PUBLIC_TESTING
import CoreFoundation

@MainActor
private final class BoardDiagnosticMessageHandler: NSObject, WKScriptMessageHandler {
    static let name = "boardDiagnostics"

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.name == Self.name, message.frameInfo.isMainFrame,
              origin.protocol == AppRoute.scheme, origin.host == AppRoute.host, origin.port == 0,
              let url = message.frameInfo.request.url, url.path == "/index.html",
              BridgeContext.isTrustedDocumentURL(url),
              let body = message.body as? [String: Any] else { return }
        let countKeys: Set<String> = ["down", "move", "up", "cancel", "lost", "dragStart", "dragEnd", "undoClick", "redoClick", "zoomClick", "errors", "active", "visual", "cards", "rendered"]
        var coordinateKeys: Set<String> = ["x", "y", "zoom", "panX", "panY", "domX", "domY", "domWidth", "domHeight", "lastPointerX", "lastPointerY"]
        var toggleKeys: Set<String> = ["undo", "redo", "capture"]
        if body["mutation"] as? String == "snapshot" {
            coordinateKeys.formUnion(["undoDomX", "undoDomY", "undoDomWidth", "undoDomHeight", "redoDomX", "redoDomY", "redoDomWidth", "redoDomHeight"])
            toggleKeys.formUnion(["undoDisabled", "redoDisabled"])
        }
        let enums: [String: Set<String>] = [
            "pointerType": ["none", "touch", "mouse", "pen"],
            "errorKind": ["none", "TypeError", "ReferenceError", "RangeError", "Error", "SyntaxError", "other"],
            "surface": ["viewport", "undo", "redo", "zoom", "other"],
            "mutation": ["none", "snapshot", "move", "undo", "redo", "button-zoom", "viewport", "wheel-zoom", "draw", "reset-view", "other"],
            "gesture": ["none", "card", "pan", "pinch"]
        ]
        let numericKeys = countKeys.union(coordinateKeys).union(toggleKeys)
        guard Set(body.keys) == numericKeys.union(enums.keys) else { return }
        var safe: [String: Any] = [:]
        for key in numericKeys {
            guard let number = body[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return }
            let value = number.doubleValue
            guard value.isFinite else { return }
            if countKeys.contains(key) {
                guard value >= 0, value <= 9999, value.rounded() == value else { return }
            } else if toggleKeys.contains(key) {
                guard value == 0 || value == 1 else { return }
            } else {
                guard abs(value) <= 1000000 else { return }
            }
            safe[key] = value
        }
        for (key, allowed) in enums {
            guard let value = body[key] as? String, allowed.contains(value) else { return }
            safe[key] = value
        }
        guard let data = try? JSONSerialization.data(withJSONObject: safe, options: [.sortedKeys]),
              data.count <= 4096, let text = String(data: data, encoding: .utf8) else { return }
        NSLog("IOS_BOARD_DIAGNOSTIC %@", text)
    }
}
#endif

struct NavigationRequestContext {
    let url: URL?
    let method: String?
    let hasTargetFrame: Bool
    let targetIsMainFrame: Bool
    let sourceIsMainFrame: Bool
    let isLinkActivated: Bool

    init(
        url: URL?,
        method: String?,
        hasTargetFrame: Bool,
        targetIsMainFrame: Bool = true,
        sourceIsMainFrame: Bool,
        isLinkActivated: Bool
    ) {
        self.url = url
        self.method = method
        self.hasTargetFrame = hasTargetFrame
        self.targetIsMainFrame = targetIsMainFrame
        self.sourceIsMainFrame = sourceIsMainFrame
        self.isLinkActivated = isLinkActivated
    }
}

enum AppNavigationDecision: Equatable {
    case allowLocal
    case openExternal(URL)
    case cancel
}

enum AppNavigationPolicy {
    static func decide(_ context: NavigationRequestContext) -> AppNavigationDecision {
        guard let url = context.url else { return .cancel }
        let isLocal = url.scheme == AppRoute.scheme
            && url.host == AppRoute.host
            && url.port == nil
            && url.user == nil
            && url.password == nil
            && context.method == "GET"
        if isLocal {
            guard context.hasTargetFrame else { return .cancel }
            if !context.targetIsMainFrame { return .allowLocal }
            return BridgeContext.isTrustedDocumentURL(url) ? .allowLocal : .cancel
        }

        let isUserActivatedSafeHTTPS = context.isLinkActivated
            && context.sourceIsMainFrame
            && url.scheme?.lowercased() == "https"
            && url.host?.isEmpty == false
            && (url.port == nil || url.port == 443)
            && url.user == nil
            && url.password == nil
        return isUserActivatedSafeHTTPS ? .openExternal(url) : .cancel
    }
}

@MainActor
final class WebAppViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private var bridge: NativeBridgeHandler!
    private var schemeHandler: AppSchemeHandler!
    private var nativeHost: NativeHost!
    private var presentationCoordinator: HostPresentationCoordinator!
    private var pendingLocalNavigationURL: URL?
    private let services: HostServiceFacading
    private let isProbe: Bool
    #if PUBLIC_TESTING
    private let boardEventDiagnostics: Bool
    private let boardOnDemandDiagnostics: Bool
    #endif
    private var selectedTheme = "celestial"
    private var selectedLocale = "zh-CN"
    private var keyboardVisible = false
    private var isShutdown = false

    init(
        services: HostServiceFacading = NativeHostServiceFactory.make(),
        arguments: [String] = ProcessInfo.processInfo.arguments
    ) {
        self.services = services
        #if PUBLIC_TESTING
        isProbe = arguments.contains("-probe")
        boardEventDiagnostics = arguments.contains("-board-event-diagnostics")
        boardOnDemandDiagnostics = arguments.contains("-board-on-demand-diagnostics")
        #else
        isProbe = false
        #endif
        super.init(nibName: nil, bundle: nil)
        edgesForExtendedLayout = []
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    override func loadView() {
        let token = UUID().uuidString.lowercased() + UUID().uuidString.lowercased()
        let route = AppRoute(
            token: token,
            publicResources: BundledPublicResourceStore(),
            imageProvider: LxxxiImageProviderFactory.make()
        )
        schemeHandler = AppSchemeHandler(route: route)

        let userContentController = WKUserContentController()
        userContentController.addUserScript(WKUserScript(
            source: Self.bridgeBootstrap,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        #if PUBLIC_TESTING
        if boardEventDiagnostics || boardOnDemandDiagnostics {
            let diagnosticBootstrap = boardOnDemandDiagnostics
                ? "window.__quareiaBoardOnDemandDiagnostics = true;"
                : "window.__quareiaBoardDiagnostics = true; window.__quareiaBoardDiagnosticsNative = true;"
            userContentController.addUserScript(WKUserScript(
                source: diagnosticBootstrap,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            ))
            userContentController.add(BoardDiagnosticMessageHandler(), name: BoardDiagnosticMessageHandler.name)
        }
        #endif
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController = userContentController
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: AppRoute.scheme)

        webView = WKWebView(frame: .zero, configuration: configuration)
        presentationCoordinator = HostPresentationCoordinator(viewController: self)
        nativeHost = NativeHost(
            services: services,
            files: HostFileTransferStore(),
            presenter: presentationCoordinator,
            protectedBaseURL: route.protectedBaseURL,
            applyTheme: { [weak self] theme in self?.applyTheme(theme) },
            applyLocale: { [weak self] locale in self?.applyLocale(locale) }
        )
        bridge = NativeBridgeHandler(webView: webView, operation: { [weak nativeHost] request in
            guard let nativeHost else { throw NativeHostError.unavailable }
            return try await nativeHost.handle(request)
        })
        userContentController.add(bridge, name: NativeBridgeHandler.name)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        webView.accessibilityIdentifier = "QuareiaWebView"
        let container = UIView()
        webView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: container.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: container.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.safeAreaLayoutGuide.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: container.safeAreaLayoutGuide.bottomAnchor)
        ])
        view = container
        configureMenu(locale: "zh-CN")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Quareia"
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillShow),
            name: UIResponder.keyboardWillShowNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillHide),
            name: UIResponder.keyboardWillHideNotification, object: nil)
        loadLocalEntry()
        Task { [weak self] in
            guard let self else { return }
            let info = await services.hostInfo()
            applyTheme(info.theme)
            applyLocale(info.locale)
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        HostThemePalette.value(selectedTheme).statusBarStyle
    }

    func applicationDidBecomeActive() {
        loadViewIfNeeded()
        nativeHost.applicationDidBecomeActive(presentPrivacyIfNeeded: !isProbe)
    }

    func applicationWillResignActive() {
        nativeHost?.applicationWillResignActive()
    }

    func shutdown() {
        guard !isShutdown else { return }
        isShutdown = true
        nativeHost?.stop()
        bridge?.stop()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: NativeBridgeHandler.name)
        #if PUBLIC_TESTING
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: BoardDiagnosticMessageHandler.name)
        #endif
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        bridge.beginNavigation(to: webView.url ?? pendingLocalNavigationURL)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let path = URLComponents(url: webView.url ?? URL(fileURLWithPath: "/"), resolvingAgainstBaseURL: false)?.percentEncodedPath
        webView.accessibilityValue = path == "/index.html" ? "main-ready" : "probe-ready"
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        bridge.invalidateNavigation()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        bridge.invalidateNavigation()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        bridge.invalidateNavigation()
        loadLocalEntry()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        let context = NavigationRequestContext(
            url: navigationAction.request.url,
            method: navigationAction.request.httpMethod,
            hasTargetFrame: navigationAction.targetFrame != nil,
            targetIsMainFrame: navigationAction.targetFrame?.isMainFrame ?? false,
            sourceIsMainFrame: navigationAction.sourceFrame.isMainFrame,
            isLinkActivated: navigationAction.navigationType == .linkActivated
        )
        switch AppNavigationPolicy.decide(context) {
        case .allowLocal:
            guard let url = context.url else { decisionHandler(.cancel); return }
            if context.targetIsMainFrame { pendingLocalNavigationURL = url }
            decisionHandler(.allow)
        case let .openExternal(url):
            decisionHandler(.cancel)
            presentationCoordinator.openExternalHTTPS(url)
        case .cancel:
            decisionHandler(.cancel)
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? { nil }

    deinit {
        NotificationCenter.default.removeObserver(self)
        let host = nativeHost
        let bridgeHandler = bridge
        Task { @MainActor in
            host?.stop()
            bridgeHandler?.stop()
        }
    }

    private func loadLocalEntry() {
        let path = isProbe ? "/probe/index.html" : "/index.html"
        guard let url = URL(string: "\(AppRoute.scheme)://\(AppRoute.host)\(path)") else {
            assertionFailure("The fixed application URL must be valid")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        pendingLocalNavigationURL = url
        bridge.beginNavigation(to: url)
        webView.load(request)
    }

    @objc private func keyboardWillShow(_ notification: Notification) {
        guard viewIfLoaded?.window != nil, !isShutdown else { return }
        keyboardVisible = true
        configureKeyboardDismiss()
    }

    @objc private func keyboardWillHide(_ notification: Notification) {
        keyboardVisible = false
        configureKeyboardDismiss()
    }

    private func configureKeyboardDismiss() {
        guard keyboardVisible else {
            navigationItem.leftBarButtonItem = nil
            return
        }
        let button = UIBarButtonItem(title: HostMenuStrings(locale: selectedLocale).doneEditing,
            style: .done, target: self, action: #selector(finishEditing))
        button.accessibilityIdentifier = "host.keyboard.dismiss"
        navigationItem.leftBarButtonItem = button
    }

    @objc private func finishEditing() {
        // End the editing session, including the focused WebKit field. Merely
        // hiding the system keyboard can leave focus and caret activity alive.
        webView.endEditing(true)
    }

    private func configureMenu(locale: String) {
        let strings = HostMenuStrings(locale: locale)
        let button = UIButton(type: .system)
        button.setImage(UIImage(systemName: "ellipsis.circle"), for: .normal)
        button.accessibilityIdentifier = "host.menu"
        button.accessibilityLabel = strings.menu
        button.showsMenuAsPrimaryAction = true
        var actions: [UIMenuElement] = [
            menuAction(strings.about, identifier: "host.about") { [weak self] in _ = try? await self?.nativeHost.presentAbout() },
            menuAction(strings.privacy, identifier: "host.privacy") { [weak self] in _ = try? await self?.nativeHost.presentPrivacy() },
            menuAction(strings.announcements, identifier: "host.announcements") { [weak self] in _ = try? await self?.nativeHost.presentAnnouncements(manual: true) },
            menuAction(strings.update, identifier: "host.update") { [weak self] in _ = try? await self?.nativeHost.presentUpdateCheck() },
            menuAction(strings.backup, identifier: "host.backup") { [weak self] in await self?.notifyWebMenu("backup") },
            menuAction(strings.export, identifier: "host.export") { [weak self] in await self?.notifyWebMenu("export") },
            menuAction(strings.importFile, identifier: "host.import") { [weak self] in await self?.notifyWebMenu("import") }
        ]
        #if PUBLIC_TESTING
        if boardOnDemandDiagnostics {
            actions.append(menuAction("Capture board diagnostic", identifier: "host.boardDiagnostic") { [weak self] in
                await self?.captureBoardDiagnostic()
            })
        }
        #endif
        button.menu = UIMenu(children: actions)
        navigationItem.rightBarButtonItem = UIBarButtonItem(customView: button)
    }

    private func menuAction(
        _ title: String,
        identifier: String,
        operation: @escaping @MainActor () async -> Void
    ) -> UIAction {
        UIAction(title: title, identifier: UIAction.Identifier(identifier)) { _ in
            Task { @MainActor in await operation() }
        }
    }

    #if PUBLIC_TESTING
    private func captureBoardDiagnostic() async {
        guard boardOnDemandDiagnostics, let url = webView.url, url.path == "/index.html",
              BridgeContext.isTrustedDocumentURL(url) else { return }
        _ = try? await webView.evaluateJavaScript(
            "if (typeof window.__quareiaCaptureBoardDiagnostic === 'function') { window.webkit.messageHandlers.boardDiagnostics.postMessage(window.__quareiaCaptureBoardDiagnostic()); }"
        )
    }
    #endif

    private func notifyWebMenu(_ action: String) async {
        guard ["backup", "export", "import"].contains(action),
              BridgeContext.isTrustedDocumentURL(webView.url ?? URL(fileURLWithPath: "/")) else { return }
        _ = try? await webView.callAsyncJavaScript(
            "window.dispatchEvent(new CustomEvent('quareia-native-menu', { detail: { action } })); return true;",
            arguments: ["action": action],
            in: nil,
            contentWorld: .page
        )
    }

    private func applyTheme(_ theme: String) {
        selectedTheme = theme
        let palette = HostThemePalette.value(theme)
        view.backgroundColor = palette.background
        webView?.backgroundColor = palette.background
        navigationController?.navigationBar.tintColor = palette.tint
        navigationController?.navigationBar.standardAppearance = palette.navigationAppearance
        navigationController?.navigationBar.scrollEdgeAppearance = palette.navigationAppearance
        setNeedsStatusBarAppearanceUpdate()
    }

    private func applyLocale(_ locale: String) {
        selectedLocale = locale
        configureMenu(locale: locale)
        configureKeyboardDismiss()
    }

    private static let bridgeBootstrap = """
    (() => {
      'use strict';
      const pending = new Map();
      const validID = /^[A-Za-z0-9_-]{1,64}$/;
      const longMethods = new Set(['presentAbout', 'presentPrivacy', 'presentAnnouncements', 'checkForUpdates', 'fileExportFinish', 'fileImport']);
      const timeoutFor = method => longMethods.has(method) ? 300000 : 10000;
      const api = {
        request(envelope) {
          return new Promise((resolve, reject) => {
            if (!envelope || typeof envelope !== 'object' || !validID.test(envelope.id || '')) {
              reject(new Error('INVALID_ENVELOPE')); return;
            }
            if (pending.has(envelope.id)) { reject(new Error('DUPLICATE_ID')); return; }
            if (pending.size >= 16) { reject(new Error('TOO_MANY_IN_FLIGHT')); return; }
            const timer = setTimeout(() => {
              const entry = pending.get(envelope.id);
              if (!entry) return;
              pending.delete(envelope.id);
              entry.reject(new Error('TIMEOUT'));
            }, timeoutFor(envelope.method));
            pending.set(envelope.id, { resolve, reject, timer });
            window.webkit.messageHandlers.quareia.postMessage(envelope);
          });
        },
        _receive(id, reply) {
          window.dispatchEvent(new CustomEvent('quareia-native-reply', { detail: { id } }));
          const entry = pending.get(id);
          if (!entry) return;
          pending.delete(id); clearTimeout(entry.timer);
          if (reply && reply.ok === true) entry.resolve(reply.result);
          else entry.reject(new Error(reply?.error?.code || 'NATIVE_ERROR'));
        }
      };
      window.addEventListener('pagehide', () => {
        for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('NAVIGATION_CANCELLED')); }
        pending.clear();
      });
      Object.defineProperty(window, 'QuareiaNative', {
        value: Object.freeze(api), writable: false, configurable: false
      });
    })();
    """
}

private struct HostMenuStrings {
    private let english: Bool
    init(locale: String) { english = locale == "en" }
    var doneEditing: String { english ? "Done editing" : "完成编辑" }
    var menu: String { english ? "App menu" : "应用菜单" }
    var about: String { english ? "About" : "关于" }
    var privacy: String { english ? "Privacy" : "隐私" }
    var announcements: String { english ? "Announcements" : "公告" }
    var update: String { english ? "Check for updates" : "检查更新" }
    var backup: String { english ? "Backup" : "备份" }
    var export: String { english ? "Export history" : "导出历史" }
    var importFile: String { english ? "Import backup" : "导入备份" }
}

private struct HostThemePalette {
    let background: UIColor
    let tint: UIColor
    let statusBarStyle: UIStatusBarStyle
    let navigationAppearance: UINavigationBarAppearance

    static func value(_ theme: String) -> HostThemePalette {
        let background: UIColor
        let tint: UIColor
        let light: Bool
        switch theme {
        case "parchment":
            background = UIColor(red: 0xef / 255, green: 0xe4 / 255, blue: 0xcc / 255, alpha: 1)
            tint = UIColor(red: 0x7a / 255, green: 0x5a / 255, blue: 0x28 / 255, alpha: 1)
            light = true
        case "ember":
            background = UIColor(red: 0x14 / 255, green: 0x0a / 255, blue: 0x08 / 255, alpha: 1)
            tint = UIColor(red: 0xe0 / 255, green: 0x8a / 255, blue: 0x48 / 255, alpha: 1)
            light = false
        case "grove":
            background = UIColor(red: 0x07 / 255, green: 0x14 / 255, blue: 0x0f / 255, alpha: 1)
            tint = UIColor(red: 0xc6 / 255, green: 0xb0 / 255, blue: 0x6a / 255, alpha: 1)
            light = false
        default:
            background = UIColor(red: 0x06 / 255, green: 0x09 / 255, blue: 0x19 / 255, alpha: 1)
            tint = UIColor(red: 0xd8 / 255, green: 0xb3 / 255, blue: 0x6a / 255, alpha: 1)
            light = false
        }
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = background
        appearance.titleTextAttributes = [.foregroundColor: light ? UIColor.label : UIColor.white]
        return HostThemePalette(
            background: background,
            tint: tint,
            statusBarStyle: light ? .darkContent : .lightContent,
            navigationAppearance: appearance
        )
    }
}
