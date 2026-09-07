import XCTest
@testable import Quareia

final class NavigationPolicyTests: XCTestCase {
    func testExactLocalGETInExistingFrameIsAllowed() {
        XCTAssertEqual(decision("quareia-app://app/index.html", method: "GET"), .allowLocal)
        XCTAssertEqual(decision(
            "quareia-app://app/probe/frame.html",
            method: "GET",
            targetMain: false,
            sourceMain: false
        ), .allowLocal)
    }

    func testLocalPOSTWrongHostCredentialsPortAndNewWindowAreCancelled() {
        XCTAssertEqual(decision("quareia-app://app/index.html", method: "POST"), .cancel)
        XCTAssertEqual(decision("quareia-app://other/index.html"), .cancel)
        XCTAssertEqual(decision("quareia-app://user@app/index.html"), .cancel)
        XCTAssertEqual(decision("quareia-app://app:444/index.html"), .cancel)
        XCTAssertEqual(decision("quareia-app://app/index.html", hasTarget: false), .cancel)
        XCTAssertEqual(decision("quareia-app://app/js/app.js"), .cancel)
    }

    func testDataFileHTTPAndScriptedHTTPSNavigationAreCancelled() {
        XCTAssertEqual(decision("data:text/html,untrusted", linkActivated: true), .cancel)
        XCTAssertEqual(decision("file:///tmp/untrusted", linkActivated: true), .cancel)
        XCTAssertEqual(decision("http://example.invalid/", linkActivated: true), .cancel)
        XCTAssertEqual(decision("https://example.com/", linkActivated: false), .cancel)
    }

    func testOnlyMainFrameUserActivatedSafeHTTPSOpensExternally() {
        let safeURL = URL(string: "https://example.com/help?q=1")!
        XCTAssertEqual(decision(safeURL.absoluteString, linkActivated: true), .openExternal(safeURL))
        XCTAssertEqual(decision("https://example.com:443/help", linkActivated: true), .openExternal(URL(string: "https://example.com:443/help")!))
        XCTAssertEqual(decision("https://example.com:444/help", linkActivated: true), .cancel)
        XCTAssertEqual(decision("https://user@example.com/help", linkActivated: true), .cancel)
        XCTAssertEqual(decision("https://example.com/help", sourceMain: false, linkActivated: true), .cancel)
        XCTAssertEqual(
            decision("https://example.com/help", hasTarget: false, targetMain: false, linkActivated: true),
            .openExternal(URL(string: "https://example.com/help")!)
        )
    }

    private func decision(
        _ url: String,
        method: String = "GET",
        hasTarget: Bool = true,
        targetMain: Bool = true,
        sourceMain: Bool = true,
        linkActivated: Bool = false
    ) -> AppNavigationDecision {
        AppNavigationPolicy.decide(NavigationRequestContext(
            url: URL(string: url),
            method: method,
            hasTargetFrame: hasTarget,
            targetIsMainFrame: targetMain,
            sourceIsMainFrame: sourceMain,
            isLinkActivated: linkActivated
        ))
    }
}
