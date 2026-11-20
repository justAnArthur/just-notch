import AppKit
import Sparkle

/// Sparkle's standard updater: its own windows install, the bridge's `updater.*` checks and follows along.
/// Releases are ad-hoc signed; Sparkle accepts them on the EdDSA signature alone (`SUPublicEDKey`).
@MainActor
final class Updater: NSObject {
    /// Every step of an update session, for the pages (`updater.state`).
    var onState: ((UpdateState) -> Void)?
    /// The status menu's Check for Updates…, renamed while a scheduled check's update waits.
    weak var menuItem: NSMenuItem?

    private var controller: SPUStandardUpdaterController!
    private var checks: [CheckedContinuation<UpdateState, Never>] = []
    private var found: SUAppcastItem?

    /// Builds without a real key (local ones, until the key is generated) never start Sparkle: it would fail loudly.
    private let enabled = (Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String).map { !$0.hasPrefix("__") } ?? false

    override init() {
        super.init()
        controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: self)
        if enabled {
            controller.startUpdater()
        } else {
            log.info("updates off: this build has no Sparkle public key")
        }
    }

    var canCheck: Bool { enabled && controller.updater.canCheckForUpdates }

    /// Sparkle's own scheduled check (once a day), as Settings shows it.
    var automaticChecks: Bool {
        get { enabled && controller.updater.automaticallyChecksForUpdates }
        set { if enabled { controller.updater.automaticallyChecksForUpdates = newValue } }
    }

    /// Downloads a found update in the background and installs it on quit.
    var automaticDownloads: Bool {
        get { enabled && controller.updater.automaticallyDownloadsUpdates }
        set { if enabled { controller.updater.automaticallyDownloadsUpdates = newValue } }
    }

    /// The last check, scheduled or not; nil before the first one.
    var lastChecked: Date? { enabled ? controller.updater.lastUpdateCheckDate : nil }

    /// The standard flow: Sparkle's alert, download and Install and Relaunch.
    func install() {
        guard enabled else { return }
        // An agent app's windows stay behind the frontmost app unless it activates first.
        NSApp.activate(ignoringOtherApps: true)
        controller.checkForUpdates(nil)
    }

    /// Asks the appcast without UI.
    func check() async -> UpdateState {
        guard enabled else { return .error(Self.offMessage) }
        guard controller.updater.canCheckForUpdates else { return .error("An update is already under way.") }
        return await withCheckedContinuation { continuation in
            checks.append(continuation)
            found = nil
            controller.updater.checkForUpdateInformation()
        }
    }

    static let offMessage = "This copy doesn't update itself. Get new versions from the website."

    /// What went wrong, in words a buyer understands; Sparkle's own text goes to the log.
    static func message(for error: NSError) -> String {
        log.error("update: \(error.domain, privacy: .public) \(error.code) \(error.localizedDescription, privacy: .public)")
        let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError
        if error.domain == NSURLErrorDomain || underlying?.domain == NSURLErrorDomain {
            return "Couldn't reach the update server. Check your connection and try again."
        }
        switch error.domain == SUSparkleErrorDomain ? SUError(rawValue: OSStatus(error.code)) : nil {
        case .appcastError, .appcastParseError, .downloadError:
            return "Couldn't reach the update server. Try again later."
        case .signatureError, .validationError:
            return "The update didn't pass its security check, so it wasn't installed. Try again later."
        case .installationWriteNoPermissionError:
            return "Just Notch can't replace itself where it is. Move it to Applications and try again."
        case .installationError, .installationCanceledError, .relaunchError, .unarchivingError:
            return "The update couldn't be installed. Quit Just Notch and try again."
        default:
            return "Something went wrong while updating. Try again later."
        }
    }

    private func available(_ item: SUAppcastItem) -> UpdateState {
        .available(item.displayVersionString, notes: item.itemDescription)
    }

    private func remind(_ item: SUAppcastItem?) {
        menuItem?.title = item.map { "Update to \($0.displayVersionString)…" } ?? "Check for Updates…"
    }
}

extension Updater: SPUUpdaterDelegate {
    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        found = item
    }

    func updater(_ updater: SPUUpdater, userDidMake choice: SPUUserUpdateChoice, forUpdate item: SUAppcastItem, state: SPUUserUpdateState) {
        switch choice {
        case .skip: onState?(.idle)
        case .dismiss: onState?(available(item))
        default: break
        }
    }

    func updater(_ updater: SPUUpdater, willDownloadUpdate item: SUAppcastItem, with request: NSMutableURLRequest) {
        onState?(.downloading(0))
    }

    func updater(_ updater: SPUUpdater, didDownloadUpdate item: SUAppcastItem) {
        onState?(.downloading(1))
    }

    func updater(_ updater: SPUUpdater, willInstallUpdate item: SUAppcastItem) {
        onState?(.ready(item.displayVersionString))
    }

    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: (any Error)?) {
        let error = error as NSError?
        let code = error?.domain == SUSparkleErrorDomain ? error.map { SUError(rawValue: OSStatus($0.code)) } : nil
        let noUpdate = code == .noUpdateError
        // Closing Sparkle's window or putting the install off ends the session without failing it.
        let failure = noUpdate || code == .installationCanceledError || code == .installationAuthorizeLaterError ? nil : error
        guard updateCheck == .updateInformation else {
            if noUpdate { onState?(.idle) } else if let failure { onState?(.error(Self.message(for: failure))) }
            return
        }
        let state: UpdateState = if let failure { .error(Self.message(for: failure)) } else { found.map(available) ?? .idle }
        checks.forEach { $0.resume(returning: state) }
        checks = []
    }
}

/// A status bar app has no Dock icon to badge: a scheduled check's update waits in the status menu instead.
extension Updater: @preconcurrency SPUStandardUserDriverDelegate {
    var supportsGentleScheduledUpdateReminders: Bool { true }

    func standardUserDriverWillHandleShowingUpdate(_ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState) {
        if state.userInitiated { return NSApp.activate(ignoringOtherApps: true) }
        remind(update)
        onState?(available(update))
    }

    func standardUserDriverDidReceiveUserAttention(forUpdate update: SUAppcastItem) {
        remind(nil)
    }

    func standardUserDriverWillFinishUpdateSession() {
        remind(nil)
    }
}
