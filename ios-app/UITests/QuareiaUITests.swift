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
        let languageToggle = waitForElement(labels: ["切换至简体中文"], in: app)
        tapWhenVisible(languageToggle, in: webView, scrolling: .towardUpperPage)
        XCTAssertTrue(app.staticTexts["牌组"].waitForExistence(timeout: 5))

        let switchToEnglish = waitForElement(labels: ["Switch to English"], in: app)
        tapWhenVisible(switchToEnglish, in: webView, scrolling: .towardUpperPage)
        XCTAssertTrue(app.staticTexts["Deck"].waitForExistence(timeout: 5))
        XCTAssertTrue(waitForElement(identifier: "host.menu", labels: ["App menu"], in: app).exists)
        let parchment = element(label: "Parchment Dawn", in: app)
        tapWhenVisible(parchment, in: webView, scrolling: .towardLowerPage)
        XCTAssertTrue(parchment.isSelected || parchment.value as? String == "1")
        closeWebMenu(in: app)
    }

    func testThreeDecksDrawRevealAndHistoryThroughRealControls() {
        let (app, webView) = launchRealApp()
        ensureEnglish(in: app, webView: webView)
        chooseOption("Preset spread", controlLabel: "Layout", in: app, webView: webView)

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
        XCTAssertTrue(waitForSafeContentLayout(in: app, webView: webView, landscape: true))
        XCTAssertTrue(webView.exists)
        XCTAssertTrue(waitForElement(identifier: "host.menu", labels: ["App menu"], in: app).isHittable)
        XCTAssertGreaterThanOrEqual(webView.frame.minY, app.navigationBars.firstMatch.frame.maxY - 1)

        device.orientation = .portrait
        XCTAssertTrue(waitForStableOrientation(.portrait, device: device))
        XCTAssertTrue(waitForSafeContentLayout(in: app, webView: webView, landscape: false))
        XCTAssertTrue(app.staticTexts["Deck"].exists)
        XCTAssertGreaterThanOrEqual(webView.frame.minY, app.navigationBars.firstMatch.frame.maxY - 1)
    }

    func testNativeFilesImportCanBeCancelled() {
        let (app, webView) = launchRealApp()
        ensureEnglish(in: app, webView: webView)

        openNativeMenuAction(identifier: "host.import", label: "Import backup", in: app)

        let restore = waitForElement(labels: ["Restore"], in: app, timeout: 8)
        restore.tap()
        let cancel = waitForHittableControl(labels: ["Cancel", "取消", "Close", "关闭"], in: app, timeout: 60)
        cancel.tap()
        XCTAssertTrue(app.staticTexts["Backup restore cancelled"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(webView.waitForExistence(timeout: 5))
    }

    @MainActor
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
        enterSyntheticText("UI Test QSP", into: spreadName, in: studio, app: app)

        let positionNames = app.textFields.matching(NSPredicate(format: "label == 'Position name'"))
        XCTAssertTrue(positionNames.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(positionNames.count, 3, "Expected the default custom spread to contain three positions")
        for index in 0..<3 {
            enterSyntheticText(
                "UI position \(index + 1)",
                into: positionNames.element(boundBy: index),
                in: studio,
                app: app
            )
        }

        let generate = waitForElement(labels: ["Generate share code"], in: app)
        tapWhenVisible(generate, in: studio, scrolling: .towardLowerPage)
        let shareCode = waitForTextView(label: "Custom spread share code", in: app)
        let code = try XCTUnwrap(shareCode.value as? String)
        XCTAssertTrue(code.hasPrefix("QSP1.") || code.hasPrefix("QSP2."), "Expected a versioned QSP share code")

        let importTab = waitForElement(labels: ["Import code"], in: app)
        tapWhenVisible(importTab, in: studio, scrolling: .towardUpperPage)
        let importCode = waitForTextView(label: "Paste a share code", in: app)
        enterSyntheticText(code, into: importCode, in: studio, app: app)
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
        let pileCard = waitForElement(labelPrefix: "Face-down pile card ", in: app)
        tapWhenVisible(pileCard, in: webView, scrolling: .towardLowerPage)
        XCTAssertTrue(app.staticTexts["1 placed"].waitForExistence(timeout: 5))

        // Exercise actual accessible zoom controls. Native WebView pinch can
        // target page zoom; two-finger board acceptance remains a device gate.
        assertBoardZoom(100, in: app)
        let zoomIn = waitForElement(labels: ["Zoom in on the Free Board"], in: app)
        tapWhenVisible(zoomIn, in: webView, scrolling: .towardUpperPage)
        assertBoardZoom(125, in: app)
        let zoomOut = waitForElement(labels: ["Zoom out on the Free Board"], in: app)
        zoomOut.tap()
        assertBoardZoom(100, in: app)

        // WebKit flattens the role=application parent. Use the actual placed
        // card's public action suffix without reading its card identity.
        let placedCard = app.descendants(matching: .any).matching(NSPredicate(
            format: "label ENDSWITH 'Drag to move; tap to select.'"
        )).firstMatch
        XCTAssertTrue(placedCard.waitForExistence(timeout: 5))
        makeVisible(placedCard, in: webView, scrolling: .towardUpperPage)
        let originalCardPoint = placedCard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        originalCardPoint.tap()
        let rotate = waitForElement(labels: [
            "Rotate the selected card clockwise by 15 degrees"
        ], in: app)
        tapWhenVisible(rotate, in: webView, scrolling: .towardLowerPage)
        let undo = waitForElement(labels: ["Undo the last Free Board action"], in: app)
        XCTAssertTrue(undo.isEnabled)
        undo.tap()
        let redo = waitForElement(labels: ["Redo the last Free Board action"], in: app)
        XCTAssertTrue(redo.isEnabled)
        redo.tap()

        makeVisible(placedCard, in: webView, scrolling: .towardUpperPage)
        let beforeDrag = placedCard.frame
        let dragStart = placedCard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let movedCardPoint = dragStart.withOffset(CGVector(dx: 42, dy: 54))
        dragStart.press(forDuration: 0.2, thenDragTo: movedCardPoint)
        XCTAssertGreaterThan(abs(placedCard.frame.midX - beforeDrag.midX), 15)
        let committedDragX = placedCard.frame.midX
        XCTAssertTrue(undo.isEnabled)
        tapWhenVisible(undo, in: webView, scrolling: .towardUpperPage)
        XCTAssertEqual(placedCard.frame.midX, beforeDrag.midX, accuracy: 3, "Undo must restore the committed drag")
        redo.tap()
        XCTAssertEqual(placedCard.frame.midX, committedDragX, accuracy: 3, "Redo must restore the committed drag")
        tapWhenVisible(zoomIn, in: webView, scrolling: .towardUpperPage)
        assertBoardZoom(125, in: app)
        makeVisible(placedCard, in: webView, scrolling: .towardLowerPage)
        let beforePan = placedCard.frame
        let panStart = placedCard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .withOffset(CGVector(dx: placedCard.frame.width * 0.75, dy: 0))
        let panEnd = panStart.withOffset(CGVector(dx: -30, dy: 40))
        panStart.press(forDuration: 0.2, thenDragTo: panEnd)
        XCTAssertGreaterThan(abs(placedCard.frame.midY - beforePan.midY), 10)
        let resetView = waitForElement(labels: ["Reset Free Board pan and zoom"], in: app)
        tapWhenVisible(resetView, in: webView, scrolling: .towardUpperPage)
        assertBoardZoom(100, in: app)

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

    func testLoopbackAnnouncementRevisionAndPrivacyToggle() throws {
        _ = try postFixture("/__fixture/seed", json: ["version_code": 1])

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

        _ = try postFixture("/__fixture/revise", json: ["id": 1])
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

    func testLoopbackUpdateDownloadCancelAndHandoff() throws {
        _ = try postFixture("/__fixture/update-mode", json: ["mode": "blocked"])
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

        _ = try postFixture("/__fixture/update-mode", json: ["mode": "normal"])
        openNativeMenuAction(identifier: "host.update", label: "Check for updates", in: app)
        waitForElement(identifier: "host.update.download", labels: ["Download"], in: app).tap()
        let syntheticFile = app.descendants(matching: .any).matching(NSPredicate(
            format: "label BEGINSWITH 'Quareia-1.0.1-2-'"
        )).firstMatch
        XCTAssertTrue(syntheticFile.waitForExistence(timeout: 30), "Expected the downloaded synthetic file in the system share sheet")
        let close = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Close' OR label == '关闭' OR label == 'Cancel' OR label == '取消'")).allElementsBoundByIndex.first { $0.isHittable }
        if let close {
            close.tap()
        } else if UIDevice.current.userInterfaceIdiom == .pad {
            // The native menu is outside the centered iPad activity popover.
            app.buttons["host.menu"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        } else {
            // The file caption itself starts a file drag. Use the sheet's
            // top grabber region above that caption for modal dismissal.
            let sheet = app.descendants(matching: .any).matching(identifier: "host.update.handoff").firstMatch
            let grabberY = sheet.exists && sheet.frame.minY > app.frame.minY + 40
                ? sheet.frame.minY + 12 : syntheticFile.frame.minY - 24
            let grabber = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: app.frame.width / 2, dy: max(12, grabberY - app.frame.minY)))
            grabber.press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98)))
        }
        XCTAssertTrue(waitForDisappearance(syntheticFile, timeout: 10))
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
        webView: XCUIElement,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let trigger = waitForElement(
            labelPrefix: controlLabel + ", currently ",
            in: app,
            file: file,
            line: line
        )
        let exitsFreeBoard = controlLabel == "Layout" && option == "Preset spread" && trigger.label.contains("Free Board")
        tapWhenVisible(
            trigger,
            in: webView,
            scrolling: .towardUpperPage,
            file: file,
            line: line
        )
        let choice = waitForElement(labels: [option], in: app, file: file, line: line)
        XCTAssertTrue(
            choice.isHittable,
            "Expected the requested public option to be visible",
            file: file,
            line: line
        )
        choice.tap()
        if exitsFreeBoard {
            waitForElement(labels: ["Continue & Clear"], in: app, file: file, line: line).tap()
            XCTAssertTrue(waitForElement(labelPrefix: "Layout, currently Preset spread", in: app, file: file, line: line).exists)
        }
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

    @MainActor
    private func enterSyntheticText(
        _ text: String,
        into element: XCUIElement,
        in webView: XCUIElement,
        app: XCUIApplication? = nil,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        makeVisible(element, in: webView, scrolling: .towardLowerPage, file: file, line: line)
        XCTAssertTrue(
            element.isHittable,
            "Expected the synthetic-data field to be visible",
            file: file,
            line: line
        )
        // Avoid XCTest's implicit ancestor scrolling moving this field under
        // the studio header after the explicit visibility check.
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        if text.count > 80, let app {
            // This simulator clipboard contains only this test's synthetic QSP.
            UIPasteboard.general.string = text
            defer { UIPasteboard.general.items = [] }
            element.press(forDuration: 1.1)
            let paste = waitForElement(labels: ["Paste", "粘贴"], in: app)
            paste.tap()
            let allowPaste = app.buttons.matching(NSPredicate(
                format: "label == 'Allow Paste' OR label == '允许粘贴'"
            )).firstMatch
            if allowPaste.waitForExistence(timeout: 1), allowPaste.isHittable { allowPaste.tap() }
            let inserted = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", text), object: element)
            XCTAssertEqual(XCTWaiter.wait(for: [inserted], timeout: 5), .completed,
                "The real Paste action must insert the complete synthetic code")
        } else {
            element.typeText(text)
        }
        if let app, app.keyboards.firstMatch.exists {
            let dismiss = waitForHittableControl(labels: ["Done", "完成", "Hide keyboard", "隐藏键盘"], in: app)
            dismiss.tap()
            XCTAssertTrue(waitForDisappearance(app.keyboards.firstMatch))
        }
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

    private func postFixture(
        _ path: String,
        json: [String: Any],
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> Data {
        let url = try XCTUnwrap(URL(string: "http://127.0.0.1:8787" + path))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: json)
        request.timeoutInterval = 20
        let result = FixtureResponseBox()
        let completion = DispatchSemaphore(value: 0)
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            result.store(data: data, response: response, error: error)
            completion.signal()
        }
        task.resume()
        guard completion.wait(timeout: .now() + 20) == .success else {
            task.cancel()
            XCTFail("Timed out waiting for the isolated iOS loopback fixture", file: file, line: line)
            return Data()
        }
        let snapshot = result.snapshot()
        if let error = snapshot.error { throw error }
        let http = try XCTUnwrap(snapshot.response as? HTTPURLResponse, file: file, line: line)
        XCTAssertEqual(
            http.statusCode,
            200,
            "Expected the isolated iOS loopback fixture",
            file: file,
            line: line
        )
        return snapshot.data ?? Data()
    }

    private static func restoreUpdateFixtureNormal() {
        guard let url = URL(string: "http://127.0.0.1:8787/__fixture/update-mode") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(#"{"mode":"normal"}"#.utf8)
        request.timeoutInterval = 20
        let completion = DispatchSemaphore(value: 0)
        let task = URLSession.shared.dataTask(with: request) { _, _, _ in completion.signal() }
        task.resume()
        if completion.wait(timeout: .now() + 20) == .timedOut { task.cancel() }
    }

    private func waitForHittableControl(
        labels: [String],
        in app: XCUIApplication,
        timeout: TimeInterval = 5,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> XCUIElement {
        let query = app.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", labels))
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if let visible = query.allElementsBoundByIndex.first(where: { $0.isHittable }) { return visible }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline
        let knownState = ["Cancel", "Close", "Done", "Browse", "Recents", "Restore"].map { label in
            let control = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
            return "\(label)=\(control.exists)/\(control.isHittable)"
        }.joined(separator: "; ")
        XCTFail("Expected a hittable control with a known public label: \(labels); " +
            "app=\(app.state.rawValue); \(knownState); " +
            "restoreFailed=\(app.staticTexts["Backup restore failed"].exists); " +
            "restoreCancelled=\(app.staticTexts["Backup restore cancelled"].exists)", file: file, line: line)
        return query.firstMatch
    }

    private func assertBoardZoom(_ percent: Int, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let label = "Board zoom: \(percent)%"
        let result = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
        if result.waitForExistence(timeout: 5) { return }
        // Only fixed zoom labels/values: no hierarchy or reading/card content.
        let statuses = app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier == 'freeBoardZoomStatus' OR label BEGINSWITH 'Board zoom:'"
        )).allElementsBoundByIndex.prefix(4).map { element -> String in
            let value = element.value as? String ?? ""
            let safeValue = value.range(of: "^(Board zoom: )?[0-9]{1,3}%$", options: .regularExpression) == nil ? "<not a zoom value>" : value
            let safeLabel = element.label.range(of: "^Board zoom: [0-9]{1,3}%$", options: .regularExpression) == nil ? "<not a zoom label>" : element.label
            return "label=\(safeLabel),value=\(safeValue),frame=\(element.frame)"
        }
        let zoomIn = app.buttons["Zoom in on the Free Board"]
        XCTFail("Expected \(label); status=\(statuses); zoomInExists=\(zoomIn.exists); enabled=\(zoomIn.exists && zoomIn.isEnabled); frame=\(zoomIn.exists ? zoomIn.frame : .zero)", file: file, line: line)
    }

    private func waitForElement(
        identifier: String? = nil,
        labels: [String] = [],
        labelPrefix: String? = nil,
        in app: XCUIApplication,
        timeout: TimeInterval = 5,
        file: StaticString = #filePath,
        line: UInt = #line
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
        let requested = [
            "identifier=\(identifier ?? "<none>")",
            "labels=\(labels)",
            "labelPrefix=\(labelPrefix ?? "<none>")"
        ].joined(separator: "; ")
        XCTFail("Expected a public UI control; \(requested)", file: file, line: line)
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
        scrolling direction: ScrollDirection,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        makeVisible(element, in: scrollable, scrolling: direction, file: file, line: line)
        if element.isHittable { element.tap() }
    }

    private func makeVisible(
        _ element: XCUIElement,
        in scrollable: XCUIElement,
        scrolling direction: ScrollDirection,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        for _ in 0..<8 {
            var next = direction
            if element.exists {
                let target = element.frame
                let viewport = scrollable.frame.insetBy(dx: 8, dy: 8)
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
        let targetFrame = element.exists ? String(describing: element.frame) : "<absent>"
        let scrollFrame = scrollable.exists ? String(describing: scrollable.frame) : "<absent>"
        XCTFail(
            "Expected a known public control to become hittable; " +
                "target.exists=\(element.exists); target.hittable=\(element.isHittable); " +
                "target.frame=\(targetFrame); scrollable.exists=\(scrollable.exists); " +
                "scrollable.hittable=\(scrollable.isHittable); scrollable.frame=\(scrollFrame)",
            file: file,
            line: line
        )
    }

    private func scroll(_ element: XCUIElement, toward direction: ScrollDirection) {
        let gutterX = element.elementType == .webView ? 0.99 : 0.98
        let upper = element.coordinate(withNormalizedOffset: CGVector(dx: gutterX, dy: 0.34))
        let lower = element.coordinate(withNormalizedOffset: CGVector(dx: gutterX, dy: 0.70))
        switch direction {
        case .towardUpperPage: upper.press(forDuration: 0.08, thenDragTo: lower)
        case .towardLowerPage: lower.press(forDuration: 0.08, thenDragTo: upper)
        }
    }

    private func openWebMenu(in app: XCUIApplication, webView: XCUIElement) {
        let close = waitForKnownElementIfPresent(labels: ["Close menu", "关闭菜单"], in: app)
        if close.exists && close.isHittable { return }
        let open = waitForElement(labels: ["Open menu", "打开菜单"], in: app)
        tapWhenVisible(open, in: webView, scrolling: .towardUpperPage)
    }

    private func waitForKnownElementIfPresent(
        labels: [String],
        in app: XCUIApplication
    ) -> XCUIElement {
        let all = app.descendants(matching: .any)
        for label in labels {
            let element = all.matching(NSPredicate(format: "label == %@", label)).firstMatch
            if element.exists { return element }
        }
        return all.matching(NSPredicate(format: "label == %@", labels.first ?? "<missing>")).firstMatch
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

    private func waitForSafeContentLayout(
        in app: XCUIApplication,
        webView: XCUIElement,
        landscape: Bool
    ) -> Bool {
        let deadline = Date().addingTimeInterval(8)
        while Date() < deadline {
            let frame = webView.frame
            let bar = app.navigationBars.firstMatch.frame
            if !frame.isEmpty && !bar.isEmpty &&
                (frame.width > frame.height) == landscape && frame.minY >= bar.maxY - 1 {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        return false
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

private final class FixtureResponseBox: @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?
    private var response: URLResponse?
    private var error: Error?

    func store(data: Data?, response: URLResponse?, error: Error?) {
        lock.lock()
        defer { lock.unlock() }
        self.data = data
        self.response = response
        self.error = error
    }

    func snapshot() -> (data: Data?, response: URLResponse?, error: Error?) {
        lock.lock()
        defer { lock.unlock() }
        return (data, response, error)
    }
}
