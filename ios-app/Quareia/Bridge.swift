import Foundation
import WebKit

struct BridgeContext: Equatable {
    let isMainFrame: Bool
    let scheme: String
    let host: String
    let port: Int

    var isAllowed: Bool {
        isMainFrame && scheme == AppRoute.scheme && host == AppRoute.host && port == 0
    }
}

struct ValidatedBridgeRequest: Equatable {
    let id: String
    let method: String
}

enum BridgeValidationError: Error, Equatable {
    case invalidContext
    case invalidEnvelope
    case payloadTooLarge
    case invalidID
    case unsupportedMethod
    case invalidParameters
}

enum BridgeValidator {
    static let maximumPayloadBytes = 16 * 1024
    private static let allowedIDCharacters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")

    static func validate(body: Any, context: BridgeContext) throws -> ValidatedBridgeRequest {
        guard context.isAllowed else { throw BridgeValidationError.invalidContext }
        guard let envelope = body as? [String: Any], JSONSerialization.isValidJSONObject(envelope) else {
            throw BridgeValidationError.invalidEnvelope
        }
        guard Set(envelope.keys) == ["id", "method", "params"] else {
            throw BridgeValidationError.invalidEnvelope
        }
        let data = try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys])
        guard data.count <= maximumPayloadBytes else { throw BridgeValidationError.payloadTooLarge }
        guard
            let id = envelope["id"] as? String,
            (1...64).contains(id.utf8.count),
            id.unicodeScalars.allSatisfy({ allowedIDCharacters.contains($0) })
        else { throw BridgeValidationError.invalidID }
        guard let method = envelope["method"] as? String, method == "hostInfo" else {
            throw BridgeValidationError.unsupportedMethod
        }
        guard let parameters = envelope["params"] as? [String: Any], parameters.isEmpty else {
            throw BridgeValidationError.invalidParameters
        }
        return ValidatedBridgeRequest(id: id, method: method)
    }

    static func recoverableID(from body: Any) -> String? {
        guard let envelope = body as? [String: Any], let id = envelope["id"] as? String else { return nil }
        guard (1...64).contains(id.utf8.count), id.unicodeScalars.allSatisfy({ allowedIDCharacters.contains($0) }) else {
            return nil
        }
        return id
    }
}

struct BridgeReply {
    let id: String
    let payload: [String: Any]

    static func success(id: String, result: [String: Any]) -> BridgeReply {
        BridgeReply(id: id, payload: ["ok": true, "result": result])
    }

    static func failure(id: String, code: String) -> BridgeReply {
        BridgeReply(id: id, payload: ["ok": false, "error": ["code": code]])
    }
}

final class BridgeSession {
    typealias Operation = (ValidatedBridgeRequest) async -> [String: Any]
    typealias Delivery = (BridgeReply) -> Void

    private let lock = NSRecursiveLock()
    private var isRunning = true
    private var generation = UUID()
    private var inFlight = Set<UUID>()
    private var tasks: [UUID: Task<Void, Never>] = [:]
    private let operation: Operation
    private let delivery: Delivery

    init(operation: @escaping Operation, delivery: @escaping Delivery) {
        self.operation = operation
        self.delivery = delivery
    }

    func handle(body: Any, context: BridgeContext) {
        let request: ValidatedBridgeRequest
        do {
            request = try BridgeValidator.validate(body: body, context: context)
        } catch BridgeValidationError.invalidContext {
            return
        } catch {
            guard let id = BridgeValidator.recoverableID(from: body) else { return }
            deliverIfRunning(.failure(id: id, code: Self.code(for: error)))
            return
        }

        lock.lock()
        guard isRunning else {
            lock.unlock()
            return
        }
        let expectedGeneration = generation
        let taskID = UUID()
        inFlight.insert(taskID)
        let operation = self.operation
        lock.unlock()

        let task = Task { [weak self] in
            guard !Task.isCancelled else { return }
            let result = await operation(request)
            guard !Task.isCancelled else { return }
            self?.complete(
                taskID: taskID,
                expectedGeneration: expectedGeneration,
                reply: .success(id: request.id, result: result)
            )
        }

        lock.lock()
        if isRunning && generation == expectedGeneration && inFlight.contains(taskID) {
            tasks[taskID] = task
        } else {
            task.cancel()
        }
        lock.unlock()
    }

    func stop() {
        lock.lock()
        isRunning = false
        generation = UUID()
        let pending = Array(tasks.values)
        inFlight.removeAll()
        tasks.removeAll()
        lock.unlock()
        pending.forEach { $0.cancel() }
    }

    func invalidatePendingOperations() {
        lock.lock()
        guard isRunning else {
            lock.unlock()
            return
        }
        generation = UUID()
        let pending = Array(tasks.values)
        inFlight.removeAll()
        tasks.removeAll()
        lock.unlock()
        pending.forEach { $0.cancel() }
    }

    private func complete(taskID: UUID, expectedGeneration: UUID, reply: BridgeReply) {
        lock.lock()
        defer { lock.unlock() }
        let wasInFlight = inFlight.remove(taskID) != nil
        let shouldDeliver = wasInFlight && isRunning && generation == expectedGeneration
        tasks.removeValue(forKey: taskID)
        if shouldDeliver { delivery(reply) }
    }

    private func deliverIfRunning(_ reply: BridgeReply) {
        lock.lock()
        defer { lock.unlock() }
        if isRunning { delivery(reply) }
    }

    private static func code(for error: Error) -> String {
        switch error as? BridgeValidationError {
        case .invalidEnvelope: return "INVALID_ENVELOPE"
        case .payloadTooLarge: return "PAYLOAD_TOO_LARGE"
        case .invalidID: return "INVALID_ID"
        case .unsupportedMethod: return "UNSUPPORTED_METHOD"
        case .invalidParameters: return "INVALID_PARAMETERS"
        default: return "INVALID_REQUEST"
        }
    }
}

final class NativeBridgeHandler: NSObject, WKScriptMessageHandler {
    static let name = "quareia"
    private weak var webView: WKWebView?
    private var session: BridgeSession!
    private let protectedBaseURL: String
    private var documentGeneration = 0
    private var documentURL: URL?

    init(webView: WKWebView, protectedBaseURL: String) {
        self.webView = webView
        self.protectedBaseURL = protectedBaseURL
        super.init()
        replaceSession()
    }

    func beginNavigation(to url: URL?) {
        dispatchPrecondition(condition: .onQueue(.main))
        documentGeneration &+= 1
        documentURL = url.flatMap { AppRoute(token: "unused", publicResources: EmptyPublicResources(), imageProvider: nil).isExactOrigin($0) ? $0 : nil }
        session?.stop()
        replaceSession()
    }

    func invalidateNavigation() {
        dispatchPrecondition(condition: .onQueue(.main))
        documentGeneration &+= 1
        documentURL = nil
        session?.invalidatePendingOperations()
    }

    private func replaceSession() {
        let expectedGeneration = documentGeneration
        let protectedBaseURL = self.protectedBaseURL
        session = BridgeSession(
            operation: { request in
                precondition(request.method == "hostInfo")
                let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
                return [
                    "platform": "iOS",
                    "version": version,
                    "protectedAssetBaseURL": protectedBaseURL
                ]
            },
            delivery: { [weak self] reply in
                Task { @MainActor [weak self] in
                    await self?.deliver(reply, expectedGeneration: expectedGeneration)
                }
            }
        )
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        let context = BridgeContext(
            isMainFrame: message.frameInfo.isMainFrame,
            scheme: origin.protocol,
            host: origin.host,
            port: origin.port
        )
        session.handle(body: message.body, context: context)
    }

    func stop() {
        session.stop()
        webView = nil
    }

    @MainActor
    private func deliver(_ reply: BridgeReply, expectedGeneration: Int) async {
        guard
            expectedGeneration == documentGeneration,
            let expectedURL = documentURL,
            let webView,
            let currentURL = webView.url,
            currentURL.absoluteString == expectedURL.absoluteString
        else { return }
        do {
            _ = try await webView.callAsyncJavaScript(
                """
                if (window.QuareiaNative && typeof window.QuareiaNative._receive === 'function') {
                    window.QuareiaNative._receive(id, reply);
                }
                return true;
                """,
                arguments: ["id": reply.id, "reply": reply.payload],
                in: nil,
                contentWorld: .page
            )
        } catch {
            // Navigation or process termination invalidates the page; no retry crosses that boundary.
        }
    }
}

private struct EmptyPublicResources: PublicResourceLoading {
    func response(for path: String) -> RouteResponse? { nil }
}
