import XCTest
@testable import Quareia

final class BridgeTests: XCTestCase {
    private let allowedContext = BridgeContext(
        isMainFrame: true,
        scheme: AppRoute.scheme,
        host: AppRoute.host,
        port: 0,
        documentPath: "/index.html"
    )

    func testValidMainFrameRequestProducesTypedRequest() throws {
        let request = try BridgeValidator.validate(body: validBody(), context: allowedContext)
        XCTAssertEqual(request.id, "request_1")
        XCTAssertEqual(request.method, .hostInfo)
        XCTAssertEqual(request.parameters, .none)
        XCTAssertFalse(request.canonicalEnvelope.isEmpty)
    }

    func testOnlyTrustedMainDocumentCanCallBridge() {
        let contexts = [
            BridgeContext(isMainFrame: false, scheme: AppRoute.scheme, host: AppRoute.host, port: 0),
            BridgeContext(isMainFrame: true, scheme: "https", host: AppRoute.host, port: 0),
            BridgeContext(isMainFrame: true, scheme: AppRoute.scheme, host: "other", port: 0),
            BridgeContext(isMainFrame: true, scheme: AppRoute.scheme, host: AppRoute.host, port: 444),
            BridgeContext(isMainFrame: true, scheme: AppRoute.scheme, host: AppRoute.host, port: 0, documentPath: "/frame.html"),
            BridgeContext(isMainFrame: true, scheme: AppRoute.scheme, host: AppRoute.host, port: 0, hasQueryOrFragment: true)
        ]
        for context in contexts {
            XCTAssertThrowsError(try BridgeValidator.validate(body: validBody(), context: context)) {
                XCTAssertEqual($0 as? BridgeValidationError, .invalidContext)
            }
        }
    }

    func testEnvelopeIDAndTypesAreStrict() {
        let rejected: [(Any, BridgeValidationError)] = [
            (["id": "request_1", "method": "hostInfo"] as [String: Any], .invalidEnvelope),
            (["id": "request_1", "method": "hostInfo", "params": [:], "extra": true] as [String: Any], .invalidEnvelope),
            (["id": 1, "method": "hostInfo", "params": [:]] as [String: Any], .invalidID),
            (["id": "bad id", "method": "hostInfo", "params": [:]] as [String: Any], .invalidID),
            (["id": "request_1", "method": "eval", "params": [:]] as [String: Any], .unsupportedMethod),
            (["id": "request_1", "method": "hostInfo", "params": []] as [String: Any], .invalidParameters),
            (["id": "request_1", "method": "setTelemetryEnabled", "params": ["enabled": 1]] as [String: Any], .invalidParameters),
            (["id": "request_1", "method": "fileImportRead", "params": ["transferID": UUID().uuidString.lowercased(), "offset": true, "length": 1]] as [String: Any], .invalidParameters)
        ]
        for (body, expected) in rejected {
            XCTAssertThrowsError(try BridgeValidator.validate(body: body, context: allowedContext)) {
                XCTAssertEqual($0 as? BridgeValidationError, expected)
            }
        }
    }

    func testMethodSpecificParametersAndPrivacyMinimizedReadingAreEnforced() throws {
        let theme = try BridgeValidator.validate(
            body: validBody(method: "setTheme", params: ["theme": "grove"]),
            context: allowedContext
        )
        XCTAssertEqual(theme.parameters, .theme("grove"))

        let reading = try BridgeValidator.validate(
            body: validBody(method: "readingCompleted", params: ["deckType": "tarot", "cardCount": 3]),
            context: allowedContext
        )
        XCTAssertEqual(reading.parameters, .readingCompleted(deckType: "tarot", cardCount: 3))

        let rejected = [
            validBody(method: "setTheme", params: ["theme": "dark"]),
            validBody(method: "setLocale", params: ["locale": "en-US"]),
            validBody(method: "readingCompleted", params: ["deckType": "tarot", "cardCount": 79]),
            validBody(method: "readingCompleted", params: ["deckType": "tarot", "cardCount": 3, "readingID": "private"])
        ]
        for body in rejected {
            XCTAssertThrowsError(try BridgeValidator.validate(body: body, context: allowedContext)) {
                XCTAssertEqual($0 as? BridgeValidationError, .invalidParameters)
            }
        }
    }

    func testTransferLimitsAndCanonicalBase64AreEnforced() throws {
        let transferID = UUID().uuidString.lowercased()
        let data = Data(repeating: 0x61, count: BridgeValidator.maximumChunkBytes)
        let request = try BridgeValidator.validate(body: validBody(method: "fileExportChunk", params: [
            "transferID": transferID, "offset": 0, "base64": data.base64EncodedString()
        ]), context: allowedContext)
        XCTAssertEqual(request.parameters, .exportChunk(transferID: transferID, offset: 0, data: data))

        XCTAssertThrowsError(try BridgeValidator.validate(body: validBody(method: "fileExportBegin", params: [
            "kind": "qsp", "name": "spread.qsp", "byteCount": BridgeValidator.maximumQSPBytes + 1
        ]), context: allowedContext)) {
            XCTAssertEqual($0 as? BridgeValidationError, .invalidParameters)
        }
        XCTAssertThrowsError(try BridgeValidator.validate(body: validBody(method: "fileExportChunk", params: [
            "transferID": transferID, "offset": 0,
            "base64": Data(repeating: 0x61, count: BridgeValidator.maximumChunkBytes + 1).base64EncodedString()
        ]), context: allowedContext)) {
            XCTAssertEqual($0 as? BridgeValidationError, .invalidParameters)
        }
    }

    func testMethodSpecificEnvelopeLimitIsEnforcedBeforeParameterParsing() {
        let body = validBody(method: "setTheme", params: ["theme": String(repeating: "a", count: 5_000)])
        XCTAssertThrowsError(try BridgeValidator.validate(body: body, context: allowedContext)) {
            XCTAssertEqual($0 as? BridgeValidationError, .payloadTooLarge)
        }
    }

    func testInvalidMethodReturnsBoundedStructuredError() {
        let delivered = expectation(description: "error delivered")
        var captured: BridgeReply?
        let session = BridgeSession(operation: { _ in [:] }) { reply in
            captured = reply
            delivered.fulfill()
        }
        session.handle(body: validBody(id: "bad_method", method: "eval"), context: allowedContext)
        wait(for: [delivered], timeout: 1)
        XCTAssertEqual(captured?.id, "bad_method")
        XCTAssertEqual(errorCode(captured), "UNSUPPORTED_METHOD")
    }

    func testCompletedDuplicateReplaysWithoutExecutingTwice() {
        let firstDelivered = expectation(description: "first reply")
        let replayDelivered = expectation(description: "replayed reply")
        let lock = NSLock()
        var executions = 0
        var deliveries = 0
        let body = validBody(id: "same")
        let session = BridgeSession(operation: { _ in
            lock.lock(); executions += 1; lock.unlock()
            return ["value": 1]
        }) { _ in
            deliveries += 1
            (deliveries == 1 ? firstDelivered : replayDelivered).fulfill()
        }
        session.handle(body: body, context: allowedContext)
        wait(for: [firstDelivered], timeout: 1)
        session.handle(body: body, context: allowedContext)
        wait(for: [replayDelivered], timeout: 1)
        XCTAssertEqual(executions, 1)
    }

    func testDuplicateIDWithDifferentBodyIsRejected() {
        let firstStarted = expectation(description: "first started")
        let replies = expectation(description: "success and duplicate")
        replies.expectedFulfillmentCount = 2
        var codes: [String] = []
        let session = BridgeSession(operation: { _ in
            firstStarted.fulfill()
            try await Task.sleep(nanoseconds: 200_000_000)
            return [:]
        }) { reply in
            if let code = self.errorCode(reply) { codes.append(code) }
            replies.fulfill()
        }
        session.handle(body: validBody(id: "duplicate"), context: allowedContext)
        wait(for: [firstStarted], timeout: 1)
        session.handle(body: validBody(id: "duplicate", method: "telemetryState"), context: allowedContext)
        wait(for: [replies], timeout: 1)
        XCTAssertEqual(codes, ["DUPLICATE_ID"])
    }

    func testInFlightCapFailsClosed() {
        let started = expectation(description: "started")
        let rejected = expectation(description: "rejected")
        let session = BridgeSession(maximumInFlight: 1, operation: { _ in
            started.fulfill()
            try await Task.sleep(nanoseconds: 500_000_000)
            return [:]
        }) { reply in
            if self.errorCode(reply) == "TOO_MANY_IN_FLIGHT" { rejected.fulfill() }
        }
        session.handle(body: validBody(id: "first"), context: allowedContext)
        wait(for: [started], timeout: 1)
        session.handle(body: validBody(id: "second"), context: allowedContext)
        wait(for: [rejected], timeout: 1)
        session.stop()
    }

    func testTimeoutCancelsOperationAndReturnsBoundedError() {
        let delivered = expectation(description: "timeout")
        var code: String?
        let session = BridgeSession(timeout: { _ in 10_000_000 }, operation: { _ in
            try await Task.sleep(nanoseconds: 500_000_000)
            return [:]
        }) { reply in
            code = self.errorCode(reply)
            delivered.fulfill()
        }
        session.handle(body: validBody(), context: allowedContext)
        wait(for: [delivered], timeout: 1)
        XCTAssertEqual(code, "TIMEOUT")
    }

    func testStopAndNavigationInvalidationSuppressOldReplies() {
        let started = expectation(description: "operation started")
        let noOldDelivery = expectation(description: "old reply suppressed")
        noOldDelivery.isInverted = true
        let nextDelivered = expectation(description: "next reply delivered")
        let session = BridgeSession(operation: { request in
            if request.id == "first" {
                started.fulfill()
                try await Task.sleep(nanoseconds: 500_000_000)
            }
            return ["id": request.id]
        }) { reply in
            if reply.id == "first" { noOldDelivery.fulfill() }
            if reply.id == "second" { nextDelivered.fulfill() }
        }
        session.handle(body: validBody(id: "first"), context: allowedContext)
        wait(for: [started], timeout: 1)
        session.invalidatePendingOperations()
        session.handle(body: validBody(id: "second"), context: allowedContext)
        wait(for: [nextDelivered, noOldDelivery], timeout: 0.75)
        session.stop()
    }

    func testUntrustedContextIsDroppedWithoutDelivery() {
        let noDelivery = expectation(description: "no callback")
        noDelivery.isInverted = true
        let session = BridgeSession(operation: { _ in [:] }) { _ in noDelivery.fulfill() }
        session.handle(body: validBody(), context: BridgeContext(
            isMainFrame: false, scheme: AppRoute.scheme, host: AppRoute.host, port: 0
        ))
        wait(for: [noDelivery], timeout: 0.25)
    }

    private func validBody(
        id: String = "request_1",
        method: String = "hostInfo",
        params: [String: Any] = [:]
    ) -> [String: Any] {
        ["id": id, "method": method, "params": params]
    }

    private func errorCode(_ reply: BridgeReply?) -> String? {
        (reply?.payload["error"] as? [String: String])?["code"]
    }
}
