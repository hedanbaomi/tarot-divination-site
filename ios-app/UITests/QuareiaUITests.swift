import XCTest
import UIKit

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
        let webView = activeApp.webViews["QuareiaWebView"]
        let hostMenuExists = activeApp.buttons["host.menu"].exists
        let privacyModalExists = activeApp.otherElements["host.privacy"].exists
        let announcementModalExists = activeApp.otherElements["host.announcements"].exists
        let finiteState = [
            "application=\(activeApp.state.rawValue)",
            "webView.exists=\(webView.exists)",
            "webView.hittable=\(webView.isHittable)",
            "hostMenu.exists=\(hostMenuExists)",
            "privacyModal.exists=\(privacyModalExists)",
            "announcementModal.exists=\(announcementModalExists)"
        ].joined(separator: "\n")
        XCTContext.runActivity(named: "Finite public UI state") { activity in
            activity.add(XCTAttachment(string: finiteState))
        }
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

    func testRealMainPageLocaleAndTheme() {
        let (app, webView) = launchRealApp()
        ensureEnglish(in: app, webView: webView)

        openWebMenu(in: app, webView: webView)
        let parchment = waitForElement(labels: ["Parchment Dawn"], in: app)
        tapWhenVisible(parchment, in: webView, scrolling: .towardLowerPage)
        XCTAssertTrue(parchment.isSelected || parchment.value as? String == "1")

        let languageToggle = waitForElement(labels: ["Switch to Simplified Chinese"], in: app)
        tapWhenVisible(languageToggle, in: webView, scrolling: .towardUpperPage)
        XCTAssertTrue(app.staticTexts["牌组"].waitForExistence(timeout: 5))

        let switchToEnglish = waitForElement(labels: ["切换至英文"], in: app)
        tapWhenVisible(switchToEnglish, in: webView, scrolling: .towardUpperPage)
        XCTAssertTrue(app.staticTexts["Deck"].waitForExistence(timeout: 5))
        XCTAssertTrue(waitForElement(identifier: "host.menu", labels: ["App menu"], in: app).exists)
        closeWebMenu(in: app)
    }

    func testThreeDecksDrawRevealAndHistoryThroughRealControls() {
        let (app, webView) = launchRealApp()
        ensureEnglish(in: app, webView: webView)

        let decks = [
            "Tarot (Rider-Waite system)",
            "Mystagogus",
            "LXXXI - The Magician's Deck"
        ]
        for deck in decks {
            chooseOption(deck, controlLabel: "Deck", in: app, webView: webView)
            chooseOption(
                "Three Cards (Horizontal) · 3 cards",
                controlLabel: "Spread",
                in: app,
                webView: webView
            )
            drawThreeCards(in: app, webView: webView)

            let reveal = waitForElement(labels: ["Reveal & Interpret"], in: app)
            tapWhenVisible(reveal, in: webView, scrolling: .towardLowerPage)
            XCTAssertTrue(app.staticTexts[
                "Reading revealed and saved automatically on this device."
            ].waitForExistence(timeout: 8))

            openWebMenu(in: app, webView: webView)
            let history = waitForElement(labels: ["Reading History"], in: app)
            history.tap()
            XCTAssertTrue(app.staticTexts["Reading History"].waitForExistence(timeout: 5))
            let records = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'View '"))
            XCTAssertGreaterThanOrEqual(records.count, 1, "Expected a saved reading without inspecting its card content")
            let closeHistory = waitForElement(labels: ["Close reading history"], in: app)
            closeHistory.tap()

            let clear = waitForElement(labels: ["Shuffle Again"], in: app)
            tapWhenVisible(clear, in: webView, scrolling: .towardLowerPage)
            let continueAndClear = waitForElement(labels: ["Continue & Clear"], in: app)
            continueAndClear.tap()
        }
    }

    func testRealMainPageSupportsLargeTextAndOrientationChanges() {
        let device = XCUIDevice.shared
        device.orientation = .portrait
        addTeardownBlock { device.orientation = .portrait }

        let (app, webView) = launchRealApp(arguments: [
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL"
        ])
        ensureEnglish(in: app, webView: webView)
        XCTAssertTrue(app.staticTexts["Deck"].exists)

        device.orientation = .landscapeLeft
        XCTAssertTrue(waitForStableOrientation(.landscapeLeft, device: device))
        XCTAssertTrue(webView.exists)
        XCTAssertTrue(waitForElement(identifier: "host.menu", labels: ["App menu"], in: app).isHittable)

        device.orientation = .portrait
        XCTAssertTrue(waitForStableOrientation(.portrait, device: device))
        XCTAssertTrue(app.staticTexts["Deck"].exists)
    }

    func testNativeFilesImportCanBeCancelled() {
        let (app, webView) = launchRealApp()
        ensureEnglish(in: app, webView: webView)

        let menu = waitForElement(identifier: "host.menu", labels: ["App menu"], in: app)
        menu.tap()
        let importBackup = waitForElement(identifier: "host.import", labels: ["Import backup"], in: app)
        importBackup.tap()

        let restore = waitForElement(labels: ["Restore"], in: app, timeout: 8)
        restore.tap()
        let picker = waitForElement(identifier: "host.import", in: app, timeout: 8)
        XCTAssertTrue(picker.exists)
        let cancel = waitForElement(labels: ["Cancel", "取消"], in: app)
        XCTAssertTrue(cancel.isHittable)
        cancel.tap()
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(webView.waitForExistence(timeout: 5))
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

    private func launchRealApp(arguments: [String] = []) -> (XCUIApplication, XCUIElement) {
        let app = XCUIApplication()
        activeApp = app
        app.launchArguments = arguments
        app.launch()
        let webView = app.webViews["QuareiaWebView"]
        XCTAssertTrue(webView.waitForExistence(timeout: 10))
        let loaded = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == 'main-ready'"),
            object: webView
        )
        XCTAssertEqual(XCTWaiter.wait(for: [loaded], timeout: 10), .completed)
        dismissInitialPrivacyIfNeeded(in: app)
        return (app, webView)
    }

    private func dismissInitialPrivacyIfNeeded(in app: XCUIApplication) {
        let keepOff = app.buttons["privacy.disable"]
        if keepOff.waitForExistence(timeout: 2) { keepOff.tap() }
    }

    private func ensureEnglish(in app: XCUIApplication, webView: XCUIElement) {
        if app.staticTexts["Deck"].exists { return }
        openWebMenu(in: app, webView: webView)
        let toggle = waitForElement(labels: ["Switch to English"], in: app)
        toggle.tap()
        XCTAssertTrue(app.staticTexts["Deck"].waitForExistence(timeout: 5))
        XCTAssertTrue(waitForElement(identifier: "host.menu", labels: ["App menu"], in: app).waitForExistence(timeout: 5))
        closeWebMenu(in: app)
    }

    private func chooseOption(
        _ option: String,
        controlLabel: String,
        in app: XCUIApplication,
        webView: XCUIElement
    ) {
        let trigger = waitForElement(labelPrefix: controlLabel + ", currently ", in: app)
        tapWhenVisible(trigger, in: webView, scrolling: .towardUpperPage)
        let choice = waitForElement(labels: [option], in: app)
        XCTAssertTrue(choice.isHittable, "Expected the requested public option to be visible")
        choice.tap()
    }

    private func drawThreeCards(in app: XCUIApplication, webView: XCUIElement) {
        let drawButtons = app.buttons.matching(NSPredicate(
            format: "label BEGINSWITH 'Card ' AND label CONTAINS 'Tap to draw'"
        ))
        for _ in 0..<3 {
            let card = drawButtons.firstMatch
            XCTAssertTrue(card.waitForExistence(timeout: 5), "Expected a face-down draw control")
            tapWhenVisible(card, in: webView, scrolling: .towardLowerPage)
        }
        let spreadCards = app.buttons.matching(NSPredicate(
            format: "label BEGINSWITH 'Position ' AND label CONTAINS 'Tap to reveal this card'"
        ))
        XCTAssertEqual(spreadCards.count, 3, "Expected the default three-card preset to be complete")
    }

    private func waitForElement(
        identifier: String? = nil,
        labels: [String] = [],
        labelPrefix: String? = nil,
        in app: XCUIApplication,
        timeout: TimeInterval = 5
    ) -> XCUIElement {
        let all = app.descendants(matching: .any)
        if let identifier {
            let identified = all.matching(identifier: identifier).firstMatch
            if identified.waitForExistence(timeout: timeout) { return identified }
        }
        for label in labels {
            let labelled = all.matching(NSPredicate(format: "label == %@", label)).firstMatch
            if labelled.waitForExistence(timeout: timeout) { return labelled }
        }
        if let labelPrefix {
            let labelled = all.matching(NSPredicate(format: "label BEGINSWITH %@", labelPrefix)).firstMatch
            if labelled.waitForExistence(timeout: timeout) { return labelled }
        }
        XCTFail("Expected a public UI control with a known identifier")
        if let identifier { return all.matching(identifier: identifier).firstMatch }
        if let labelPrefix {
            return all.matching(NSPredicate(format: "label BEGINSWITH %@", labelPrefix)).firstMatch
        }
        return all.matching(NSPredicate(format: "label == %@", labels.first ?? "<missing>")).firstMatch
    }

    private enum ScrollDirection: Equatable { case towardUpperPage, towardLowerPage }

    private func tapWhenVisible(
        _ element: XCUIElement,
        in scrollable: XCUIElement,
        scrolling direction: ScrollDirection
    ) {
        for _ in 0..<5 {
            if element.exists && element.isHittable {
                element.tap()
                return
            }
            scroll(scrollable, toward: direction)
        }
        let opposite: ScrollDirection = direction == .towardUpperPage
            ? .towardLowerPage : .towardUpperPage
        for _ in 0..<8 {
            if element.exists && element.isHittable {
                element.tap()
                return
            }
            scroll(scrollable, toward: opposite)
        }
        XCTFail("Expected a known public control to become hittable")
    }

    private func scroll(_ element: XCUIElement, toward direction: ScrollDirection) {
        switch direction {
        case .towardUpperPage: element.swipeDown()
        case .towardLowerPage: element.swipeUp()
        }
    }

    private func openWebMenu(in app: XCUIApplication, webView: XCUIElement) {
        let open = waitForElement(labels: ["Open menu", "打开菜单"], in: app)
        tapWhenVisible(open, in: webView, scrolling: .towardUpperPage)
    }

    private func closeWebMenu(in app: XCUIApplication) {
        let close = waitForElement(labels: ["Close menu", "关闭菜单"], in: app)
        if close.isHittable { close.tap() }
    }

    private func waitForStableOrientation(
        _ orientation: UIDeviceOrientation,
        device: XCUIDevice,
        timeout: TimeInterval = 5
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while device.orientation != orientation && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        return device.orientation == orientation
    }
}

private enum ProbeEvidenceError: Error {
    case malformedStorageLabel(String)
}
