import CoreFoundation
import Foundation
import WebKit

struct BridgeContext: Equatable {
    let isMainFrame: Bool
    let scheme: String
    let host: String
    let port: Int
    let documentPath: String
    let hasQueryOrFragment: Bool

    init(
        isMainFrame: Bool,
        scheme: String,
        host: String,
        port: Int,
        documentPath: String = "/index.html",
        hasQueryOrFragment: Bool = false
    ) {
        self.isMainFrame = isMainFrame
        self.scheme = scheme
        self.host = host
        self.port = port
        self.documentPath = documentPath
        self.hasQueryOrFragment = hasQueryOrFragment
    }

    var isAllowed: Bool {
        guard isMainFrame,
              scheme == AppRoute.scheme,
              host == AppRoute.host,
              port == 0,
              !hasQueryOrFragment else { return false }
        if documentPath == "/index.html" { return true }
        #if PUBLIC_TESTING
        return documentPath == "/probe/index.html"
        #else
        return false
        #endif
    }

    static func isTrustedDocumentURL(_ url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return BridgeContext(
            isMainFrame: true,
            scheme: components.scheme ?? "",
            host: components.host ?? "",
            port: components.port ?? 0,
            documentPath: components.percentEncodedPath,
            hasQueryOrFragment: components.query != nil || components.fragment != nil
        ).isAllowed && components.user == nil && components.password == nil
    }
}

enum BridgeMethod: String, CaseIterable {
    case hostInfo, setLocale, setTheme
    case presentAbout, presentPrivacy, presentAnnouncements, checkForUpdates
    case readingCompleted, telemetryState, setTelemetryEnabled
    case fileExportBegin, fileExportChunk, fileExportFinish
    case fileImport, fileImportRead, fileTransferCancel, fileImportFinish

    var maximumEnvelopeBytes: Int {
        self == .fileExportChunk ? 48 * 1024 : 4 * 1024
    }

    var timeoutNanoseconds: UInt64 {
        switch self {
        case .presentAbout, .presentPrivacy, .presentAnnouncements, .checkForUpdates, .fileExportFinish, .fileImport:
            return 300 * 1_000_000_000
        default:
            return 10 * 1_000_000_000
        }
    }
}

enum BridgeFileKind: String, Equatable {
    case history, qsp, backup
}

enum BridgeParameters: Equatable {
    case none
    case locale(String)
    case theme(String)
    case telemetryEnabled(Bool)
    case readingCompleted(deckType: String, cardCount: Int)
    case exportBegin(kind: BridgeFileKind, name: String, byteCount: Int)
    case exportChunk(transferID: String, offset: Int, data: Data)
    case exportFinish(transferID: String, action: String)
    case fileImport(kind: BridgeFileKind)
    case importRead(transferID: String, offset: Int, length: Int)
    case transferID(String)
}

struct ValidatedBridgeRequest: Equatable {
    let id: String
    let method: BridgeMethod
    let parameters: BridgeParameters
    let canonicalEnvelope: Data

    init(id: String, method: BridgeMethod, parameters: BridgeParameters, canonicalEnvelope: Data = Data()) {
        self.id = id
        self.method = method
        self.parameters = parameters
        self.canonicalEnvelope = canonicalEnvelope
    }
}

enum BridgeValidationError: Error, Equatable {
    case invalidContext, invalidEnvelope, payloadTooLarge, invalidID, unsupportedMethod, invalidParameters
}

enum BridgeValidator {
    static let maximumPayloadBytes = 64 * 1024
    static let maximumTransferBytes = 16 * 1024 * 1024
    static let maximumChunkBytes = 32 * 1024
    static let maximumQSPBytes = 16 * 1024
    private static let allowedIDCharacters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
    private static let supportedLocales = Set(["zh-CN", "en"])
    private static let supportedThemes = Set(["celestial", "parchment", "ember", "grove"])
    private static let supportedDecks = Set(["tarot", "mystagogus", "lxxxi"])

    static func validate(body: Any, context: BridgeContext) throws -> ValidatedBridgeRequest {
        guard context.isAllowed else { throw BridgeValidationError.invalidContext }
        guard let envelope = body as? [String: Any], JSONSerialization.isValidJSONObject(envelope) else {
            throw BridgeValidationError.invalidEnvelope
        }
        guard Set(envelope.keys) == ["id", "method", "params"] else {
            throw BridgeValidationError.invalidEnvelope
        }
        guard let id = envelope["id"] as? String, isValidID(id) else {
            throw BridgeValidationError.invalidID
        }
        guard let methodName = envelope["method"] as? String,
              let method = BridgeMethod(rawValue: methodName) else {
            throw BridgeValidationError.unsupportedMethod
        }
        guard let parameters = envelope["params"] as? [String: Any] else {
            throw BridgeValidationError.invalidParameters
        }
        let data = try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys])
        guard data.count <= maximumPayloadBytes, data.count <= method.maximumEnvelopeBytes else {
            throw BridgeValidationError.payloadTooLarge
        }
        return ValidatedBridgeRequest(
            id: id,
            method: method,
            parameters: try validate(parameters: parameters, for: method),
            canonicalEnvelope: data
        )
    }

    static func recoverableID(from body: Any) -> String? {
        guard let envelope = body as? [String: Any], let id = envelope["id"] as? String, isValidID(id) else {
            return nil
        }
        return id
    }

    private static func isValidID(_ id: String) -> Bool {
        (1...64).contains(id.utf8.count) && id.unicodeScalars.allSatisfy({ allowedIDCharacters.contains($0) })
    }

    private static func validate(parameters: [String: Any], for method: BridgeMethod) throws -> BridgeParameters {
        switch method {
        case .hostInfo, .presentAbout, .presentPrivacy, .presentAnnouncements, .checkForUpdates, .telemetryState:
            try requireKeys(parameters, [])
            return .none
        case .setLocale:
            try requireKeys(parameters, ["locale"])
            guard let locale = parameters["locale"] as? String, supportedLocales.contains(locale) else {
                throw BridgeValidationError.invalidParameters
            }
            return .locale(locale)
        case .setTheme:
            try requireKeys(parameters, ["theme"])
            guard let theme = parameters["theme"] as? String, supportedThemes.contains(theme) else {
                throw BridgeValidationError.invalidParameters
            }
            return .theme(theme)
        case .setTelemetryEnabled:
            try requireKeys(parameters, ["enabled"])
            guard let enabled = exactBool(parameters["enabled"]) else { throw BridgeValidationError.invalidParameters }
            return .telemetryEnabled(enabled)
        case .readingCompleted:
            try requireKeys(parameters, ["deckType", "cardCount"])
            guard let deckType = parameters["deckType"] as? String,
                  supportedDecks.contains(deckType),
                  let cardCount = exactInteger(parameters["cardCount"]),
                  (1...81).contains(cardCount),
                  deckType != "tarot" || cardCount <= 78 else {
                throw BridgeValidationError.invalidParameters
            }
            return .readingCompleted(deckType: deckType, cardCount: cardCount)
        case .fileExportBegin:
            try requireKeys(parameters, ["kind", "name", "byteCount"])
            guard let kind = fileKind(parameters["kind"]),
                  let name = parameters["name"] as? String,
                  isSafeDisplayName(name),
                  let byteCount = exactInteger(parameters["byteCount"]),
                  (0...(kind == .qsp ? maximumQSPBytes : maximumTransferBytes)).contains(byteCount) else {
                throw BridgeValidationError.invalidParameters
            }
            return .exportBegin(kind: kind, name: name, byteCount: byteCount)
        case .fileExportChunk:
            try requireKeys(parameters, ["transferID", "offset", "base64"])
            guard let transferID = transferID(parameters["transferID"]),
                  let offset = exactInteger(parameters["offset"]),
                  (0...maximumTransferBytes).contains(offset),
                  let encoded = parameters["base64"] as? String,
                  let decoded = Data(base64Encoded: encoded),
                  decoded.count <= maximumChunkBytes,
                  decoded.base64EncodedString() == encoded else {
                throw BridgeValidationError.invalidParameters
            }
            return .exportChunk(transferID: transferID, offset: offset, data: decoded)
        case .fileExportFinish:
            try requireKeys(parameters, ["transferID", "action"])
            guard let transferID = transferID(parameters["transferID"]),
                  let action = parameters["action"] as? String,
                  action == "save" || action == "share" else {
                throw BridgeValidationError.invalidParameters
            }
            return .exportFinish(transferID: transferID, action: action)
        case .fileImport:
            try requireKeys(parameters, ["kind"])
            guard let kind = fileKind(parameters["kind"]) else { throw BridgeValidationError.invalidParameters }
            return .fileImport(kind: kind)
        case .fileImportRead:
            try requireKeys(parameters, ["transferID", "offset", "length"])
            guard let transferID = transferID(parameters["transferID"]),
                  let offset = exactInteger(parameters["offset"]),
                  (0...maximumTransferBytes).contains(offset),
                  let length = exactInteger(parameters["length"]),
                  (1...maximumChunkBytes).contains(length) else {
                throw BridgeValidationError.invalidParameters
            }
            return .importRead(transferID: transferID, offset: offset, length: length)
        case .fileTransferCancel, .fileImportFinish:
            try requireKeys(parameters, ["transferID"])
            guard let transferID = transferID(parameters["transferID"]) else {
                throw BridgeValidationError.invalidParameters
            }
            return .transferID(transferID)
        }
    }

    private static func requireKeys(_ parameters: [String: Any], _ keys: Set<String>) throws {
        guard Set(parameters.keys) == keys else { throw BridgeValidationError.invalidParameters }
    }

    private static func exactBool(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }

    private static func exactInteger(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        guard double.isFinite, double.rounded(.towardZero) == double,
              double >= Double(Int.min), double <= Double(Int.max) else { return nil }
        return Int(double)
    }

    private static func fileKind(_ value: Any?) -> BridgeFileKind? {
        guard let raw = value as? String else { return nil }
        return BridgeFileKind(rawValue: raw)
    }

    private static func transferID(_ value: Any?) -> String? {
        guard let raw = value as? String, let uuid = UUID(uuidString: raw) else { return nil }
        let canonical = uuid.uuidString.lowercased()
        return raw == canonical ? canonical : nil
    }

    private static func isSafeDisplayName(_ name: String) -> Bool {
        guard (1...128).contains(name.utf8.count),
              name == name.trimmingCharacters(in: .whitespacesAndNewlines) else { return false }
        return !name.hasPrefix(".") && !name.contains("/") && !name.contains("\\")
            && !name.contains(":") && !name.contains("\0")
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

protocol BridgeCodedError: Error {
    var bridgeCode: String { get }
}

private enum BridgeTimeoutError: Error { case elapsed }

private final class BridgeOperationRace {
    enum Outcome {
        case success([String: Any])
        case failure(Error)
    }

    private let lock = NSLock()
    private var isFinished = false
    private var continuation: CheckedContinuation<Outcome, Never>?
    private var operationTask: Task<Void, Never>?
    private var timeoutTask: Task<Void, Never>?

    func run(
        request: ValidatedBridgeRequest,
        timeoutNanoseconds: UInt64,
        operation: @escaping BridgeSession.Operation
    ) async -> Outcome {
        await withTaskCancellationHandler(operation: {
            await withCheckedContinuation { continuation in
                start(
                    continuation: continuation,
                    request: request,
                    timeoutNanoseconds: timeoutNanoseconds,
                    operation: operation
                )
            }
        }, onCancel: { [weak self] in
            self?.finish(.failure(CancellationError()))
        })
    }

    private func start(
        continuation: CheckedContinuation<Outcome, Never>,
        request: ValidatedBridgeRequest,
        timeoutNanoseconds: UInt64,
        operation: @escaping BridgeSession.Operation
    ) {
        lock.lock()
        guard !isFinished else {
            lock.unlock()
            continuation.resume(returning: .failure(CancellationError()))
            return
        }
        self.continuation = continuation
        lock.unlock()

        let operationTask = Task { [weak self] in
            do { self?.finish(.success(try await operation(request))) }
            catch { self?.finish(.failure(error)) }
        }
        let timeoutTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: timeoutNanoseconds)
                self?.finish(.failure(BridgeTimeoutError.elapsed))
            } catch {}
        }

        lock.lock()
        self.operationTask = operationTask
        self.timeoutTask = timeoutTask
        let alreadyFinished = isFinished
        lock.unlock()
        if alreadyFinished {
            operationTask.cancel()
            timeoutTask.cancel()
        }
    }

    private func finish(_ outcome: Outcome) {
        lock.lock()
        guard !isFinished else { lock.unlock(); return }
        isFinished = true
        let continuation = self.continuation
        self.continuation = nil
        let operationTask = self.operationTask
        let timeoutTask = self.timeoutTask
        lock.unlock()
        operationTask?.cancel()
        timeoutTask?.cancel()
        continuation?.resume(returning: outcome)
    }
}

final class BridgeSession {
    typealias Operation = (ValidatedBridgeRequest) async throws -> [String: Any]
    typealias Delivery = (BridgeReply) -> Void

    private struct ActiveRequest { let fingerprint: Data; let taskID: UUID }
    private struct CompletedRequest { let fingerprint: Data; let reply: BridgeReply }

    private let lock = NSRecursiveLock()
    private var isRunning = true
    private var generation = UUID()
    private var activeByID: [String: ActiveRequest] = [:]
    private var completedByID: [String: CompletedRequest] = [:]
    private var replayOrder: [String] = []
    private var tasks: [UUID: Task<Void, Never>] = [:]
    private let operation: Operation
    private let delivery: Delivery
    private let maximumInFlight: Int
    private let replayLimit: Int
    private let timeout: (BridgeMethod) -> UInt64

    init(
        maximumInFlight: Int = 16,
        replayLimit: Int = 128,
        timeout: @escaping (BridgeMethod) -> UInt64 = { $0.timeoutNanoseconds },
        operation: @escaping Operation,
        delivery: @escaping Delivery
    ) {
        precondition(maximumInFlight > 0 && replayLimit > 0)
        self.maximumInFlight = maximumInFlight
        self.replayLimit = replayLimit
        self.timeout = timeout
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
        guard isRunning else { lock.unlock(); return }
        if let active = activeByID[request.id] {
            if active.fingerprint != request.canonicalEnvelope {
                delivery(.failure(id: request.id, code: "DUPLICATE_ID"))
            }
            lock.unlock()
            return
        }
        if let completed = completedByID[request.id] {
            delivery(completed.fingerprint == request.canonicalEnvelope
                ? completed.reply : .failure(id: request.id, code: "DUPLICATE_ID"))
            lock.unlock()
            return
        }
        guard activeByID.count < maximumInFlight else {
            delivery(.failure(id: request.id, code: "TOO_MANY_IN_FLIGHT"))
            lock.unlock()
            return
        }
        let expectedGeneration = generation
        let taskID = UUID()
        activeByID[request.id] = ActiveRequest(fingerprint: request.canonicalEnvelope, taskID: taskID)
        let operation = self.operation
        let timeoutNanoseconds = timeout(request.method)
        lock.unlock()

        let task = Task { [weak self] in
            let reply = await Self.execute(request, timeoutNanoseconds: timeoutNanoseconds, operation: operation)
            guard !Task.isCancelled else { return }
            self?.complete(taskID: taskID, request: request, expectedGeneration: expectedGeneration, reply: reply)
        }
        lock.lock()
        if isRunning, generation == expectedGeneration, activeByID[request.id]?.taskID == taskID {
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
        activeByID.removeAll(); completedByID.removeAll(); replayOrder.removeAll(); tasks.removeAll()
        lock.unlock()
        pending.forEach { $0.cancel() }
    }

    func invalidatePendingOperations() {
        lock.lock()
        guard isRunning else { lock.unlock(); return }
        generation = UUID()
        let pending = Array(tasks.values)
        activeByID.removeAll(); completedByID.removeAll(); replayOrder.removeAll(); tasks.removeAll()
        lock.unlock()
        pending.forEach { $0.cancel() }
    }

    private func complete(taskID: UUID, request: ValidatedBridgeRequest, expectedGeneration: UUID, reply: BridgeReply) {
        lock.lock()
        defer { lock.unlock() }
        guard isRunning, generation == expectedGeneration, activeByID[request.id]?.taskID == taskID else { return }
        activeByID.removeValue(forKey: request.id)
        tasks.removeValue(forKey: taskID)
        completedByID[request.id] = CompletedRequest(fingerprint: request.canonicalEnvelope, reply: reply)
        replayOrder.append(request.id)
        while replayOrder.count > replayLimit { completedByID.removeValue(forKey: replayOrder.removeFirst()) }
        delivery(reply)
    }

    private func deliverIfRunning(_ reply: BridgeReply) {
        lock.lock()
        defer { lock.unlock() }
        if isRunning { delivery(reply) }
    }

    private static func execute(
        _ request: ValidatedBridgeRequest,
        timeoutNanoseconds: UInt64,
        operation: @escaping Operation
    ) async -> BridgeReply {
        let outcome = await BridgeOperationRace().run(
            request: request,
            timeoutNanoseconds: timeoutNanoseconds,
            operation: operation
        )
        do {
            let result: [String: Any]
            switch outcome {
            case let .success(value): result = value
            case let .failure(error): throw error
            }
            guard JSONSerialization.isValidJSONObject(result),
                  let encoded = try? JSONSerialization.data(withJSONObject: result),
                  encoded.count <= BridgeValidator.maximumPayloadBytes else {
                return .failure(id: request.id, code: "INVALID_NATIVE_RESULT")
            }
            return .success(id: request.id, result: result)
        } catch BridgeTimeoutError.elapsed {
            return .failure(id: request.id, code: "TIMEOUT")
        } catch is CancellationError {
            return .failure(id: request.id, code: "CANCELLED")
        } catch let error as BridgeCodedError {
            return .failure(id: request.id, code: error.bridgeCode)
        } catch {
            return .failure(id: request.id, code: "NATIVE_FAILURE")
        }
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
    private let operation: BridgeSession.Operation
    private var documentGeneration = 0
    private var documentURL: URL?

    init(webView: WKWebView, operation: @escaping BridgeSession.Operation) {
        self.webView = webView
        self.operation = operation
        super.init()
        replaceSession()
    }

    func beginNavigation(to url: URL?) {
        dispatchPrecondition(condition: .onQueue(.main))
        documentGeneration &+= 1
        documentURL = url.flatMap { BridgeContext.isTrustedDocumentURL($0) ? $0 : nil }
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
        session = BridgeSession(operation: operation, delivery: { [weak self] reply in
            Task { @MainActor [weak self] in
                await self?.deliver(reply, expectedGeneration: expectedGeneration)
            }
        })
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        let components = message.frameInfo.request.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }
        session.handle(body: message.body, context: BridgeContext(
            isMainFrame: message.frameInfo.isMainFrame,
            scheme: origin.protocol,
            host: origin.host,
            port: origin.port,
            documentPath: components?.percentEncodedPath ?? "",
            hasQueryOrFragment: components?.query != nil || components?.fragment != nil
        ))
    }

    func stop() {
        session.stop()
        webView = nil
    }

    @MainActor
    private func deliver(_ reply: BridgeReply, expectedGeneration: Int) async {
        guard expectedGeneration == documentGeneration,
              let expectedURL = documentURL,
              let webView,
              let currentURL = webView.url,
              currentURL.absoluteString == expectedURL.absoluteString else { return }
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
            // A navigation or process exit invalidates this document. Replies never cross generations.
        }
    }
}
