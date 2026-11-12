import AppKit

// A write to a pipe whose reader died (the media bridge helper) must fail with EPIPE, not kill the app.
signal(SIGPIPE, SIG_IGN)

MainActor.assumeIsolated {
    let delegate = AppDelegate()
    let app = NSApplication.shared
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    withExtendedLifetime(delegate) { app.run() }
}
