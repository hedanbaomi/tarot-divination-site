import XCTest
import WebKit
@testable import Quareia

final class AppRouteTests: XCTestCase {
    private let token = "public-test-token"
    private let png = Data(base64Encoded:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )!

    func testPublicAllowlistServesExactPathAndAllowsCacheBuster() {
        let store = StubPublicStore(entries: [
            "index.html": RouteResponse(statusCode: 200, mimeType: "text/html", data: Data("ok".utf8), headers: [:])
        ])
        let route = AppRoute(token: token, publicResources: store, imageProvider: nil)

        let response = route.response(for: request("quareia-app://app/index.html?v=1"))

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.data, Data("ok".utf8))
        XCTAssertEqual(store.requestedPaths, ["index.html"])
    }

    func testRootMapsOnlyToManifestIndex() {
        let store = StubPublicStore(entries: [
            "index.html": RouteResponse(statusCode: 200, mimeType: "text/html", data: Data("home".utf8), headers: [:])
        ])
        let route = AppRoute(token: token, publicResources: store, imageProvider: nil)

        XCTAssertEqual(route.response(for: request("quareia-app://app/")).data, Data("home".utf8))
        XCTAssertEqual(route.response(for: request("quareia-app://app/missing.js")).statusCode, 404)
    }

    func testWrongOriginCredentialsPortAndMethodsFailClosed() {
        let route = makeRoute()
        let rejectedURLs = [
            "https://app/index.html",
            "quareia-app://other/index.html",
            "quareia-app://app:444/index.html",
            "quareia-app://user@app/index.html"
        ]
        rejectedURLs.forEach {
            XCTAssertEqual(route.response(for: request($0)).statusCode, 404, "origin case: \($0)")
        }
        ["POST", "HEAD"].forEach {
            XCTAssertEqual(
                route.response(for: request("quareia-app://app/index.html", method: $0)).statusCode,
                404,
                "URLRequest method case: \($0)"
            )
        }
        let url = URL(string: "quareia-app://app/index.html")!
        XCTAssertEqual(route.response(for: url, method: "get").statusCode, 404, "raw method case: get")
    }

    func testURLRequestCanonicalizesLowercaseGETBeforeRouteBoundary() {
        let route = makeRoute()
        let canonicalized = request("quareia-app://app/index.html", method: "get")
        XCTAssertEqual(canonicalized.httpMethod, "GET")
        XCTAssertEqual(route.response(for: canonicalized).statusCode, 200)
    }

    func testEncodedAndLiteralTraversalFailBeforePublicStore() {
        let store = StubPublicStore(entries: [:])
        let route = AppRoute(token: token, publicResources: store, imageProvider: nil)
        [
            "quareia-app://app/%2e%2e/secret",
            "quareia-app://app/../secret",
            "quareia-app://app/css//styles.css",
            "quareia-app://app/css/%73tyles.css"
        ].forEach { XCTAssertEqual(route.response(for: request($0)).statusCode, 404, $0) }
        XCTAssertTrue(store.requestedPaths.isEmpty)
    }

    func testProtectedBackFirstAndLastKeysReturnPNG() {
        let route = makeRoute(provider: StubImageProvider(result: .success(png)))
        ["lxxxi-back", "lxxxi-01", "lxxxi-81"].forEach { key in
            let response = route.response(for: request("\(route.protectedBaseURL)/\(key)"))
            XCTAssertEqual(response.statusCode, 200)
            XCTAssertEqual(response.mimeType, "image/png")
            XCTAssertEqual(response.headers["Cache-Control"], "no-store")
            XCTAssertEqual(response.data, png)
        }
    }

    func testProtectedRouteRejectsWrongTokenKeysSuffixesQueryAndFragment() {
        let provider = StubImageProvider(result: .success(png))
        let route = makeRoute(provider: provider)
        let rejected = [
            "quareia-app://app/_m/wrong/lxxxi-01",
            "\(route.protectedBaseURL)/lxxxi-00",
            "\(route.protectedBaseURL)/lxxxi-82",
            "\(route.protectedBaseURL)/lxxxi-1",
            "\(route.protectedBaseURL)/lxxxi-01/extra",
            "\(route.protectedBaseURL)/lxxxi-01?cache=1",
            "\(route.protectedBaseURL)/lxxxi-01#fragment"
        ]
        rejected.forEach { XCTAssertEqual(route.response(for: request($0)).statusCode, 404, $0) }
        XCTAssertTrue(provider.requestedKeys.isEmpty)
    }

    func testAbsentThrowingAndInvalidProvidersFailClosed() {
        XCTAssertEqual(makeRoute(provider: nil).response(for: request(protectedURL())).statusCode, 404)
        XCTAssertEqual(
            makeRoute(provider: StubImageProvider(result: .failure(TestError.failed)))
                .response(for: request(protectedURL())).statusCode,
            404
        )
        XCTAssertEqual(
            makeRoute(provider: StubImageProvider(result: .success(Data("not-png".utf8))))
                .response(for: request(protectedURL())).statusCode,
            404
        )
        var oversized = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        oversized.append(Data(repeating: 0, count: AppRoute.maximumImageBytes))
        XCTAssertEqual(
            makeRoute(provider: StubImageProvider(result: .success(oversized)))
                .response(for: request(protectedURL())).statusCode,
            404
        )
    }

    func testManifestPathValidationRejectsNonCanonicalPaths() {
        ["", "/index.html", "dir/", "dir//x", "../x", "dir/../x", "dir\\x", "x%2fy"].forEach {
            XCTAssertFalse(BundledPublicResourceStore.isSafeManifestPath($0), $0)
        }
        XCTAssertTrue(BundledPublicResourceStore.isSafeManifestPath("css/styles.css"))
    }

    func testPNGSignatureAloneAndTruncatedImageCannotSatisfyDecodeGate() {
        XCTAssertFalse(AppRoute.isValidPNG(Data(png.prefix(8))))
        XCTAssertFalse(AppRoute.isValidPNG(Data(png.prefix(24))))
        XCTAssertTrue(AppRoute.isValidPNG(png))
    }

    func testStoppedSchemeTaskReceivesNoCallbacks() {
        let suspendedQueue = DispatchQueue(label: "AppRouteTests.suspended")
        suspendedQueue.suspend()
        let handler = AppSchemeHandler(route: makeRoute(), queue: suspendedQueue)
        let task = FakeSchemeTask(request: request("quareia-app://app/index.html"))
        let webView = WKWebView(frame: .zero)

        handler.webView(webView, start: task)
        handler.webView(webView, stop: task)
        suspendedQueue.resume()

        let noCallback = expectation(description: "stopped task has no callback")
        noCallback.isInverted = true
        task.onCallback = { noCallback.fulfill() }
        wait(for: [noCallback], timeout: 0.25)
        XCTAssertEqual(task.callbackCount, 0)
    }

    private func makeRoute(provider: LxxxiImageProviding? = nil) -> AppRoute {
        AppRoute(
            token: token,
            publicResources: StubPublicStore(entries: [
                "index.html": RouteResponse(statusCode: 200, mimeType: "text/html", data: Data(), headers: [:])
            ]),
            imageProvider: provider
        )
    }

    private func request(_ string: String, method: String = "GET") -> URLRequest {
        var request = URLRequest(url: URL(string: string)!)
        request.httpMethod = method
        return request
    }

    private func protectedURL() -> String {
        "quareia-app://app/_m/\(token)/lxxxi-01"
    }
}

private enum TestError: Error { case failed }

private final class StubPublicStore: PublicResourceLoading {
    let entries: [String: RouteResponse]
    private(set) var requestedPaths: [String] = []

    init(entries: [String: RouteResponse]) { self.entries = entries }
    func response(for path: String) -> RouteResponse? {
        requestedPaths.append(path)
        return entries[path]
    }
}

private final class StubImageProvider: LxxxiImageProviding {
    let result: Result<Data?, Error>
    private(set) var requestedKeys: [String] = []

    init(result: Result<Data?, Error>) { self.result = result }
    func imageData(for logicalKey: String) throws -> Data? {
        requestedKeys.append(logicalKey)
        return try result.get()
    }
}

private final class FakeSchemeTask: NSObject, WKURLSchemeTask {
    let request: URLRequest
    var onCallback: (() -> Void)?
    private(set) var callbackCount = 0

    init(request: URLRequest) { self.request = request }
    func didReceive(_ response: URLResponse) { callback() }
    func didReceive(_ data: Data) { callback() }
    func didFinish() { callback() }
    func didFailWithError(_ error: Error) { callback() }
    private func callback() {
        callbackCount += 1
        onCallback?()
    }
}
