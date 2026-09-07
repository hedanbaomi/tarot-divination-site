import XCTest

final class QuareiaUITests: XCTestCase {
    private var activeApp: XCUIApplication?
    private var observedFailure = false

    override func setUpWithError() throws {
        continueAfterFailure = false
        observedFailure = false
    }

    override func record(_ issue: XCTIssue) {
        observedFailure = true
        super.record(issue)
    }

    override func tearDownWithError() throws {
        defer { activeApp = nil }
        guard observedFailure, let activeApp else { return }
        var hierarchy = activeApp.debugDescription
        let patterns = [
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
            "/_m/[A-Za-z0-9-]+"
        ]
        for pattern in patterns {
            guard let expression = try? NSRegularExpression(pattern: pattern) else { continue }
            let range = NSRange(hierarchy.startIndex..., in: hierarchy)
            hierarchy = expression.stringByReplacingMatches(
                in: hierarchy,
                range: range,
                withTemplate: "<redacted-runtime-id>"
            )
        }
        print("P0 PUBLIC_UI_HIERARCHY_BEGIN")
        print(String(hierarchy.prefix(12_000)))
        print("P0 PUBLIC_UI_HIERARCHY_END")
    }

    func testPublicProbePersistsStorageAndRejectsIframeBridge() throws {
        let app = XCUIApplication()
        activeApp = app
        app.launchArguments = ["-probe"]
        app.launch()

        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(app.webViews["QuareiaWebView"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["host-ready"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["image-ready"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["iframe-rejected"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["method-rejected:UNSUPPORTED_METHOD"].waitForExistence(timeout: 10))

        let firstStorage = storageLabel(in: app)
        let firstCounts = try parseStorageLabel(firstStorage)
        XCTAssertEqual(firstCounts.localStorage, firstCounts.indexedDB)

        app.terminate()
        app.launch()

        XCTAssertTrue(app.staticTexts["host-ready"].waitForExistence(timeout: 10))
        let secondStorage = storageLabel(in: app, excluding: firstStorage)
        let secondCounts = try parseStorageLabel(secondStorage)
        XCTAssertEqual(secondCounts.localStorage, firstCounts.localStorage + 1)
        XCTAssertEqual(secondCounts.indexedDB, secondCounts.localStorage)
        emitPublicProbeScreenshot(from: app)
    }

    func testRegularMainPageLoadsGeneratedBundle() {
        let app = XCUIApplication()
        activeApp = app
        app.launch()
        let webView = app.webViews["QuareiaWebView"]
        XCTAssertTrue(webView.waitForExistence(timeout: 10))
        let loaded = expectation(for: NSPredicate(format: "value == 'main-ready'"), evaluatedWith: webView)
        wait(for: [loaded], timeout: 10)
        let heading = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'Quareia'")).firstMatch
        XCTAssertTrue(heading.waitForExistence(timeout: 10), "Expected the generated main-page DOM heading")
        XCTAssertEqual(app.state, .runningForeground)
    }

    private func storageLabel(in app: XCUIApplication, excluding previous: String? = nil) -> String {
        let predicate: NSPredicate
        if let previous {
            predicate = NSPredicate(format: "label BEGINSWITH 'storage-ready:' AND label != %@", previous)
        } else {
            predicate = NSPredicate(format: "label BEGINSWITH 'storage-ready:'")
        }
        let element = app.staticTexts.matching(predicate).firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 10))
        return element.label
    }

    private func parseStorageLabel(_ label: String) throws -> (localStorage: Int, indexedDB: Int) {
        let parts = label.split(separator: ":")
        guard parts.count == 3, let local = Int(parts[1]), let database = Int(parts[2]) else {
            throw ProbeEvidenceError.malformedStorageLabel(label)
        }
        return (local, database)
    }

    private func emitPublicProbeScreenshot(from app: XCUIApplication) {
        let encoded = app.screenshot().pngRepresentation.base64EncodedString()
        print("PUBLIC_PROBE_SCREENSHOT_BASE64_BEGIN")
        var index = encoded.startIndex
        while index < encoded.endIndex {
            let next = encoded.index(index, offsetBy: 120, limitedBy: encoded.endIndex) ?? encoded.endIndex
            print(encoded[index..<next])
            index = next
        }
        print("PUBLIC_PROBE_SCREENSHOT_BASE64_END")
    }
}

private enum ProbeEvidenceError: Error {
    case malformedStorageLabel(String)
}
