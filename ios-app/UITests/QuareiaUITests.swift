import XCTest
import UIKit
import Vision

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
        let cancelFrame = waitForFilesCancel(in: app)
        let visibleCancelPoint = captureFilesNavigation(in: app)
        var cancelPoint = CGPoint(x: cancelFrame.midX, y: cancelFrame.midY)
        var cancelSelection = "ax"
        if let visibleCancelPoint {
            // Remote Files accessibility geometry can point at the neighboring
            // More control. Tap the actual rendered cancellation label or close glyph.
            cancelPoint = visibleCancelPoint.point
            cancelSelection = visibleCancelPoint.kind.rawValue
        } else if UIDevice.current.userInterfaceIdiom == .pad && cancelFrame.width < 2 {
            // The current portrait iPad runtime exposes a 1-point Cancel frame
            // over the grid control. The captured native navigation strip shows
            // its actual close affordance at the upper-left (36, 84).
            cancelPoint = CGPoint(x: app.frame.minX + 36, y: app.frame.minY + 84)
            cancelSelection = "ipad-fallback"
        } else {
            // Reject the known misrouted 44-point More frame. Without rendered
            // evidence, accept only a compact square cancellation glyph frame.
            let aspect = cancelFrame.width / cancelFrame.height
            guard (10...28).contains(cancelFrame.width), (10...28).contains(cancelFrame.height),
                  (0.8...1.25).contains(aspect) else {
                XCTFail("Expected rendered cancellation evidence or a compact cancellation glyph frame")
                return
            }
        }
        print("FILES_CANCEL_TAP point=\(cancelPoint)")
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
            dx: cancelPoint.x - app.frame.minX, dy: cancelPoint.y - app.frame.minY
        )).tap()
        let cancelToastVisible = app.staticTexts["Backup restore cancelled"].waitForExistence(timeout: 5)
        let bounds = app.frame
        emitSafeUIMetadata("UI_FILES_META", [
            "selection": cancelSelection,
            "tapX": Double((cancelPoint.x - bounds.minX) / bounds.width),
            "tapY": Double((cancelPoint.y - bounds.minY) / bounds.height),
            "cancelToastVisible": cancelToastVisible,
            "webViewExists": webView.exists,
            "appForeground": app.state == .runningForeground
        ])
        XCTAssertTrue(cancelToastVisible)
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
        let importTab = waitForElement(labels: ["Import code"], in: app)
        let studioCorridorX = try studioScrollViewport(dialog: studio, firstField: spreadName, tab: importTab).minX
        revealStudioControl(spreadName, in: studio, corridorX: studioCorridorX, tab: importTab, app: app, webView: webView)
        enterSyntheticText("UI Test QSP", into: spreadName, in: studio, app: app)

        let positionNames = app.textFields.matching(NSPredicate(format: "label == 'Position name'"))
        XCTAssertTrue(positionNames.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(positionNames.count, 3, "Expected the default custom spread to contain three positions")
        for index in 0..<3 {
            revealStudioControl(positionNames.element(boundBy: index), in: studio, corridorX: studioCorridorX, tab: importTab, app: app, webView: webView)
            enterSyntheticText(
                "UI position \(index + 1)",
                into: positionNames.element(boundBy: index),
                in: studio,
                app: app
            )
        }

        let generate = waitForElement(labels: ["Generate share code"], in: app)
        revealStudioControl(generate, in: studio, corridorX: studioCorridorX, tab: importTab, app: app, webView: webView)
        tapWhenVisible(generate, in: studio, scrolling: .towardLowerPage)
        let shareCode = waitForTextView(label: "Custom spread share code", in: app)
        let code = try XCTUnwrap(shareCode.value as? String)
        XCTAssertTrue(code.hasPrefix("QSP1.") || code.hasPrefix("QSP2."), "Expected a versioned QSP share code")

        tapWhenVisible(importTab, in: studio, scrolling: .towardUpperPage)
        let importCode = waitForTextView(label: "Paste a share code", in: app)
        let importCorridorX = try studioScrollViewport(dialog: studio, firstField: importCode, tab: importTab).minX
        revealStudioControl(importCode, in: studio, corridorX: importCorridorX, tab: importTab, app: app, webView: webView)
        enterSyntheticText(code, into: importCode, in: studio, app: app)
        let importAndUse = waitForElement(labels: ["Import and use"], in: app)
        revealStudioControl(importAndUse, in: studio, corridorX: importCorridorX, tab: importTab, app: app, webView: webView)
        tapWhenVisible(importAndUse, in: studio, scrolling: .towardLowerPage)

        XCTAssertTrue(waitForElement(
            labelPrefix: "Spread, currently UI Test QSP",
            in: app,
            timeout: 8
        ).exists)
    }

    func testFreeBoardGesturesHistoryAndDraftRestore() throws {
        let (app, webView) = launchRealApp(arguments: ["-board-on-demand-diagnostics"])
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
        let committedPosition = waitForElement(labelPrefix: "Card position: X ", in: app)
        let beforeCommittedX = try XCTUnwrap(Int(String(committedPosition.label
            .dropFirst("Card position: X ".count).prefix(while: { $0 != "," }))))
        let beforeDrag = placedCard.frame
        let dragStart = placedCard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let movedCardPoint = dragStart.withOffset(CGVector(dx: 42, dy: 54))
        dragStart.press(forDuration: 0.2, thenDragTo: movedCardPoint)
        // Geometry can already reflect the uncommitted drag preview. Wait for
        // the public committed-position status before requesting Undo.
        waitForCommittedCardX(beforeCommittedX + 42, in: app)
        let committedDragX = beforeDrag.midX + 42
        waitForPlacedCard(midX: committedDragX, in: app)
        XCTAssertTrue(undo.isEnabled)
        tapBoardControl(undo, action: "undo", in: app, webView: webView)
        waitForCommittedCardX(beforeCommittedX, in: app)
        waitForPlacedCard(midX: beforeDrag.midX, in: app)
        tapBoardControl(redo, action: "redo", in: app, webView: webView)
        waitForCommittedCardX(beforeCommittedX + 42, in: app)
        waitForPlacedCard(midX: committedDragX, in: app)
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
        let fileVisible = syntheticFile.waitForExistence(timeout: 60)
        printSystemPanelGeometry(in: app, phase: "share-ready", fileElement: syntheticFile)
        if !fileVisible {
            // This scenario only opens the explicit synthetic loopback artifact.
            // Capture each owning accessibility tree once, with a finite bound.
            print("PUBLIC_SHARE_APP_AX_BEGIN\n" + String(app.debugDescription.prefix(20_000)) + "\nPUBLIC_SHARE_APP_AX_END")
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            print("PUBLIC_SHARE_SYSTEM_AX_BEGIN\n" + String(springboard.debugDescription.prefix(12_000)) + "\nPUBLIC_SHARE_SYSTEM_AX_END")
        }
        XCTAssertTrue(fileVisible, "Expected the downloaded synthetic file in the system share sheet")
        let close = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Close' OR label == '关闭' OR label == 'Cancel' OR label == '取消'")).allElementsBoundByIndex.first { $0.isHittable }
        if let close {
            close.tap()
        } else if UIDevice.current.userInterfaceIdiom == .pad {
            // The native menu is outside the centered iPad activity popover.
            app.buttons["host.menu"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        } else {
            // Swipe the activity sheet's scroll surface, not the draggable
            // LinkPresentation file caption. No second dismissal attempt.
            let sheet = app.sheets.firstMatch
            if sheet.exists { sheet.swipeDown() }
            else { app.swipeDown() }
        }
        let dismissed = waitForDisappearance(syntheticFile, timeout: 10)
        if !dismissed { printSystemPanelGeometry(in: app, phase: "share-dismiss", fileElement: syntheticFile) }
        XCTAssertTrue(dismissed)
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
        let readiness = XCTWaiter.wait(for: [loaded], timeout: 10)
        let rawReady = webView.value as? String
        let ready: String
        switch rawReady {
        case "main-ready": ready = "main-ready"
        case "loading": ready = "loading"
        case "failed": ready = "failed"
        case nil, "": ready = "missing"
        default: ready = "other"
        }
        let appState: String
        switch app.state {
        case .runningForeground: appState = "foreground"
        case .runningBackground: appState = "background"
        case .runningBackgroundSuspended: appState = "suspended"
        case .notRunning: appState = "not-running"
        default: appState = "unknown"
        }
        emitSafeUIMetadata("UI_READY_META", [
            "appState": appState,
            "webViewExists": webView.exists,
            "ready": ready,
            "completed": readiness == .completed
        ])
        XCTAssertEqual(readiness, .completed)
        dismissInitialPrivacyIfNeeded(in: app)
        return (app, webView)
    }

    private func emitSafeUIMetadata(_ marker: String, _ fields: [String: Any]) {
        // These call sites contain only fixed enums, booleans, and geometry.
        // Do not add accessibility text, URLs, filenames, or image bytes.
        guard JSONSerialization.isValidJSONObject(fields),
              let data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8) else { return }
        print("\(marker)=\(json)")
    }

    private func dismissInitialPrivacyIfNeeded(in app: XCUIApplication) {
        let keepOff = app.buttons["privacy.disable"]
        if keepOff.waitForExistence(timeout: 2) { keepOff.tap() }
    }

    private func ensureEnglish(in app: XCUIApplication, webView: XCUIElement) {
        if app.staticTexts["Deck"].exists { return }
        openWebMenu(in: app, webView: webView)
        // A missing heading during initial accessibility layout does not prove
        // the app is Chinese. Inspect the real language toggle before changing it.
        let toggle = waitForElement(labels: ["Switch to English", "切换至简体中文"], in: app)
        if toggle.label == "Switch to English" { toggle.tap() }
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
            let dismiss = app.buttons["host.keyboard.dismiss"]
            XCTAssertTrue(dismiss.waitForExistence(timeout: 5), "Expected the native editing-completion action")
            XCTAssertTrue(dismiss.isHittable)
            dismiss.tap()
            let keyboard = app.keyboards.firstMatch
            let keyboardDismissed = waitForDisappearance(keyboard)
            if !keyboardDismissed {
                // Fixed geometry/state only; never input text or accessibility trees.
                let keyboardExists = keyboard.exists
                let keyboardFrame = keyboardExists ? keyboard.frame : .zero
                let visibleKeyboard = keyboardFrame.intersection(app.frame)
                let dismissExists = dismiss.exists
                let dismissFrame = dismissExists ? dismiss.frame : .zero
                emitSafeUIMetadata("UI_KEYBOARD_META", [
                    "keyboardExists": keyboardExists,
                    "keyboardHittable": keyboardExists && keyboard.isHittable,
                    "keyboardX": Double(keyboardFrame.minX),
                    "keyboardY": Double(keyboardFrame.minY),
                    "keyboardWidth": Double(keyboardFrame.width),
                    "keyboardHeight": Double(keyboardFrame.height),
                    "visibleKeyboardHeight": visibleKeyboard.isNull ? 0 : Double(visibleKeyboard.height),
                    "dismissExists": dismissExists,
                    "dismissHittable": dismissExists && dismiss.isHittable,
                    "dismissX": Double(dismissFrame.midX),
                    "dismissY": Double(dismissFrame.midY),
                    "appForeground": app.state == .runningForeground
                ])
            }
            XCTAssertTrue(keyboardDismissed)
            XCTAssertTrue(waitForDisappearance(dismiss))
            let retained = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", text), object: element)
            XCTAssertEqual(XCTWaiter.wait(for: [retained], timeout: 5), .completed,
                "Ending editing must preserve the complete synthetic input")
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

    private func captureFilesNavigation(in app: XCUIApplication) -> FilesCancelPoint? {
        // Public simulator evidence only: crop in memory to the Files navigation
        // strip, excluding document contents and the app's card area. Never
        // attach or export the original full-screen image or an xcresult bundle.
        let source = app.screenshot().image
        guard source.size.width > 0, source.size.height > 0 else { return nil }
        let width = min(source.size.width, 800)
        let scale = width / source.size.width
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: width, height: min(160, source.size.height) * scale), format: format
        )
        let strip = renderer.image { _ in
            source.draw(in: CGRect(x: 0, y: 0, width: width, height: source.size.height * scale))
        }
        if let data = strip.jpegData(compressionQuality: 0.65), data.count <= 96_000 {
            let encoded = Array(data.base64EncodedString())
            for offset in stride(from: 0, to: encoded.count, by: 2000) {
                print("FILES_NAV_IMAGE \(offset / 2000) \(String(encoded[offset..<min(offset + 2000, encoded.count)]))")
            }
        }
        // Vision runs locally on the same in-memory navigation crop. Text and
        // document/card contents are never exported as OCR diagnostics.
        guard let image = strip.cgImage else { return nil }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.usesLanguageCorrection = false
        do { try VNImageRequestHandler(cgImage: image, options: [:]).perform([request]) }
        catch { /* The bounded glyph locator remains available if OCR fails. */ }
        let matches = (request.results ?? []).filter { observation in
            guard let candidate = observation.topCandidates(1).first, candidate.confidence >= 0.8 else { return false }
            return ["cancel", "close"].contains(candidate.string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
        }
        let bounds = app.frame
        let cropHeight = min(160, source.size.height)
        let point: CGPoint
        let kind: FilesCancelPoint.Kind
        if matches.count == 1 {
            let box = matches[0].boundingBox
            point = CGPoint(x: bounds.minX + box.midX * bounds.width,
                y: bounds.minY + (1 - box.midY) * cropHeight / source.size.height * bounds.height)
            kind = .ocr
        } else if matches.isEmpty, let glyph = filesCloseGlyph(in: image, rasterScale: scale) {
            point = CGPoint(x: bounds.minX + glyph.x / CGFloat(image.width) * bounds.width,
                y: bounds.minY + glyph.y / CGFloat(image.height) * cropHeight / source.size.height * bounds.height)
            kind = .icon
        } else { return nil }
        guard bounds.contains(point), point.y < bounds.minY + bounds.height * 0.35 else { return nil }
        print("FILES_CANCEL_VISUAL_POINT point=\(point)")
        return FilesCancelPoint(point: point, kind: kind)
    }

    private struct FilesCancelPoint {
        enum Kind: String { case ocr, icon }
        let point: CGPoint
        let kind: Kind
    }

    private func filesCloseGlyph(in image: CGImage, rasterScale: CGFloat) -> CGPoint? {
        let width = image.width, height = image.height
        guard width > 0, width <= 800, height > 0, height <= 160,
              rasterScale.isFinite, rasterScale > 0, rasterScale <= 1 else { return nil }
        var pixels = [UInt8](repeating: 0, count: width * height)
        let rendered = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height,
                bitsPerComponent: 8, bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard rendered else { return nil }
        let firstRow = max(0, Int(ceil(65 * rasterScale)))
        let minimum = max(3, Int(floor(10 * rasterScale)))
        let maximum = max(minimum, Int(ceil(28 * rasterScale)))
        guard firstRow < height else { return nil }
        var candidates: [CGPoint] = []
        for light in [false, true] {
            var visited = [Bool](repeating: false, count: pixels.count)
            func foreground(_ index: Int) -> Bool {
                light ? pixels[index] >= 160 : pixels[index] <= 96
            }
            for seed in (firstRow * width)..<pixels.count {
                if visited[seed] || !foreground(seed) { continue }
                var component = [seed]
                visited[seed] = true
                var cursor = 0
                var minX = seed % width, maxX = minX
                var minY = seed / width, maxY = minY
                while cursor < component.count {
                    let index = component[cursor]
                    cursor += 1
                    let x = index % width, y = index / width
                    minX = min(minX, x); maxX = max(maxX, x)
                    minY = min(minY, y); maxY = max(maxY, y)
                    for dy in -1...1 {
                        for dx in -1...1 where dx != 0 || dy != 0 {
                            let nx = x + dx, ny = y + dy
                            guard nx >= 0, nx < width, ny >= firstRow, ny < height else { continue }
                            let next = ny * width + nx
                            if !visited[next] && foreground(next) {
                                visited[next] = true
                                component.append(next)
                            }
                        }
                    }
                }
                let w = maxX - minX + 1, h = maxY - minY + 1
                guard w >= minimum, w <= maximum, h >= minimum, h <= maximum,
                      minX > 0, maxX < width - 1, minY > firstRow, maxY < height - 1 else { continue }
                let aspect = Double(w) / Double(h)
                let fill = Double(component.count) / Double(w * h)
                guard (0.8...1.25).contains(aspect), (0.12...0.5).contains(fill) else { continue }
                var fitted = 0
                var arms = [Int](repeating: 0, count: 4)
                for index in component {
                    let x = Double(index % width - minX) / Double(w - 1)
                    let y = Double(index / width - minY) / Double(h - 1)
                    if min(abs(x - y), abs(x + y - 1)) <= 0.17 { fitted += 1 }
                    // Four outer diagonal arms, not merely a central blob or slash.
                    if abs(x - 0.5) >= 0.2 && abs(y - 0.5) >= 0.2 {
                        arms[(x < 0.5 ? 0 : 1) + (y < 0.5 ? 0 : 2)] += 1
                    }
                }
                guard Double(fitted) / Double(component.count) >= 0.95,
                      arms.allSatisfy({ arm in Double(arm) / Double(component.count) >= 0.1 }) else { continue }
                candidates.append(CGPoint(x: CGFloat(minX + maxX + 1) / 2,
                                          y: CGFloat(minY + maxY + 1) / 2))
                if candidates.count > 1 { return nil }
            }
        }
        return candidates.count == 1 ? candidates[0] : nil
    }

    @MainActor
    func testFilesCloseGlyphLocatorRejectsAmbiguousControls() throws {
        let center = CGPoint(x: 113, y: 103)
        func sample(_ shape: String, light: Bool = false, scale: CGFloat = 1) throws -> CGImage {
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            let result = UIGraphicsImageRenderer(size: CGSize(width: 240 * scale, height: 160 * scale),
                                                 format: format).image { renderer in
                let context = renderer.cgContext
                context.scaleBy(x: scale, y: scale)
                context.setFillColor((light ? UIColor.black : UIColor.white).cgColor)
                context.fill(CGRect(x: 0, y: 0, width: 240, height: 160))
                context.setStrokeColor((light ? UIColor.white : UIColor.black).cgColor)
                context.setLineWidth(2)
                func cross(at point: CGPoint) {
                    context.move(to: CGPoint(x: point.x - 8, y: point.y - 8))
                    context.addLine(to: CGPoint(x: point.x + 8, y: point.y + 8))
                    context.move(to: CGPoint(x: point.x - 8, y: point.y + 8))
                    context.addLine(to: CGPoint(x: point.x + 8, y: point.y - 8))
                    context.strokePath()
                }
                switch shape {
                case "x": cross(at: center)
                case "ambiguous": cross(at: center); cross(at: CGPoint(x: 173, y: 103))
                case "ellipse": context.strokeEllipse(in: CGRect(x: 105, y: 95, width: 16, height: 16))
                case "m":
                    context.move(to: CGPoint(x: 105, y: 111))
                    for point in [CGPoint(x: 105, y: 95), CGPoint(x: 113, y: 103),
                                  CGPoint(x: 121, y: 95), CGPoint(x: 121, y: 111)] {
                        context.addLine(to: point)
                    }
                    context.strokePath()
                default: break
                }
            }
            return try XCTUnwrap(result.cgImage)
        }
        for light in [false, true] {
            for scale in [CGFloat(1), CGFloat(0.5)] {
                let image = try sample("x", light: light, scale: scale)
                let point = try XCTUnwrap(filesCloseGlyph(in: image, rasterScale: scale))
                XCTAssertEqual(point.x / scale, center.x, accuracy: 1)
                // An asymmetric Y explicitly proves the bitmap's top-down mapping.
                XCTAssertEqual(point.y / scale, center.y, accuracy: 1)
            }
            for shape in ["blank", "ellipse", "m", "ambiguous"] {
                XCTAssertNil(filesCloseGlyph(in: try sample(shape, light: light), rasterScale: 1), shape)
            }
        }
    }

    private func waitForFilesCancel(in app: XCUIApplication) -> CGRect {
        var resolvedFrame = CGRect.null
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            // A remote Files snapshot can change its candidate count between
            // reads. Resolve a fresh first match, then retain only its geometry.
            let control = app.descendants(matching: .any).matching(NSPredicate(
                format: "label IN %@", ["Cancel", "取消", "Close", "关闭"]
            )).firstMatch
            guard control.exists && control.isEnabled else { return false }
            let frame = control.frame
            let bounds = app.frame
            guard !frame.isNull && !frame.isEmpty && bounds.contains(frame)
                    && frame.midY < bounds.minY + bounds.height * 0.35 else { return false }
            resolvedFrame = frame
            return true
        }, object: nil)
        let result = XCTWaiter.wait(for: [ready], timeout: 60)
        if result != .completed, let point = captureFilesNavigation(in: app) {
            // A visible native Cancel label remains actionable even when the
            // remote accessibility snapshot omits its geometry entirely.
            return CGRect(x: point.point.x - 1, y: point.point.y - 1, width: 2, height: 2)
        }
        XCTAssertEqual(result, .completed, "Expected the Files navigation cancellation control")
        print("FILES_CANCEL_CONTROL frame=\(resolvedFrame)")
        return resolvedFrame
    }

    private func printSystemPanelGeometry(in app: XCUIApplication, phase: String, fileElement: XCUIElement) {
        let root = app.descendants(matching: .any).matching(identifier: "host.update.handoff").firstMatch
        let sheet = app.sheets.firstMatch
        print("SYSTEM_PANEL phase=\(phase) root=\(root.exists) rootFrame=\(root.exists ? root.frame : .zero) sheet=\(sheet.exists) sheetFrame=\(sheet.exists ? sheet.frame : .zero) file=\(fileElement.exists) fileFrame=\(fileElement.exists ? fileElement.frame : .zero)")
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

    private func waitForPlacedCard(midX expected: CGFloat, in app: XCUIApplication,
                                   file: StaticString = #filePath, line: UInt = #line) {
        // WebKit may publish a new accessibility node after replacing the card
        // DOM. Observe a fresh query until the actual geometry is available.
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let card = app.descendants(matching: .any).matching(NSPredicate(
                format: "label ENDSWITH 'Drag to move; tap to select.'"
            )).firstMatch
            guard card.exists else { return false }
            let frame = card.frame
            return !frame.isNull && !frame.isEmpty && abs(frame.midX - expected) <= 3
        }, object: nil)
        let result = XCTWaiter.wait(for: [ready], timeout: 8)
        if result != .completed {
            // Capture only after the unchanged geometry gate has already failed.
            // The passing path runs without continuous diagnostics or sampling.
            print("BOARD_GEOMETRY_FAILURE expectedMidX=\(expected)")
            captureBoardAfterFailure(in: app)
        }
        XCTAssertEqual(result, .completed,
                       "Expected the committed card geometry", file: file, line: line)
    }

    private func tapBoardControl(_ control: XCUIElement, action: String,
                                 in app: XCUIApplication, webView: XCUIElement,
                                 file: StaticString = #filePath, line: UInt = #line) {
        makeVisible(control, in: webView, scrolling: .towardUpperPage, file: file, line: line)
        let frame = control.frame
        let center = CGPoint(x: frame.midX, y: frame.midY)
        XCTAssertTrue(!frame.isNull && !frame.isEmpty && app.frame.contains(center),
                      "Expected a visible board action", file: file, line: line)
        print("BOARD_CONTROL action=\(action) frame=\(frame) webView=\(webView.frame)")
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
            dx: center.x - app.frame.minX, dy: center.y - app.frame.minY
        )).tap()
    }

    private func waitForCommittedCardX(_ expected: Int, in app: XCUIApplication,
                                       file: StaticString = #filePath, line: UInt = #line) {
        let status = app.descendants(matching: .any).matching(NSPredicate(
            format: "label BEGINSWITH %@", "Card position: X \(expected),"
        )).firstMatch
        let committed = status.waitForExistence(timeout: 8)
        if !committed {
            print("BOARD_COMMIT_FAILURE expectedX=\(expected)")
            captureBoardAfterFailure(in: app)
        }
        XCTAssertTrue(committed, "Expected the committed selected-card position", file: file, line: line)
    }

    private func captureBoardAfterFailure(in app: XCUIApplication) {
        let menu = app.buttons["host.menu"]
        if menu.exists && menu.isHittable {
            menu.tap()
            let capture = app.descendants(matching: .any).matching(NSPredicate(
                format: "label == 'Capture board diagnostic'"
            )).firstMatch
            if capture.waitForExistence(timeout: 3), capture.isHittable {
                capture.tap()
                RunLoop.current.run(until: Date().addingTimeInterval(1))
            }
        }
    }

    private enum ScrollDirection: Equatable { case towardUpperPage, towardLowerPage }

    private func tapWhenVisible(
        _ element: XCUIElement,
        in scrollable: XCUIElement,
        scrolling direction: ScrollDirection,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        makeVisible(element, in: scrollable, scrolling: direction, forTapping: true, file: file, line: line)
        let target = element.frame
        guard element.isHittable, let point = visibleTapPoint(target, in: scrollable.frame) else {
            XCTFail("Expected a hittable control with a safe visible tap point", file: file, line: line)
            return
        }
        // A control can be clipped at the WebView edge and still be actionable.
        // Tap inside its visible area without XCTest scrolling its ancestor again.
        element.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
            dx: point.x - target.minX, dy: point.y - target.minY
        )).tap()
    }

    private func visibleTapPoint(_ target: CGRect, in scrollFrame: CGRect) -> CGPoint? {
        guard !target.isNull, !target.isEmpty, !target.isInfinite,
              !scrollFrame.isNull, !scrollFrame.isEmpty, !scrollFrame.isInfinite else { return nil }
        let visible = target.intersection(scrollFrame.insetBy(dx: 8, dy: 8))
        // Keep the point away from both clipping edges; a tiny sliver is insufficient.
        guard !visible.isNull, visible.width >= 16, visible.height >= 16 else { return nil }
        return CGPoint(x: visible.midX, y: visible.midY)
    }

    private func makeVisible(
        _ element: XCUIElement,
        in scrollable: XCUIElement,
        scrolling direction: ScrollDirection,
        forTapping: Bool = false,
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
                    let ready = forTapping
                        ? visibleTapPoint(target, in: scrollable.frame) != nil
                        : safelyVisible
                    if element.isHittable && ready { return }
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

    private func studioScrollViewport(dialog: XCUIElement, firstField: XCUIElement,
                                      tab: XCUIElement) throws -> CGRect {
        let field = firstField.frame
        let frame = dialog.frame
        // The full-width first field directly follows the content padding.
        // A seven-point offset stays inside its minimum ten-point CSS padding.
        // Conservatively inset above the status area, which starts empty and
        // has no stable accessibility frame. Runtime tests validate containment.
        let left = field.minX - 7
        let top = tab.frame.maxY + 12
        let viewport = CGRect(x: left, y: top, width: frame.maxX - 8 - left,
                              height: frame.maxY - 64 - top)
        XCTAssertTrue(firstField.isHittable && tab.isHittable,
                      "Expected visible Studio geometry anchors")
        XCTAssertTrue(!viewport.isEmpty && frame.contains(viewport) && viewport.contains(field),
                      "Expected the first field inside the anchored editor viewport; dialog=\(frame); field=\(field); tab=\(tab.frame); viewport=\(viewport)")
        return viewport
    }

    private func revealStudioControl(_ control: XCUIElement, in dialog: XCUIElement,
                                     corridorX: CGFloat, tab: XCUIElement,
                                     app: XCUIApplication, webView: XCUIElement,
                                     file: StaticString = #filePath, line: UInt = #line) {
        // Only the padding corridor survives editing. Keyboard transitions can
        // change layout, so sample the vertical bounds again before every drag.
        for attempt in 0...8 {
            let appFrame = app.frame
            let dialogFrame = dialog.frame
            let webFrame = webView.frame
            let tabFrame = tab.frame
            let targetExists = control.exists
            let target = control.frame
            let hittable = targetExists && control.isHittable
            let visible = appFrame.intersection(webFrame).intersection(dialogFrame)
            let top = max(visible.minY + 8, tabFrame.maxY + 12)
            let bottom = min(visible.maxY - 8, dialogFrame.maxY - 64)
            let viewport = CGRect(x: corridorX, y: top,
                                  width: visible.maxX - 8 - corridorX, height: bottom - top)
            guard !visible.isNull, !visible.isEmpty, !viewport.isNull,
                  viewport.width > 16, viewport.height > 48,
                  visible.contains(viewport), tab.exists, tab.isHittable else {
                print("PUBLIC_QSP_GEOMETRY attempt=\(attempt) invalid=true app=\(appFrame) dialog=\(dialogFrame) web=\(webFrame) tab=\(tabFrame) viewport=\(viewport)")
                XCTFail("Expected current visible Studio scroll anchors", file: file, line: line)
                return
            }
            print("PUBLIC_QSP_GEOMETRY attempt=\(attempt) target=\(target) hittable=\(hittable) dialog=\(dialogFrame) web=\(webFrame) tab=\(tabFrame) viewport=\(viewport)")
            if targetExists && hittable && !target.isEmpty && viewport.contains(target) { return }
            // The eighth drag gets a final visibility check, without a ninth drag.
            guard attempt < 8 else { break }
            guard targetExists, !target.isNull, !target.isEmpty else {
                XCTFail("Expected the synthetic Studio control to exist", file: file, line: line)
                return
            }
            let towardUpper = target.minY < viewport.minY
            let overflow = towardUpper
                ? viewport.minY - target.minY
                : max(0, target.maxY - viewport.maxY)
            // Move just beyond the clipping edge; cap each gesture inside the
            // current content window instead of always moving a full fixed span.
            let distance = min(max(24, overflow + 8), viewport.height * 0.6)
            let startY = towardUpper ? viewport.minY + 16 : viewport.maxY - 16
            let endY = towardUpper ? startY + distance : startY - distance
            let start = CGPoint(x: corridorX, y: startY)
            let end = CGPoint(x: corridorX, y: endY)
            print("PUBLIC_QSP_GEOMETRY attempt=\(attempt) start=\(start) end=\(end)")
            // Use the stable application coordinate space, not a scrollable AX
            // ancestor whose origin may be resolved again during the gesture.
            let origin = app.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: start.x - appFrame.minX, dy: start.y - appFrame.minY))
                .press(forDuration: 0.08, thenDragTo: origin.withOffset(CGVector(
                    dx: end.x - appFrame.minX, dy: end.y - appFrame.minY)))
        }
        XCTFail("Expected a fully visible Studio control after eight drags", file: file, line: line)
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
