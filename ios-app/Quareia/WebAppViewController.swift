import UIKit
import WebKit

final class WebAppViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private var bridge: NativeBridgeHandler!
    private var schemeHandler: AppSchemeHandler!
    private var pendingLocalNavigationURL: URL?

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

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController = userContentController
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: AppRoute.scheme)

        webView = WKWebView(frame: .zero, configuration: configuration)
        bridge = NativeBridgeHandler(webView: webView, protectedBaseURL: route.protectedBaseURL)
        userContentController.add(bridge, name: NativeBridgeHandler.name)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.accessibilityIdentifier = "QuareiaWebView"
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let path = ProcessInfo.processInfo.arguments.contains("-probe") ? "/probe/index.html" : "/index.html"
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
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard navigationAction.targetFrame != nil, let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        let isLocal = url.scheme == AppRoute.scheme
            && url.host == AppRoute.host
            && url.port == nil
            && url.user == nil
            && url.password == nil
            && navigationAction.request.httpMethod == "GET"
        if isLocal {
            pendingLocalNavigationURL = url
            decisionHandler(.allow)
            return
        }

        let isUserActivatedSafeHTTPS = navigationAction.navigationType == .linkActivated
            && navigationAction.sourceFrame.isMainFrame
            && url.scheme == "https"
            && url.host?.isEmpty == false
            && (url.port == nil || url.port == 443)
            && url.user == nil
            && url.password == nil
        decisionHandler(.cancel)
        if isUserActivatedSafeHTTPS {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        nil
    }

    deinit {
        bridge?.stop()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: NativeBridgeHandler.name)
    }

    private static let bridgeBootstrap = """
    (() => {
      'use strict';
      const pending = new Map();
      const validID = /^[A-Za-z0-9_-]{1,64}$/;
      const api = {
        request(envelope) {
          return new Promise((resolve, reject) => {
            if (!envelope || typeof envelope !== 'object' || !validID.test(envelope.id || '')) {
              reject(new Error('INVALID_ENVELOPE'));
              return;
            }
            if (pending.has(envelope.id)) {
              reject(new Error('DUPLICATE_ID'));
              return;
            }
            pending.set(envelope.id, { resolve, reject });
            window.webkit.messageHandlers.quareia.postMessage(envelope);
            setTimeout(() => {
              const entry = pending.get(envelope.id);
              if (!entry) return;
              pending.delete(envelope.id);
              entry.reject(new Error('NATIVE_TIMEOUT'));
            }, 5000);
          });
        },
        _receive(id, reply) {
          const entry = pending.get(id);
          if (!entry) return;
          pending.delete(id);
          if (reply && reply.ok === true) entry.resolve(reply.result);
          else entry.reject(new Error(reply?.error?.code || 'NATIVE_ERROR'));
        }
      };
      Object.defineProperty(window, 'QuareiaNative', {
        value: Object.freeze(api), writable: false, configurable: false
      });
    })();
    """
}
