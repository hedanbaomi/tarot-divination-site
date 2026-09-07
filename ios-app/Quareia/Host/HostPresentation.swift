import UIKit
import UniformTypeIdentifiers

func tracePublicHostUI(_ event: StaticString) {
    #if PUBLIC_TESTING
    NSLog("IOS_UI_STATE %@", String(describing: event))
    #endif
}

enum HostPresentationOutcome: String, Equatable {
    case success, cancelled, failure
}

struct HostFileSelection {
    let outcome: HostPresentationOutcome
    let url: URL?
}

struct HostAnnouncementListSelection {
    let outcome: HostPresentationOutcome
    let selectedToken: String?
}

struct HostModalAction: Equatable {
    let identifier: String
    let title: String
    let value: String
}

struct HostModal: Equatable {
    let accessibilityIdentifier: String
    let title: String
    let message: String
    let actions: [HostModalAction]
}

@MainActor
private final class HostDownloadTaskHolder {
    private var task: Task<Void, Never>?
    private var cancelled = false

    func install(_ task: Task<Void, Never>) {
        self.task = task
        if cancelled { task.cancel() }
    }

    func cancel() {
        cancelled = true
        task?.cancel()
    }
}

@MainActor
protocol HostPresentationCoordinating: AnyObject {
    var isActiveForeground: Bool { get }
    func presentModal(_ modal: HostModal) async throws -> String
    func presentAnnouncementList(
        title: String,
        announcements: [HostAnnouncementValue],
        closeTitle: String,
        openTitle: String
    ) async throws -> HostAnnouncementListSelection
    func presentImport(kind: BridgeFileKind, accessibilityIdentifier: String) async throws -> HostFileSelection
    func presentExport(url: URL, name: String, action: String, accessibilityIdentifier: String) async throws -> HostPresentationOutcome
    func presentUpdateDownload(
        title: String,
        cancelTitle: String,
        accessibilityIdentifier: String,
        operation: @escaping (@escaping (Double) -> Void) async throws -> URL
    ) async throws -> HostFileSelection
    func openExternalHTTPS(_ url: URL)
    func cancelActivePresentation()
}

@MainActor
final class HostPresentationCoordinator: NSObject, HostPresentationCoordinating, UIDocumentPickerDelegate,
    UIAdaptivePresentationControllerDelegate {
    private weak var viewController: UIViewController?
    private var activeToken: UUID?
    private var activeCancellation: (() -> Void)?
    private var pickerCompletion: ((HostFileSelection) -> Void)?
    private var pickerIsImport = false

    init(viewController: UIViewController) {
        self.viewController = viewController
    }

    var isActiveForeground: Bool {
        UIApplication.shared.applicationState == .active && viewController?.viewIfLoaded?.window != nil
    }

    func presentModal(_ modal: HostModal) async throws -> String {
        guard isActiveForeground, let presenter = topPresenter(), activeToken == nil else {
            throw NativeHostError.presentationBusy
        }
        let token = UUID()
        activeToken = token
        return await withTaskCancellationHandler(operation: {
            await withCheckedContinuation { continuation in
                let controller = HostModalViewController(modal: modal) { [weak self] value in
                    guard let self, self.activeToken == token else { return }
                    self.clearActive()
                    presenter.dismiss(animated: !UIAccessibility.isReduceMotionEnabled) {
                        continuation.resume(returning: value)
                    }
                }
                controller.presentationController?.delegate = self
                activeCancellation = { [weak self, weak controller] in
                    guard let self, self.activeToken == token else { return }
                    self.clearActive()
                    controller?.dismiss(animated: false)
                    continuation.resume(returning: "cancelled")
                }
                presenter.present(controller, animated: !UIAccessibility.isReduceMotionEnabled)
                controller.presentationController?.delegate = self
            }
        }, onCancel: { [weak self] in
            Task { @MainActor in self?.cancelActivePresentation() }
        })
    }

    func presentAnnouncementList(
        title: String,
        announcements: [HostAnnouncementValue],
        closeTitle: String,
        openTitle: String
    ) async throws -> HostAnnouncementListSelection {
        guard isActiveForeground, let presenter = topPresenter(), activeToken == nil else {
            throw NativeHostError.presentationBusy
        }
        let token = UUID()
        activeToken = token
        return await withTaskCancellationHandler(operation: {
            await withCheckedContinuation { continuation in
                let finish: (HostAnnouncementListSelection) -> Void = { [weak self] selection in
                    guard let self, self.activeToken == token else { return }
                    self.clearActive()
                    presenter.dismiss(animated: !UIAccessibility.isReduceMotionEnabled) {
                        continuation.resume(returning: selection)
                    }
                }
                let controller = HostAnnouncementListViewController(
                    titleText: title,
                    announcements: announcements,
                    closeTitle: closeTitle,
                    openTitle: openTitle,
                    selection: { selectedToken in
                        finish(.init(outcome: .success, selectedToken: selectedToken))
                    }
                )
                activeCancellation = { [weak self, weak controller] in
                    guard let self, self.activeToken == token else { return }
                    self.clearActive()
                    controller?.dismiss(animated: false)
                    continuation.resume(returning: .init(outcome: .cancelled, selectedToken: nil))
                }
                presenter.present(controller, animated: !UIAccessibility.isReduceMotionEnabled)
            }
        }, onCancel: { [weak self] in
            Task { @MainActor in self?.cancelActivePresentation() }
        })
    }

    func presentImport(kind: BridgeFileKind, accessibilityIdentifier: String) async throws -> HostFileSelection {
        tracePublicHostUI("import.begin")
        guard isActiveForeground, let presenter = topPresenter(), activeToken == nil else {
            throw NativeHostError.presentationBusy
        }
        let token = UUID()
        activeToken = token
        pickerIsImport = true
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: contentTypes(for: kind), asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        picker.view.accessibilityIdentifier = accessibilityIdentifier
        return await withTaskCancellationHandler(operation: {
            await withCheckedContinuation { continuation in
                pickerCompletion = { [weak self] selection in
                    guard let self, self.activeToken == token else { return }
                    self.clearActive()
                    continuation.resume(returning: selection)
                }
                activeCancellation = { [weak self, weak picker] in
                    guard let self, self.activeToken == token else { return }
                    tracePublicHostUI("picker.cancelled_by_task")
                    self.clearActive()
                    picker?.dismiss(animated: false)
                    continuation.resume(returning: HostFileSelection(outcome: .cancelled, url: nil))
                }
                presenter.present(picker, animated: !UIAccessibility.isReduceMotionEnabled) {
                    tracePublicHostUI("picker.presented")
                }
            }
        }, onCancel: { [weak self] in
            Task { @MainActor in self?.cancelActivePresentation() }
        })
    }

    func presentExport(
        url: URL,
        name: String,
        action: String,
        accessibilityIdentifier: String
    ) async throws -> HostPresentationOutcome {
        if action == "share" {
            return try await presentShare(url: url, accessibilityIdentifier: accessibilityIdentifier)
        }
        guard isActiveForeground, let presenter = topPresenter(), activeToken == nil else {
            throw NativeHostError.presentationBusy
        }
        let token = UUID()
        activeToken = token
        pickerIsImport = false
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        picker.delegate = self
        picker.view.accessibilityIdentifier = accessibilityIdentifier
        return await withTaskCancellationHandler(operation: {
            await withCheckedContinuation { continuation in
                pickerCompletion = { [weak self] selection in
                    guard let self, self.activeToken == token else { return }
                    self.clearActive()
                    continuation.resume(returning: selection.outcome)
                }
                activeCancellation = { [weak self, weak picker] in
                    guard let self, self.activeToken == token else { return }
                    self.clearActive()
                    picker?.dismiss(animated: false)
                    continuation.resume(returning: .cancelled)
                }
                presenter.present(picker, animated: !UIAccessibility.isReduceMotionEnabled)
            }
        }, onCancel: { [weak self] in
            Task { @MainActor in self?.cancelActivePresentation() }
        })
    }

    func presentUpdateDownload(
        title: String,
        cancelTitle: String,
        accessibilityIdentifier: String,
        operation: @escaping (@escaping (Double) -> Void) async throws -> URL
    ) async throws -> HostFileSelection {
        guard isActiveForeground, let presenter = topPresenter(), activeToken == nil else {
            throw NativeHostError.presentationBusy
        }
        let token = UUID()
        activeToken = token
        return await withTaskCancellationHandler(operation: {
            await withCheckedContinuation { continuation in
                let taskHolder = HostDownloadTaskHolder()
                let controller = HostDownloadViewController(titleText: title, cancelTitle: cancelTitle) { [weak self] in
                    guard let self, self.activeToken == token else { return }
                    taskHolder.cancel()
                    self.clearActive()
                    presenter.dismiss(animated: false)
                    continuation.resume(returning: HostFileSelection(outcome: .cancelled, url: nil))
                }
                controller.view.accessibilityIdentifier = accessibilityIdentifier
                activeCancellation = { [weak self, weak controller] in
                    guard let self, self.activeToken == token else { return }
                    taskHolder.cancel()
                    self.clearActive()
                    controller?.dismiss(animated: false)
                    continuation.resume(returning: HostFileSelection(outcome: .cancelled, url: nil))
                }
                presenter.present(controller, animated: !UIAccessibility.isReduceMotionEnabled)
                guard self.activeToken == token else { return }
                let operationTask = Task {
                    do {
                        let url = try await operation { fraction in
                            Task { @MainActor [weak controller] in controller?.setProgress(fraction) }
                        }
                        guard self.activeToken == token else { return }
                        self.clearActive()
                        presenter.dismiss(animated: !UIAccessibility.isReduceMotionEnabled) {
                            continuation.resume(returning: HostFileSelection(outcome: .success, url: url))
                        }
                    } catch is CancellationError {
                        guard self.activeToken == token else { return }
                        self.clearActive()
                        presenter.dismiss(animated: false) {
                            continuation.resume(returning: HostFileSelection(outcome: .cancelled, url: nil))
                        }
                    } catch {
                        guard self.activeToken == token else { return }
                        self.clearActive()
                        presenter.dismiss(animated: !UIAccessibility.isReduceMotionEnabled) {
                            continuation.resume(returning: HostFileSelection(outcome: .failure, url: nil))
                        }
                    }
                }
                taskHolder.install(operationTask)
            }
        }, onCancel: { [weak self] in
            Task { @MainActor in self?.cancelActivePresentation() }
        })
    }

    func openExternalHTTPS(_ url: URL) {
        guard url.scheme == "https", url.host?.isEmpty == false,
              (url.port == nil || url.port == 443), url.user == nil, url.password == nil else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    func cancelActivePresentation() {
        tracePublicHostUI("presentation.cancel_requested")
        activeCancellation?()
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        tracePublicHostUI("picker.cancelled_by_user")
        pickerCompletion?(HostFileSelection(outcome: .cancelled, url: nil))
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if pickerIsImport {
            pickerCompletion?(HostFileSelection(outcome: urls.first == nil ? .failure : .success, url: urls.first))
        } else {
            pickerCompletion?(HostFileSelection(outcome: urls.isEmpty ? .failure : .success, url: nil))
        }
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        activeCancellation?()
    }

    private func presentShare(url: URL, accessibilityIdentifier: String) async throws -> HostPresentationOutcome {
        tracePublicHostUI("share.begin")
        guard isActiveForeground, let presenter = topPresenter(), activeToken == nil else {
            throw NativeHostError.presentationBusy
        }
        let token = UUID()
        activeToken = token
        return await withTaskCancellationHandler(operation: {
            await withCheckedContinuation { continuation in
                let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                activity.view.accessibilityIdentifier = accessibilityIdentifier
                activity.popoverPresentationController?.sourceView = presenter.view
                activity.popoverPresentationController?.sourceRect = CGRect(
                    x: presenter.view.bounds.midX,
                    y: presenter.view.bounds.midY,
                    width: 1,
                    height: 1
                )
                activity.popoverPresentationController?.permittedArrowDirections = []
                activity.completionWithItemsHandler = { [weak self] _, completed, _, error in
                    tracePublicHostUI("share.completed")
                    Task { @MainActor in
                        guard let self, self.activeToken == token else { return }
                        self.clearActive()
                        continuation.resume(returning: error != nil ? .failure : (completed ? .success : .cancelled))
                    }
                }
                activeCancellation = { [weak self, weak activity] in
                    guard let self, self.activeToken == token else { return }
                    tracePublicHostUI("share.cancelled_by_task")
                    self.clearActive()
                    activity?.dismiss(animated: false)
                    continuation.resume(returning: .cancelled)
                }
                presenter.present(activity, animated: !UIAccessibility.isReduceMotionEnabled) {
                    tracePublicHostUI("share.presented")
                }
            }
        }, onCancel: { [weak self] in
            Task { @MainActor in self?.cancelActivePresentation() }
        })
    }

    private func contentTypes(for kind: BridgeFileKind) -> [UTType] {
        switch kind {
        case .history, .backup: return [.json]
        case .qsp: return [.plainText]
        }
    }

    private func topPresenter() -> UIViewController? {
        var current = viewController
        while let presented = current?.presentedViewController { current = presented }
        return current
    }

    private func clearActive() {
        activeToken = nil
        activeCancellation = nil
        pickerCompletion = nil
        pickerIsImport = false
    }
}

@MainActor
private final class HostModalViewController: UIViewController {
    private let modal: HostModal
    private let selection: (String) -> Void

    init(modal: HostModal, selection: @escaping (String) -> Void) {
        self.modal = modal
        self.selection = selection
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .formSheet
        isModalInPresentation = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    override func loadView() {
        let root = UIView()
        root.backgroundColor = .systemGroupedBackground
        root.accessibilityIdentifier = modal.accessibilityIdentifier
        root.accessibilityViewIsModal = true

        let title = UILabel()
        title.text = modal.title
        title.font = .preferredFont(forTextStyle: .title1)
        title.adjustsFontForContentSizeCategory = true
        title.numberOfLines = 0
        title.textAlignment = .center

        let message = UILabel()
        message.text = modal.message
        message.font = .preferredFont(forTextStyle: .body)
        message.adjustsFontForContentSizeCategory = true
        message.numberOfLines = 0
        message.textAlignment = .natural

        let stack = UIStackView(arrangedSubviews: [title, message])
        stack.axis = .vertical
        stack.alignment = .fill
        stack.spacing = 20
        for action in modal.actions {
            let button = UIButton(type: .system)
            var configuration = UIButton.Configuration.filled()
            configuration.title = action.title
            configuration.cornerStyle = .medium
            button.configuration = configuration
            button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
            button.titleLabel?.adjustsFontForContentSizeCategory = true
            button.accessibilityIdentifier = action.identifier
            button.addAction(UIAction { [weak self] _ in self?.selection(action.value) }, for: .touchUpInside)
            stack.addArrangedSubview(button)
        }
        stack.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: root.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: root.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            stack.centerXAnchor.constraint(equalTo: root.safeAreaLayoutGuide.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: root.safeAreaLayoutGuide.centerYAnchor),
            stack.topAnchor.constraint(greaterThanOrEqualTo: root.safeAreaLayoutGuide.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: root.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 620)
        ])
        view = root
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .default }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .all }

    override func accessibilityPerformEscape() -> Bool {
        guard let close = modal.actions.last else { return false }
        selection(close.value)
        return true
    }
}

@MainActor
private final class HostAnnouncementListViewController: UIViewController {
    private let titleText: String
    private let announcements: [HostAnnouncementValue]
    private let closeTitle: String
    private let openTitle: String
    private let selection: (String?) -> Void

    init(
        titleText: String,
        announcements: [HostAnnouncementValue],
        closeTitle: String,
        openTitle: String,
        selection: @escaping (String?) -> Void
    ) {
        self.titleText = titleText
        self.announcements = announcements
        self.closeTitle = closeTitle
        self.openTitle = openTitle
        self.selection = selection
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .formSheet
        isModalInPresentation = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    override func loadView() {
        let root = UIView()
        root.backgroundColor = .systemGroupedBackground
        root.accessibilityIdentifier = "host.announcements"
        root.accessibilityViewIsModal = true

        let title = UILabel()
        title.text = titleText
        title.font = .preferredFont(forTextStyle: .title1)
        title.adjustsFontForContentSizeCategory = true
        title.textAlignment = .center
        title.numberOfLines = 0

        let content = UIStackView()
        content.axis = .vertical
        content.spacing = 16
        content.isLayoutMarginsRelativeArrangement = true
        content.directionalLayoutMargins = .init(top: 8, leading: 20, bottom: 8, trailing: 20)
        for (index, announcement) in announcements.enumerated() {
            let itemTitle = UILabel()
            itemTitle.text = announcement.title
            itemTitle.font = .preferredFont(forTextStyle: .headline)
            itemTitle.adjustsFontForContentSizeCategory = true
            itemTitle.numberOfLines = 0
            let body = UILabel()
            body.text = announcement.message
            body.font = .preferredFont(forTextStyle: .body)
            body.adjustsFontForContentSizeCategory = true
            body.numberOfLines = 0
            let item = UIStackView(arrangedSubviews: [itemTitle, body])
            item.axis = .vertical
            item.spacing = 8
            item.isLayoutMarginsRelativeArrangement = true
            item.directionalLayoutMargins = .init(top: 16, leading: 16, bottom: 16, trailing: 16)
            item.backgroundColor = .secondarySystemGroupedBackground
            item.layer.cornerRadius = 12
            item.accessibilityIdentifier = "announcement.item.\(index)"
            if announcement.action != .none {
                let open = UIButton(type: .system)
                var configuration = UIButton.Configuration.bordered()
                configuration.title = openTitle
                open.configuration = configuration
                open.accessibilityIdentifier = "announcement.update"
                open.addAction(UIAction { [weak self] _ in self?.selection(announcement.token) }, for: .touchUpInside)
                item.addArrangedSubview(open)
            }
            content.addArrangedSubview(item)
        }

        let scroll = UIScrollView()
        scroll.alwaysBounceVertical = true
        scroll.addSubview(content)
        content.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            content.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            content.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            content.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor)
        ])

        let close = UIButton(type: .system)
        var closeConfiguration = UIButton.Configuration.filled()
        closeConfiguration.title = closeTitle
        close.configuration = closeConfiguration
        close.accessibilityIdentifier = "announcement.dismiss"
        close.addAction(UIAction { [weak self] _ in self?.selection(nil) }, for: .touchUpInside)

        let layout = UIStackView(arrangedSubviews: [title, scroll, close])
        layout.axis = .vertical
        layout.spacing = 16
        layout.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(layout)
        NSLayoutConstraint.activate([
            layout.leadingAnchor.constraint(greaterThanOrEqualTo: root.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            layout.trailingAnchor.constraint(lessThanOrEqualTo: root.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            layout.centerXAnchor.constraint(equalTo: root.safeAreaLayoutGuide.centerXAnchor),
            layout.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor, constant: 16),
            layout.bottomAnchor.constraint(equalTo: root.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            layout.widthAnchor.constraint(lessThanOrEqualToConstant: 700),
            scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 240)
        ])
        view = root
    }

    override func accessibilityPerformEscape() -> Bool {
        selection(nil)
        return true
    }
}

@MainActor
private final class HostDownloadViewController: UIViewController {
    private let titleText: String
    private let cancelTitle: String
    private let cancellation: () -> Void
    private let progressView = UIProgressView(progressViewStyle: .default)
    private let progressLabel = UILabel()

    init(titleText: String, cancelTitle: String, cancellation: @escaping () -> Void) {
        self.titleText = titleText
        self.cancelTitle = cancelTitle
        self.cancellation = cancellation
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .formSheet
        isModalInPresentation = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    override func loadView() {
        let root = UIView()
        root.backgroundColor = .systemGroupedBackground
        root.accessibilityViewIsModal = true
        let title = UILabel()
        title.text = titleText
        title.font = .preferredFont(forTextStyle: .title2)
        title.adjustsFontForContentSizeCategory = true
        title.textAlignment = .center
        progressLabel.text = "0%"
        progressLabel.font = .preferredFont(forTextStyle: .body)
        progressLabel.adjustsFontForContentSizeCategory = true
        progressLabel.textAlignment = .center
        progressLabel.accessibilityIdentifier = "host.update.progress"
        let cancel = UIButton(type: .system)
        var configuration = UIButton.Configuration.filled()
        configuration.title = cancelTitle
        cancel.configuration = configuration
        cancel.accessibilityIdentifier = "host.update.cancel"
        cancel.addAction(UIAction { [weak self] _ in self?.cancellation() }, for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [title, progressView, progressLabel, cancel])
        stack.axis = .vertical
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: root.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: root.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: root.safeAreaLayoutGuide.centerYAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 620)
        ])
        view = root
    }

    func setProgress(_ fraction: Double) {
        let bounded = min(max(fraction, 0), 1)
        progressView.setProgress(Float(bounded), animated: !UIAccessibility.isReduceMotionEnabled)
        progressLabel.text = NumberFormatter.localizedString(from: NSNumber(value: bounded), number: .percent)
        progressView.accessibilityValue = progressLabel.text
    }

    override func accessibilityPerformEscape() -> Bool {
        cancellation()
        return true
    }
}
