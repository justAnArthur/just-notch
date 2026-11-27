/// Every service the host wires at launch.
public enum ServiceRegistry {
    @MainActor public static func makeAll() -> [NotchService] {
        [
            PowerService(),
            AwakeService(),
            AudioService(),
            AudioDevicesService(),
            ScreenTextService(),
            TranslateService(),
            DisplayService(),
            HUDService(),
            MediaService(),
            CalendarService(),
            BluetoothService(),
            StatsService(),
            FilesService(),
            WeatherService(),
            ClipboardService(),
            AppsService(),
            FileSearchService(),
            RatesService(),
            ActionsService(),
            WindowsService(),
            RecentFilesService(),
            SystemService(),
        ]
    }
}
