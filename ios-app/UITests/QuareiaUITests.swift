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
        let parchment = element(label: "Parchment Dawn", in: app)
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
            let history = element(label: "Reading History", in: app)
            tapWhenVisible(history, in: webView, scrolling: .towardUpperPage)
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

        openNativeMenuAction(identifier: "host.import", label: "Import backup", in: app)

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

    func testCustomSpreadQSPRoundTripUsesTheRealStudio() throws {
        let (app, webView) = launchRealApp()
        ensureEnglish(in: app, webView: webView)

        let openStudio = waitForElement(labels: ["Design or import a spread"], in: app)
        tapWhenVisible(openStudio, in: webView, scrolling: .towardUpperPage)
        XCTAssertTrue(app.staticTexts["Custom Spread Studio"].waitForExistence(timeout: 5))
        let studio = element(label: "Custom Spread Studio, web dialog", in: app)
        XCTAssertTrue(studio.waitForExistence(timeout: 5))

        let newDesign = waitForElement(labels: ["New design"], in: app)
        newDesign.tap()
        let spreadName = waitForTextField(label: "Spread name", in: app)
        enterSyntheticText("UI Test QSP", into: spreadName, in: studio)

        let positionNames = app.textFields.matching(NSPredicate(format: "label == 'Position name'"))
        XCTAssertTrue(positionNames.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(positionNames.count, 3, "Expected the default custom spread to contain three positions")
        for index in 0..<3 {
            enterSyntheticText("UI position \(index + 1)", into: positionNames.element(boundBy: index), in: studio)
        }

        let generate = waitForElement(labels: ["Generate share code"], in: app)
        tapWhenVisible(generate, in: studio, scrolling: .towardLowerPage)
        XCTAssertTrue(app.staticTexts[
            "Share code generated. Copy it or save it as a text file."
        ].waitForExistence(timeout: 5))
        let shareCode = waitForTextView(label: "Custom spread share code", in: app)
        let code = try XCTUnwrap(shareCode.value as? String)
        XCTAssertTrue(code.hasPrefix("QSP1.") || code.hasPrefix("QSP2."), "Expected a versioned QSP share code")

        let importTab = waitForElement(labels: ["Import code"], in: app)
        tapWhenVisible(importTab, in: studio, scrolling: .towardUpperPage)
        let importCode = waitForTextView(label: "Paste a share code", in: app)
        enterSyntheticText(code, into: importCode, in: studio)
        let importAndUse = waitForElement(labels: ["Import and use"], in: app)
        tapWhenVisible(importAndUse, in: studio, scrolling: .towardLowerPage)

        XCTAssertTrue(waitForElement(
            labelPrefix: "Spread, currently UI Test QSP",
            in: app,
            timeout: 8
        ).exists)
    }

    func testFreeBoardGesturesHistoryAndDraftRestore() {
        let (app, webView) = launchRealApp()
        ensureEnglish(in: app, webView: webView)
        chooseOption("Free Board", controlLabel: "Layout", in: app, webView: webView)

        discardFreeBoardDraft(in: app, webView: webView)
        let viewport = element(
            label: "Free Board. Drag the board or cards; pinch or wheel to zoom.",
            in: app
        )
        makeVisible(viewport, in: webView, scrolling: .towardLowerPage)
        XCTAssertTrue(viewport.exists)
        XCTAssertGreaterThan(viewport.frame.width, 250)
        XCTAssertGreaterThan(viewport.frame.height, 250)
        let pileCard = waitForElement(labelPrefix: "Face-down pile card ", in: app)
        tapWhenVisible(pileCard, in: webView, scrolling: .towardLowerPage)
        XCTAssertTrue(app.staticTexts["1 placed"].waitForExistence(timeout: 5))

        let originalCardPoint = viewport.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .withOffset(CGVector(dx: -92, dy: -71))
        originalCardPoint.tap()
        let rotate = waitForElement(labels: [
            "Rotate the selected card clockwise by 15 degrees"
        ], in: app)
        rotate.tap()
        let undo = waitForElement(labels: ["Undo the last Free Board action"], in: app)
        XCTAssertTrue(undo.isEnabled)
        undo.tap()
        let redo = waitForElement(labels: ["Redo the last Free Board action"], in: app)
        XCTAssertTrue(redo.isEnabled)
        redo.tap()

        let movedCardPoint = originalCardPoint.withOffset(CGVector(dx: 42, dy: 54))
        originalCardPoint.press(forDuration: 0.2, thenDragTo: movedCardPoint)
        XCTAssertTrue(undo.isEnabled)
        viewport.pinch(withScale: 1.35, velocity: 1)
        let panStart = viewport.coordinate(withNormalizedOffset: CGVector(dx: 0.82, dy: 0.80))
        let panEnd = viewport.coordinate(withNormalizedOffset: CGVector(dx: 0.66, dy: 0.68))
        panStart.press(forDuration: 0.2, thenDragTo: panEnd)
        let resetView = waitForElement(labels: ["Reset Free Board pan and zoom"], in: app)
        resetView.tap()

        RunLoop.current.run(until: Date().addingTimeInterval(2))
        app.terminate()
        let (relaunchedApp, relaunchedWebView) = launchRealApp()
        ensureEnglish(in: relaunchedApp, webView: relaunchedWebView)
        chooseOption("Free Board", controlLabel: "Layout", in: relaunchedApp, webView: relaunchedWebView)
        XCTAssertTrue(relaunchedApp.staticTexts["1 placed"].waitForExistence(timeout: 8))

        let revealAll = waitForElement(labels: ["Reveal every card on the Free Board"], in: relaunchedApp)
        tapWhenVisible(revealAll, in: relaunchedWebView, scrolling: .towardLowerPage)
        XCTAssertTrue(relaunchedApp.staticTexts[
            "Free Board saved to divination history automatically."
        ].waitForExistence(timeout: 8))
        discardFreeBoardDraft(in: relaunchedApp, webView: relaunchedWebView)
        XCTAssertTrue(relaunchedApp.staticTexts[
            "The Free Board draft was discarded."
        ].waitForExistence(timeout: 5))
    }

    @MainActor
    func testLoopbackAnnouncementRevisionAndPrivacyToggle() async throws {
        _ = try await postFixture("/__fixture/seed", json: ["version_code": 1])

        let (app, webView) = launchRealApp(arguments: ["-enable-loopback-service-fixture"])
        XCTAssertTrue(waitForElement(labels: [
            "[fixture] iOS announcement v1",
            "[fixture] iOS 公告 v1"
        ], in: app, timeout: 10).exists)
        let firstDismiss = waitForElement(
            identifier: "announcement.dismiss",
            labels: ["Dismiss", "知道了"],
            in: app
        )
        firstDismiss.tap()
        XCTAssertTrue(waitForDisappearance(firstDismiss))
        ensureEnglish(in: app, webView: webView)

        _ = try await postFixture("/__fixture/revise", json: ["id": 1])
        openNativeMenuAction(
            identifier: "host.announcements",
            label: "Announcements",
            in: app
        )
        XCTAssertTrue(app.staticTexts[
            "[fixture] iOS announcement v2"
        ].waitForExistence(timeout: 10))
        let secondDismiss = waitForElement(
            identifier: "announcement.dismiss",
            labels: ["Dismiss"],
            in: app
        )
        secondDismiss.tap()
        XCTAssertTrue(waitForDisappearance(secondDismiss))

        openNativeMenuAction(identifier: "host.privacy", label: "Privacy", in: app)
        let enable = waitForElement(identifier: "privacy.enable", labels: [
            "Enable anonymous telemetry"
        ], in: app)
        enable.tap()
        XCTAssertTrue(waitForDisappearance(enable))
        openNativeMenuAction(identifier: "host.privacy", label: "Privacy", in: app)
        let disable = waitForElement(identifier: "privacy.disable", labels: [
            "Keep telemetry off"
        ], in: app)
        disable.tap()
        XCTAssertEqual(app.state, .runningForeground)
    }

    @MainActor
    func testLoopbackUpdateDownloadCancelAndHandoff() async throws {
        _ = try await postFixture("/__fixture/update-mode", json: ["mode": "blocked"])
        addTeardownBlock { Self.restoreUpdateFixtureNormal() }
        let (app, webView) = launchRealApp(arguments: [
            "-enable-loopback-service-fixture",
            "-enable-loopback-update-fixture"
        ])
        dismissFixtureAnnouncementIfPresent(in: app)
        ensureEnglish(in: app, webView: webView)

        openNativeMenuAction(identifier: "host.update", label: "Check for updates", in: app)
        XCTAssertTrue(app.staticTexts["Update Available"].waitForExistence(timeout: 8))
        let download = waitForElement(identifier: "host.update.download", labels: ["Download"], in: app)
        download.tap()
        let cancel = app.buttons["host.update.cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5), "Expected a cancellable fixture download")
        cancel.tap()
        XCTAssertTrue(waitForDisappearance(cancel))

        _ = try await postFixture("/__fixture/update-mode", json: ["mode": "normal"])
        openNativeMenuAction(identifier: "host.update", label: "Check for updates", in: app)
        waitForElement(identifier: "host.update.download", labels: ["Download"], in: app).tap()
        let handoff = waitForElement(identifier: "host.update.handoff", in: app, timeout: 10)
        XCTAssertTrue(handoff.exists)
        let syntheticFile = app.staticTexts.matching(NSPredicate(
            format: "label BEGINSWITH 'Quareia-1.0.1-2-' AND label ENDSWITH '.ipa'"
        )).firstMatch
        XCTAssertTrue(syntheticFile.waitForExistence(timeout: 5))
        handoff.swipeDown()
        if handoff.exists {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: 0.04)).tap()
        }
        XCTAssertTrue(waitForDisappearance(handoff))
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

    private func waitForTextField(label: String, in app: XCUIApplication) -> XCUIElement {
        let field = app.textFields.matching(NSPredicate(format: "label == %@", label)).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "Expected a labelled synthetic-data field")
        return field
    }

    private func waitForTextView(label: String, in app: XCUIApplication) -> XCUIElement {
        let field = app.textViews.matching(NSPredicate(format: "label == %@", label)).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "Expected a labelled synthetic-data text area")
        return field
    }

    private func enterSyntheticText(_ text: String, into element: XCUIElement, in webView: XCUIElement) {
        makeVisible(element, in: webView, scrolling: .towardLowerPage)
        XCTAssertTrue(element.isHittable, "Expected the synthetic-data field to be visible")
        element.tap()
        element.typeText(text)
    }

    private func discardFreeBoardDraft(in app: XCUIApplication, webView: XCUIElement) {
        let discard = waitForElement(labels: [
            "Clear the Free Board and delete its saved draft"
        ], in: app)
        tapWhenVisible(discard, in: webView, scrolling: .towardLowerPage)
        let confirm = waitForElement(labels: ["Continue & Clear"], in: app)
        confirm.tap()
    }

    private func openNativeMenuAction(
        identifier: String,
        label: String,
        in app: XCUIApplication
    ) {
        waitForElement(identifier: "host.menu", labels: ["App menu"], in: app).tap()
        let localizedLabels: [String: String] = [
            "host.announcements": "公告",
            "host.import": "导入备份",
            "host.privacy": "隐私",
            "host.update": "检查更新"
        ]
        for candidate in [label, localizedLabels[identifier]].compactMap({ $0 }) {
            let action = element(label: candidate, in: app)
            if action.waitForExistence(timeout: 2) {
                action.tap()
                return
            }
        }
        let identified = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        XCTAssertTrue(identified.waitForExistence(timeout: 2), "Expected a native app-menu action")
        if identified.exists { identified.tap() }
    }

    private func dismissFixtureAnnouncementIfPresent(in app: XCUIApplication) {
        let fixtureTitle = app.staticTexts.matching(NSPredicate(
            format: "label BEGINSWITH '[fixture] iOS'"
        )).firstMatch
        guard fixtureTitle.waitForExistence(timeout: 2) else { return }
        let dismiss = waitForElement(
            identifier: "announcement.dismiss",
            labels: ["Dismiss", "知道了"],
            in: app
        )
        dismiss.tap()
        XCTAssertTrue(waitForDisappearance(dismiss))
    }

    private func postFixture(_ path: String, json: [String: Any]) async throws -> Data {
        let url = try XCTUnwrap(URL(string: "http://127.0.0.1:8787" + path))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: json)
        let (data, response) = try await URLSession.shared.data(for: request)
        let http = try XCTUnwrap(response as? HTTPURLResponse)
        XCTAssertEqual(http.statusCode, 200, "Expected the isolated iOS loopback fixture")
        return data
    }

    private static func restoreUpdateFixtureNormal() {
        guard let url = URL(string: "http://127.0.0.1:8787/__fixture/update-mode") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(#"{"mode":"normal"}"#.utf8)
        let completion = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: request) { _, _, _ in completion.signal() }.resume()
        _ = completion.wait(timeout: .now() + 5)
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

    private func element(label: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", label))
            .firstMatch
    }

    private enum ScrollDirection: Equatable { case towardUpperPage, towardLowerPage }

    private func tapWhenVisible(
        _ element: XCUIElement,
        in scrollable: XCUIElement,
        scrolling direction: ScrollDirection
    ) {
        makeVisible(element, in: scrollable, scrolling: direction)
        if element.isHittable { element.tap() }
    }

    private func makeVisible(
        _ element: XCUIElement,
        in scrollable: XCUIElement,
        scrolling direction: ScrollDirection
    ) {
        for _ in 0..<12 {
            var next = direction
            if element.exists {
                let target = element.frame
                let viewport = scrollable.frame.insetBy(dx: 8, dy: 20)
                if !target.isNull && !target.isEmpty && !viewport.isNull && !viewport.isEmpty {
                    let centerIsVisible = viewport.contains(CGPoint(x: target.midX, y: target.midY))
                    let targetFits = target.width <= viewport.width && target.height <= viewport.height
                    let safelyVisible = centerIsVisible && (!targetFits || viewport.contains(target))
                    if element.isHittable && safelyVisible { return }
                    if target.maxY > viewport.maxY - 20 {
                        next = .towardLowerPage
                    } else if target.minY < viewport.minY + 20 {
                        next = .towardUpperPage
                    }
                }
            }
            scroll(scrollable, toward: next)
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

    private func waitForDisappearance(_ element: XCUIElement, timeout: TimeInterval = 5) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: element
        )
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
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
