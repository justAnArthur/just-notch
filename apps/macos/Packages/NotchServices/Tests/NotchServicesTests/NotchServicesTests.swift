import AppKit
import Foundation
import Testing
@testable import NotchServices

private func keys(_ value: some Encodable) throws -> Set<String> {
    let data = try #require(value.json())
    let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    return Set(object.keys)
}

@Suite("JSON shapes match packages/bridge-schema") @MainActor
struct ShapeTests {
    @Test func media() throws {
        let full = MediaState(playing: true, title: "t", artist: "a", album: "b", artworkUrl: "data:", durationS: 1, positionS: 0, rate: 1, updatedAt: 1, sourceApp: "x")
        #expect(try keys(full) == ["playing", "title", "artist", "album", "artworkUrl", "durationS", "positionS", "rate", "updatedAt", "sourceApp"])
        var bare = full
        bare.artworkUrl = nil
        bare.sourceApp = nil
        #expect(try keys(bare) == ["playing", "title", "artist", "album", "durationS", "positionS", "rate", "updatedAt"])
    }

    @Test func power() throws {
        let state = PowerState(percent: 80, charging: true, pluggedIn: true, minutesRemaining: 30, lowPowerMode: false, hasBattery: true)
        #expect(try keys(state) == ["percent", "charging", "pluggedIn", "minutesRemaining", "lowPowerMode", "hasBattery"])
        #expect(try keys(PluggedEvent(pluggedIn: true)) == ["pluggedIn"])
    }

    @Test func audio() throws {
        #expect(try keys(AudioState(volume: 0.5, muted: false, outputDevice: "x")) == ["volume", "muted", "outputDevice"])
    }

    @Test func calendar() throws {
        let event = CalendarEvent(id: "1", title: "t", start: 1, end: 2, allDay: false, calendarColor: "#ffffff", location: "l", meetingUrl: "u")
        #expect(try keys(event) == ["id", "title", "start", "end", "allDay", "calendarColor", "location", "meetingUrl"])
        #expect(try keys(CalendarState(access: .granted, upcoming: [event])) == ["access", "upcoming"])
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let data = try encoder.encode(CalendarState(access: .undetermined, upcoming: []))
        #expect(String(decoding: data, as: UTF8.self) == #"{"access":"undetermined","upcoming":[]}"#)
    }

    @Test func bluetooth() throws {
        let device = BluetoothDevice(id: "a", name: "n", kind: .headphones, connected: true, batteryPercent: 50)
        #expect(try keys(device) == ["id", "name", "kind", "connected", "batteryPercent"])
    }

    @Test func stats() throws {
        let state = StatsState(cpu: 0, memoryUsed: 0, memoryTotal: 0, memoryPressure: .normal, netInBps: 0, netOutBps: 0, diskFree: 0, diskTotal: 0, uptimeS: 0)
        #expect(try keys(state) == ["cpu", "memoryUsed", "memoryTotal", "memoryPressure", "netInBps", "netOutBps", "diskFree", "diskTotal", "uptimeS"])
        #expect(try keys(ProcessSample(pid: 1, name: "x", cpu: 0, memory: 0)) == ["pid", "name", "cpu", "memory"])
    }

    @Test func weather() throws {
        let state = WeatherState(access: .granted, status: .ready, setting: .auto, hours: [], days: [])
        #expect(try keys(state) == ["access", "status", "setting", "hours", "days"])
        #expect(try keys(WeatherLocation.auto) == ["mode"])
        #expect(try keys(WeatherLocation(mode: .city, city: "Oslo")) == ["mode", "city"])
    }

    @Test func clipboard() throws {
        let clip = Clip(id: "1", kind: .text, content: "x", copiedAt: 1, pinned: false)
        #expect(try keys(clip) == ["id", "kind", "content", "copiedAt", "pinned"])
        #expect(try keys(ClipboardState(clips: [], paused: false, ignoredApps: [])) == ["clips", "paused", "ignoredApps"])
        #expect(try keys(AppInfo(bundleId: "a", name: "A", icon: "data:")) == ["bundleId", "name", "icon"])
    }

    @Test func recentFiles() throws {
        let file = RecentFile(id: "/a", name: "a", size: 1, addedAt: 1, source: .downloads, from: "example.com")
        #expect(try keys(file) == ["id", "name", "size", "addedAt", "source", "from"])
        #expect(try keys(RecentFilesState(access: .granted, files: [], downloads: [])) == ["access", "files", "downloads"])
    }

    @Test func display() throws {
        #expect(try keys(DisplayState(brightness: 0.5, keyboardBacklight: 0.25)) == ["brightness", "keyboardBacklight"])
        #expect(try keys(DisplayState(brightness: 0.5)) == ["brightness"])
    }

    @Test func hud() throws {
        #expect(try keys(HUDEvent(kind: .volume, value: 0.5, muted: false)) == ["kind", "value", "muted"])
        #expect(try keys(HUDEvent(kind: .brightness, value: 0.5)) == ["kind", "value"])
    }

    @Test func mediaCommand() throws {
        #expect(try decode(MediaCommand.self, Data(#"{"command":"toggle"}"#.utf8)) == .toggle)
        #expect(try decode(MediaCommand.self, Data(#"{"command":"seek","positionS":12.5}"#.utf8)) == .seek(positionS: 12.5))
        #expect(throws: ServiceError.self) { try decode(MediaCommand.self, Data(#"{"command":"rewind"}"#.utf8)) }
    }

    @Test func bridgeLine() throws {
        let line = #"{"title":"T","artist":"A","album":"B","durationS":165.8,"positionS":0.2,"rate":1,"playing":true,"timestamp":1794482201587,"bundleId":"app.zen-browser.zen","artworkCleared":true}"#
        let raw = try JSONDecoder().decode(RawNowPlaying.self, from: Data(line.utf8))
        #expect(raw.bundleId == "app.zen-browser.zen")
        #expect(raw.artwork == nil)
        #expect(raw.artworkCleared == true)
    }
}

@Suite @MainActor struct MeetingURLTests {
    @Test func findsProviders() {
        #expect(MeetingURL.extract(from: [nil, "Room 4", "Join: https://us02web.zoom.us/j/123456?pwd=abc thanks"]) == "https://us02web.zoom.us/j/123456?pwd=abc")
        #expect(MeetingURL.extract(from: ["https://meet.google.com/abc-defg-hij"]) == "https://meet.google.com/abc-defg-hij")
        #expect(MeetingURL.extract(from: [nil, nil, "<https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0>"]) == "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0")
        #expect(MeetingURL.extract(from: ["https://acme.webex.com/meet/jane"]) == "https://acme.webex.com/meet/jane")
    }

    @Test func prefersEarlierFields() {
        #expect(MeetingURL.extract(from: ["https://meet.google.com/aaa-bbbb-ccc", nil, "https://zoom.us/j/1"]) == "https://meet.google.com/aaa-bbbb-ccc")
    }

    @Test func ignoresOthers() {
        #expect(MeetingURL.extract(from: ["https://example.com/j/1", "https://zoom.us", "no links here"]) == nil)
        #expect(MeetingURL.extract(from: ["https://notzoom.us.evil.com/j/1"]) == nil)
    }
}

@Suite @MainActor struct MathTests {
    @Test func cpuDelta() {
        let a = CPUTicks(user: 100, system: 50, idle: 800, nice: 50)
        let b = CPUTicks(user: 160, system: 70, idle: 900, nice: 70)
        #expect(CPUTicks.usage(from: a, to: b) == 0.5)
        #expect(CPUTicks.usage(from: a, to: a) == 0)
    }

    @Test func cpuWraps() {
        let a = CPUTicks(user: .max - 9, system: 0, idle: 0, nice: 0)
        let b = CPUTicks(user: 10, system: 0, idle: 20, nice: 0)
        #expect(CPUTicks.usage(from: a, to: b) == 0.5)
    }

    @Test func netDeltaWrapsAndSkipsNewInterfaces() {
        let old = ["en0": NetCounters(bytesIn: .max - 99, bytesOut: 1000)]
        let new = ["en0": NetCounters(bytesIn: 100, bytesOut: 1500), "utun3": NetCounters(bytesIn: 9999, bytesOut: 9999)]
        let moved = NetCounters.delta(from: old, to: new)
        #expect(moved.bytesIn == 200)
        #expect(moved.bytesOut == 500)
    }

    @Test func hudSteps() {
        #expect(HUDService.stepped(0.5, by: 1.0 / 16, step: 1.0 / 16) == 0.5625)
        #expect(HUDService.stepped(0.51, by: -1.0 / 16, step: 1.0 / 16) == 0.4375)
        #expect(HUDService.stepped(0.99, by: 1.0 / 16, step: 1.0 / 16) == 1)
        #expect(HUDService.stepped(0.01, by: -1.0 / 64, step: 1.0 / 64) == 0)
    }

    @Test func mediaKeys() {
        #expect(MediaKey.press(data1: 0x0000_0A00) == MediaKey.Press(key: .soundUp, down: true))
        #expect(MediaKey.press(data1: 0x0007_0B00) == MediaKey.Press(key: .mute, down: false))
        #expect(MediaKey.press(data1: 0x0010_0A00) == nil)
    }

    @Test func bluetoothKinds() {
        #expect(BluetoothKind.kind(major: 0x04, minor: 0x06) == .headphones)
        #expect(BluetoothKind.kind(major: 0x04, minor: 0x05) == .speaker)
        #expect(BluetoothKind.kind(major: 0x05, minor: 0x10) == .keyboard)
        #expect(BluetoothKind.kind(major: 0x05, minor: 0x20) == .mouse)
        #expect(BluetoothKind.kind(major: 0x01, minor: 0x00) == .other)
    }

    @Test func calendarHex() {
        #expect(CalendarService.hex(NSColor(srgbRed: 1, green: 0.5, blue: 0, alpha: 1)) == "#ff8000")
        #expect(CalendarService.hex(nil) == "#808080")
    }

    @Test func mediaContinuation() {
        let old = MediaState(playing: true, title: "t", artist: "a", album: "b", durationS: 200, positionS: 10, rate: 1, updatedAt: 0)
        var later = old
        later.positionS = 12
        later.updatedAt = 2000
        #expect(later.continues(old))
        later.positionS = 40
        #expect(!later.continues(old))
        var paused = old
        paused.playing = false
        #expect(!paused.continues(old))
    }
}

@Suite struct ArtworkTests {
    @Test func downscalesToJPEG() throws {
        let image = NSImage(size: NSSize(width: 1000, height: 500), flipped: false) { rect in
            NSColor.systemRed.setFill()
            rect.fill()
            return true
        }
        let tiff = try #require(image.tiffRepresentation)
        let png = try #require(NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]))
        let url = try #require(artworkDataURL(png))
        #expect(url.hasPrefix("data:image/jpeg;base64,"))
        let jpeg = try #require(Data(base64Encoded: String(url.dropFirst("data:image/jpeg;base64,".count))))
        let rep = try #require(NSBitmapImageRep(data: jpeg))
        #expect(max(rep.pixelsWide, rep.pixelsHigh) == 300)
    }
}

@MainActor private final class FakeBackend: MediaBackend {
    let name = "fake"
    var onChange: ((RawNowPlaying?) -> Void)?
    var onFailure: (() -> Void)?
    var sent: [MediaCommand] = []
    var stopped = false
    func start() {}
    func stop() { stopped = true }
    func send(_ command: MediaCommand) { sent.append(command) }
}

@Suite @MainActor struct MediaCommandTests {
    @Test func worksWithoutSubscriber() async throws {
        let backend = FakeBackend()
        var picks = 0
        let service = MediaService { _ in
            picks += 1
            return backend
        }
        _ = try await service.handle(method: "media.command", params: Data(#"{"command":"toggle"}"#.utf8))
        _ = try await service.handle(method: "media.command", params: Data(#"{"command":"seek","positionS":3}"#.utf8))
        #expect(backend.sent == [.toggle, .seek(positionS: 3)])
        #expect(picks == 1)
        #expect(!backend.stopped)
    }
}

@MainActor private final class RecordingSink: ServiceSink {
    var published: [String: [Data]] = [:]
    func publish(topic: String, value: Data) { published[topic, default: []].append(value) }
    func emit(event: String, payload: Data) {}
}

@Suite @MainActor struct StatsTests {
    @Test func publishesFirstSampleWithinASecondAndAHalf() async throws {
        let sink = RecordingSink()
        let service = StatsService()
        service.sink = sink
        service.start(topic: "stats")
        defer { service.stop(topic: "stats") }
        #expect(await service.snapshot(topic: "stats") == nil)
        try await Task.sleep(for: .milliseconds(1500))
        let first = try #require(sink.published["stats"]?.first)
        let state = try JSONDecoder().decode(StatsState.self, from: first)
        #expect(state.memoryTotal > 0)
        #expect(await service.snapshot(topic: "stats") != nil)
    }
}

@Suite @MainActor struct MediaArtworkTests {
    private static let png: Data = {
        let image = NSImage(size: NSSize(width: 4, height: 4))
        image.lockFocus()
        NSColor.red.setFill()
        NSRect(x: 0, y: 0, width: 4, height: 4).fill()
        image.unlockFocus()
        return NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
    }()

    private func raw(_ title: String, album: String = "B", artwork: Data? = nil) -> RawNowPlaying {
        RawNowPlaying(title: title, artist: "A", album: album, durationS: 100, positionS: 1, rate: 1, playing: true,
                      timestamp: 0, bundleId: nil, artwork: artwork, artworkCleared: artwork == nil)
    }

    private func lastArtwork(_ sink: RecordingSink) throws -> String? {
        try JSONDecoder().decode(MediaState?.self, from: try #require(sink.published["media"]?.last))?.artworkUrl
    }

    @Test func keepsArtworkAcrossUpdatesOfTheSameTrack() async throws {
        let backend = FakeBackend()
        let sink = RecordingSink()
        let service = MediaService { _ in backend }
        service.sink = sink
        service.start(topic: "media")
        defer { service.stop(topic: "media") }
        // The service picks its backend on a task.
        for _ in 0..<100 where backend.onChange == nil { await Task.yield() }

        backend.onChange?(raw("One", artwork: Self.png))
        #expect(try lastArtwork(sink) != nil)
        backend.onChange?(raw("One"))
        #expect(try lastArtwork(sink) != nil)
        // A browser filling in the album later is the same track.
        backend.onChange?(raw("One", album: "Later"))
        #expect(try lastArtwork(sink) != nil)
        backend.onChange?(raw("Two"))
        #expect(try lastArtwork(sink) == nil)
    }
}

@Suite("New services") @MainActor
struct NewServiceTests {
    @Test func openMeteoParse() throws {
        let json = """
        {"current":{"time":1700000000,"temperature_2m":7.5,"apparent_temperature":4.1,"weather_code":2,"is_day":1,"wind_speed_10m":14,"relative_humidity_2m":71,"uv_index":1.2},
         "hourly":{"time":[1699995600,1699999200,1700002800],"temperature_2m":[6,7,null],"weather_code":[1,2,3],"precipitation_probability":[0,10,20],"is_day":[1,1,0]},
         "daily":{"time":[1699920000],"weather_code":[61],"temperature_2m_max":[9],"temperature_2m_min":[2],"precipitation_probability_max":[80],"sunrise":[1699941600],"sunset":[1699975200]}}
        """
        let forecast = try WeatherService.parse(Data(json.utf8), now: 1_700_000_000)
        #expect(forecast.current.time == 1_700_000_000_000)
        #expect(forecast.current.isDay)
        // 1699995600 is the hour before; the null-temperature hour is dropped.
        #expect(forecast.hours.map(\.time) == [1_699_999_200_000])
        #expect(forecast.days.first?.code == 61)
        #expect(forecast.days.first?.sunrise == 1_699_941_600_000)
    }

    @Test func clipKinds() {
        #expect(ClipboardService.kind(of: "#FF8800") == .color)
        #expect(ClipboardService.kind(of: " https://example.com/a?b \n") == .link)
        #expect(ClipboardService.kind(of: "see https://example.com") == .text)
        #expect(ClipboardService.kind(of: "file:///tmp/x") == .text)
        #expect(ClipboardService.hex(NSColor(srgbRed: 1, green: 0.5, blue: 0, alpha: 1)) == "#ff8000")
    }

    @Test func busiestProcesses() {
        var old = ProcessTimes()
        old.at = Date(timeIntervalSince1970: 0)
        old.entries = [1: .init(name: "a", cpuNs: 0, memory: 10), 2: .init(name: "b", cpuNs: 0, memory: 20), 3: .init(name: "gone", cpuNs: 0, memory: 0)]
        var new = ProcessTimes()
        new.at = Date(timeIntervalSince1970: 1)
        let cores = Double(ProcessInfo.processInfo.activeProcessorCount)
        new.entries = [1: .init(name: "a", cpuNs: 1e9 * cores / 2, memory: 10), 2: .init(name: "b", cpuNs: 1e9 * cores / 4, memory: 20), 4: .init(name: "new", cpuNs: 5e9, memory: 0)]
        let top = ProcessTimes.top(5, from: old, to: new)
        #expect(top.map(\.name) == ["a", "b"])
        #expect(top.first?.cpu == 0.5)
    }
}

@Suite @MainActor struct InstalledAppsTests {
    private func entry(_ id: String, _ name: String, _ path: String = "/x") -> InstalledApps.Entry {
        .init(app: AppInfo(bundleId: id, name: name), url: URL(fileURLWithPath: path))
    }

    @Test func mergesByBundleIdAndSortsByName() {
        let merged = InstalledApps.merge([entry("b", "Zed", "/running"), entry("a", "arc"), entry("b", "Zed", "/Applications"), entry("c", "Bear 2"), entry("d", "Bear 10")])
        #expect(merged.map(\.app.bundleId) == ["a", "c", "d", "b"])
        #expect(merged.last?.url.path == "/running")
    }

    @Test func listsInstalledAppsWithIcons() async {
        let apps = await InstalledApps.list()
        let safari = apps.first { $0.bundleId == "com.apple.Safari" }
        #expect(safari?.name == "Safari")
        #expect(safari?.icon?.hasPrefix("data:image/png;base64,") == true)
        #expect(Set(apps.map(\.bundleId)).count == apps.count)
    }
}
