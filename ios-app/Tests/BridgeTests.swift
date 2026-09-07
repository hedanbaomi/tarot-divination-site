import XCTest
@testable import Quareia

final class BridgeTests: XCTestCase {
    private let allowedContext = BridgeContext(
        isMainFrame: true,
        scheme: AppRoute.scheme,
        host: AppRoute.host,
        port: 0
    )

    func testValidMainFrameRequestProducesStructuredReply() throws {
        let request = try BridgeValidator.validate(body: validBody(), context: allowedContext)
        XCTAssertEqual(request, ValidatedBridgeRequest(id: "request_1", method: "hostInfo"))
    }

    func testIframeAndWrongOriginsAreRejected() {
        let contexts = [
            BridgeContext(isMainFrame: false, scheme: AppRoute.scheme, host: AppRoute.host, port: 0),
            BridgeContext(isMainFrame: true, scheme: "https", host: AppRoute.host, port: 0),
            BridgeContext(isMainFrame: true, scheme: AppRoute.scheme, host: "other", port: 0),
            BridgeContext(isMainFrame: true, scheme: AppRoute.scheme, host: AppRoute.host, port: 444)
        ]
        for context in contexts {
            XCTAssertThrowsError(try BridgeValidator.validate(body: validBody(), context: context)) {
                XCTAssertEqual($0 as? BridgeValidationError, .invalidContext)
            }
        }
    }

    func testEnvelopeTypesKeysIDMethodAndParametersAreStrict() {
        let rejected: [(Any, BridgeValidationError)] = [
            (["id": "request_1", "method": "hostInfo"] as [String: Any], .invalidEnvelope),
            (["id": "request_1", "method": "hostInfo", "params": [:], "extra": true] as [String: Any], .invalidEnvelope),
            (["id": 1, "method": "hostInfo", "params": [:]] as [String: Any], .invalidID),
            (["id": "bad id", "method": "hostInfo", "params": [:]] as [String: Any], .invalidID),
            (["id": "request_1", "method": "eval", "params": [:]] as [String: Any], .unsupportedMethod),
            (["id": "request_1", "method": "hostInfo", "params": ["unexpected": true]] as [String: Any], .invalidParameters),
            (["id": "request_1", "method": "hostInfo", "params": []] as [String: Any], .invalidParameters)
        ]
        for (body, expected) in rejected {
            XCTAssertThrowsError(try BridgeValidator.validate(body: body, context: allowedContext)) {
                XCTAssertEqual($0 as? BridgeValidationError, expected)
            }
        }
    }

    func testOversizedEnvelopeIsRejected() {
        let body: [String: Any] = [
            "id": "request_1",
            "method": "hostInfo",
            "params": [:],
            "padding": String(repeating: "a", count: BridgeValidator.maximumPayloadBytes)
        ]
        XCTAssertThrowsError(try BridgeValidator.validate(body: body, context: allowedContext)) {
            // Exact-key validation is deliberately earlier than size validation for unknown fields.
            XCTAssertEqual($0 as? BridgeValidationError, .invalidEnvelope)
        }

        let longParameter: [String: Any] = [
            "id": "request_1",
            "method": "hostInfo",
            "params": ["value": String(repeating: "a", count: BridgeValidator.maximumPayloadBytes)]
        ]
        XCTAssertThrowsError(try BridgeValidator.validate(body: longParameter, context: allowedContext)) {
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
        session.handle(
            body: ["id": "bad_method", "method": "eval", "params": [:]] as [String: Any],
            context: allowedContext
        )
        wait(for: [delivered], timeout: 1)
        XCTAssertEqual(captured?.id, "bad_method")
        XCTAssertEqual(captured?.payload["ok"] as? Bool, false)
        XCTAssertEqual((captured?.payload["error"] as? [String: String])?["code"], "UNSUPPORTED_METHOD")
    }

    func testStopCancelsPendingOperationWithoutDelivery() {
        let operationStarted = expectation(description: "operation started")
        let noDelivery = expectation(description: "no delivery")
        noDelivery.isInverted = true
        let session = BridgeSession(operation: { _ in
            operationStarted.fulfill()
            try? await Task.sleep(nanoseconds: 500_000_000)
            return ["platform": "iOS"]
        }) { _ in
            noDelivery.fulfill()
        }

        session.handle(body: validBody(), context: allowedContext)
        wait(for: [operationStarted], timeout: 1)
        session.stop()
        wait(for: [noDelivery], timeout: 0.75)
    }

    func testInvalidationCancelsPendingRequestAndSessionAcceptsNextRequest() {
        let firstStarted = expectation(description: "first operation started")
        let firstNotDelivered = expectation(description: "first reply not delivered")
        firstNotDelivered.isInverted = true
        let secondDelivered = expectation(description: "second reply delivered")
        let session = BridgeSession(operation: { request in
            if request.id == "first" {
                firstStarted.fulfill()
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
            return ["requestID": request.id]
        }) { reply in
            if reply.id == "first" { firstNotDelivered.fulfill() }
            if reply.id == "second" { secondDelivered.fulfill() }
        }

        session.handle(body: validBody(id: "first"), context: allowedContext)
        wait(for: [firstStarted], timeout: 1)
        session.invalidatePendingOperations()
        session.handle(body: validBody(id: "second"), context: allowedContext)

        wait(for: [secondDelivered, firstNotDelivered], timeout: 0.75)
    }

    func testIframeRequestIsDroppedWithoutAnyDelivery() {
        let noDelivery = expectation(description: "iframe has no callback")
        noDelivery.isInverted = true
        let session = BridgeSession(operation: { _ in [:] }) { _ in noDelivery.fulfill() }
        session.handle(
            body: validBody(),
            context: BridgeContext(isMainFrame: false, scheme: AppRoute.scheme, host: AppRoute.host, port: 0)
        )
        wait(for: [noDelivery], timeout: 0.25)
    }

    private func validBody(id: String = "request_1") -> [String: Any] {
        ["id": id, "method": "hostInfo", "params": [:]]
    }
}
