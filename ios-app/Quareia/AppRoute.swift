import Foundation
import WebKit

struct RouteResponse: Equatable {
    let statusCode: Int
    let mimeType: String
    let data: Data
    let headers: [String: String]

    static func notFound() -> RouteResponse {
        RouteResponse(
            statusCode: 404,
            mimeType: "text/plain",
            data: Data(),
            headers: ["Cache-Control": "no-store"]
        )
    }
}

protocol PublicResourceLoading {
    func response(for path: String) -> RouteResponse?
}

protocol LxxxiImageProviding {
    func imageData(for logicalKey: String) throws -> Data?
}

final class BundledPublicResourceStore: PublicResourceLoading {
    private let bundle: Bundle
    private let allowedWWWPaths: Set<String>
    private let probePaths: Set<String> = ["probe/index.html", "probe/frame.html"]

    init(bundle: Bundle = .main) {
        self.bundle = bundle
        guard
            let manifestURL = bundle.url(
                forResource: "public-resources",
                withExtension: "json",
                subdirectory: "www"
            ),
            let data = try? Data(contentsOf: manifestURL),
            let paths = try? JSONDecoder().decode([String].self, from: data)
        else {
            allowedWWWPaths = []
            return
        }
        allowedWWWPaths = Set(paths.filter(Self.isSafeManifestPath))
    }

    func response(for path: String) -> RouteResponse? {
        let subdirectory: String
        let relativePath: String
        if probePaths.contains(path) {
            subdirectory = "probe"
            relativePath = String(path.dropFirst("probe/".count))
        } else if allowedWWWPaths.contains(path) {
            subdirectory = "www"
            relativePath = path
        } else {
            return nil
        }

        guard
            Self.isSafeManifestPath(relativePath),
            let baseURL = bundle.resourceURL?.appendingPathComponent(subdirectory, isDirectory: true),
            let resourceURL = Self.descendantURL(relativePath, beneath: baseURL),
            let data = try? Data(contentsOf: resourceURL, options: [.mappedIfSafe])
        else {
            return nil
        }

        return RouteResponse(
            statusCode: 200,
            mimeType: Self.mimeType(for: relativePath),
            data: data,
            headers: [
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff"
            ]
        )
    }

    static func isSafeManifestPath(_ path: String) -> Bool {
        guard !path.isEmpty, !path.hasPrefix("/"), !path.hasSuffix("/") else { return false }
        guard !path.contains("\\"), !path.contains("%"), !path.contains("\0") else { return false }
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { return false }
        return path.utf8.count <= 512
    }

    private static func descendantURL(_ path: String, beneath baseURL: URL) -> URL? {
        let candidate = path.split(separator: "/").reduce(baseURL) {
            $0.appendingPathComponent(String($1), isDirectory: false)
        }.standardizedFileURL
        let base = baseURL.standardizedFileURL.path + "/"
        guard candidate.path.hasPrefix(base) else { return nil }
        return candidate
    }

    private static func mimeType(for path: String) -> String {
        switch URL(fileURLWithPath: path).pathExtension.lowercased() {
        case "html": return "text/html"
        case "css": return "text/css"
        case "js": return "text/javascript"
        case "json": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}

struct AppRoute {
    static let scheme = "quareia-app"
    static let host = "app"
    static let protectedPrefix = "_m"
    static let maximumImageBytes = 4 * 1024 * 1024

    let token: String
    let publicResources: PublicResourceLoading
    let imageProvider: LxxxiImageProviding?

    var protectedBaseURL: String {
        "\(Self.scheme)://\(Self.host)/\(Self.protectedPrefix)/\(token)"
    }

    func response(for request: URLRequest) -> RouteResponse {
        guard request.httpMethod == "GET", let url = request.url, isExactOrigin(url) else {
            return .notFound()
        }
        guard let path = exactPath(url) else { return .notFound() }

        if path == Self.protectedPrefix || path.hasPrefix(Self.protectedPrefix + "/") {
            return protectedResponse(for: url, path: path)
        }

        let publicPath = path.isEmpty ? "index.html" : path
        return publicResources.response(for: publicPath) ?? .notFound()
    }

    func isExactOrigin(_ url: URL) -> Bool {
        guard
            url.scheme == Self.scheme,
            url.host == Self.host,
            url.port == nil,
            url.user == nil,
            url.password == nil
        else { return false }
        return true
    }

    private func exactPath(_ url: URL) -> String? {
        guard let urlComponents = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let encoded = urlComponents.percentEncodedPath
        guard encoded == "/" || encoded.hasPrefix("/") else { return nil }
        guard !encoded.contains("%"), !encoded.contains("\\"), !encoded.contains("//") else { return nil }
        let path = String(encoded.dropFirst())
        guard path.utf8.count <= 512 else { return nil }
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard components.allSatisfy({ $0 != "." && $0 != ".." }) else { return nil }
        return path
    }

    private func protectedResponse(for url: URL, path: String) -> RouteResponse {
        guard url.query == nil, url.fragment == nil else { return .notFound() }
        let components = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard components.count == 3 else { return .notFound() }
        guard components[0] == Self.protectedPrefix, components[1] == token else { return .notFound() }
        let logicalKey = components[2]
        guard Self.isAllowedLogicalKey(logicalKey), let imageProvider else { return .notFound() }

        let data: Data?
        do {
            data = try imageProvider.imageData(for: logicalKey)
        } catch {
            return .notFound()
        }
        guard let data, Self.isValidPNG(data) else { return .notFound() }
        return RouteResponse(
            statusCode: 200,
            mimeType: "image/png",
            data: data,
            headers: [
                "Cache-Control": "no-store",
                "Content-Security-Policy": "default-src 'none'",
                "X-Content-Type-Options": "nosniff"
            ]
        )
    }

    static func isAllowedLogicalKey(_ key: String) -> Bool {
        if key == "lxxxi-back" { return true }
        guard key.hasPrefix("lxxxi-"), key.count == 8 else { return false }
        guard let value = Int(key.suffix(2)) else { return false }
        return (1...81).contains(value) && String(format: "%02d", value) == String(key.suffix(2))
    }

    static func isValidPNG(_ data: Data) -> Bool {
        let signature = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        return data.count >= signature.count && data.count <= maximumImageBytes && data.prefix(8) == signature
    }
}

#if PUBLIC_TESTING
struct SyntheticPNGProvider: LxxxiImageProviding {
    private static let png = Data(base64Encoded:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )!

    func imageData(for logicalKey: String) throws -> Data? {
        Self.png
    }
}
#endif

enum LxxxiImageProviderFactory {
    static func make() -> LxxxiImageProviding? {
        #if DISTRIBUTION
        #error("Distribution is blocked: private LXXXI provider integration is not implemented")
        #endif
        #if PUBLIC_TESTING
        return SyntheticPNGProvider()
        #else
        return nil
        #endif
    }
}

final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    private let route: AppRoute
    private let queue: DispatchQueue
    private var activeTasks = Set<ObjectIdentifier>()

    init(route: AppRoute, queue: DispatchQueue = DispatchQueue(label: "fun.luotianyi.quareia.route")) {
        self.route = route
        self.queue = queue
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let identifier = ObjectIdentifier(urlSchemeTask)
        onMain {
            self.activeTasks.insert(identifier)
        }
        queue.async { [weak self, weak urlSchemeTask] in
            guard let self, let urlSchemeTask else { return }
            let routeResponse = self.route.response(for: urlSchemeTask.request)
            DispatchQueue.main.async { [weak self, weak urlSchemeTask] in
                guard let self, let urlSchemeTask, self.isActive(identifier) else { return }
                guard let url = urlSchemeTask.request.url else {
                    self.activeTasks.remove(identifier)
                    return
                }
                let response = HTTPURLResponse(
                    url: url,
                    statusCode: routeResponse.statusCode,
                    httpVersion: "HTTP/1.1",
                    headerFields: routeResponse.headers.merging(["Content-Type": routeResponse.mimeType]) { current, _ in current }
                ) ?? URLResponse(
                    url: url,
                    mimeType: routeResponse.mimeType,
                    expectedContentLength: routeResponse.data.count,
                    textEncodingName: routeResponse.mimeType.hasPrefix("text/") ? "utf-8" : nil
                )
                urlSchemeTask.didReceive(response)
                guard self.isActive(identifier) else { return }
                if !routeResponse.data.isEmpty {
                    urlSchemeTask.didReceive(routeResponse.data)
                    guard self.isActive(identifier) else { return }
                }
                urlSchemeTask.didFinish()
                self.activeTasks.remove(identifier)
            }
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        onMain {
            self.activeTasks.remove(ObjectIdentifier(urlSchemeTask))
        }
    }

    private func isActive(_ identifier: ObjectIdentifier) -> Bool {
        dispatchPrecondition(condition: .onQueue(.main))
        return activeTasks.contains(identifier)
    }

    private func onMain(_ body: @escaping () -> Void) {
        if Thread.isMainThread {
            body()
        } else {
            DispatchQueue.main.sync(execute: body)
        }
    }
}
