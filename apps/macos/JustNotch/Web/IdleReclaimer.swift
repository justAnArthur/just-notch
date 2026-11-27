import AppKit
import Darwin
import WebKit

/// WebKit keeps the memory a busy island used (layer backing stores, its malloc) long after the island goes
/// quiet: 40–48 MB fresh, 100–130 MB after an hour of use. When a panel has shown nothing for a while,
/// this reloads its page, which gives that back. The page has to agree (`window.__notch.idle()`: no
/// activity, flash or open sheet), so a running timer or what's playing is never interrupted; an idle
/// island on a notched display is black on the black notch, so the reload can't be seen.
@MainActor
final class IdleReclaimer {
    static let quietFor: TimeInterval = debugOverride("NOTCH_RECLAIM_AFTER") ?? 10 * 60
    /// Below this the page is about as small as a fresh one; a reload would gain nothing.
    static let threshold = UInt64(debugOverride("NOTCH_RECLAIM_ABOVE_MB") ?? 90) * 1024 * 1024
    static let interval: TimeInterval = min(60, quietFor)

    private static func debugOverride(_ name: String) -> Double? {
        #if DEBUG
        ProcessInfo.processInfo.environment[name].flatMap(Double.init)
        #else
        nil
        #endif
    }

    private let panels: () -> [PanelController]
    private let reload: (WKWebView) -> Void
    private var timer: Timer?

    init(panels: @escaping () -> [PanelController], reload: @escaping (WKWebView) -> Void) {
        self.panels = panels
        self.reload = reload
        timer = Timer.scheduledTimer(withTimeInterval: Self.interval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.check() }
        }
        timer?.tolerance = Self.interval / 4
    }

    private func check() {
        let now = Date()
        for panel in panels() where panel.isQuiet && now.timeIntervalSince(panel.lastActive) >= Self.quietFor {
            // The pill on a display without a notch is visible: it would blink.
            guard panel.geometry.hasNotch || panel.steppedAside || panel.geometry.quiet || panel.geometry.mode == .hidden else { continue }
            let webView = panel.webView
            guard let footprint = Self.footprint(of: webView), footprint > Self.threshold else { continue }
            webView.evaluateJavaScript("window.__notch?.idle?.() === true") { [weak self] result, _ in
                MainActor.assumeIsolated {
                    guard let self, result as? Bool == true, panel.isQuiet, !webView.isLoading else { return }
                    log.info("reclaiming an idle page: \(footprint / 1_048_576, privacy: .public) MB")
                    self.reload(webView)
                }
            }
        }
    }

    /// The physical footprint of the web view's content process, as Activity Monitor's Memory column shows it.
    static func footprint(of webView: WKWebView) -> UInt64? {
        let selector = NSSelectorFromString("_webProcessIdentifier")
        guard webView.responds(to: selector),
              let pid = (webView.value(forKey: "_webProcessIdentifier") as? NSNumber)?.int32Value, pid > 0
        else { return nil }
        var info = rusage_info_v4()
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V4, $0) }
        }
        return result == 0 ? info.ri_phys_footprint : nil
    }
}
