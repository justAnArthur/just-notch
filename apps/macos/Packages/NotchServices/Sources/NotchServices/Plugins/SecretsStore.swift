import Foundation
import Security

/// Where `SecretsStore` keeps its one blob: the Keychain in the app, memory in tests.
public protocol SecretsBackend: Sendable {
    /// nil when nothing is stored yet.
    func read() throws -> Data?
    /// nil deletes the stored blob.
    func write(_ data: Data?) throws
}

/// Every plugin's secrets as ONE JSON map `{pluginId: {key: value}}` in a single Keychain item.
///
/// The app is ad-hoc signed, so its items live in the legacy file keychain, whose access lists are bound to
/// the code hash: after each update macOS asks once per item. One item means one prompt per update.
public actor SecretsStore {
    public static let maxValueBytes = 64 * 1024
    private static let keyPattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9._-]{1,64}$")

    private let backend: SecretsBackend
    private var cache: [String: [String: String]]?

    public init(backend: SecretsBackend = KeychainSecretsBackend()) {
        self.backend = backend
    }

    public func get(plugin: String, key: String) throws -> String? {
        try Self.validate(key)
        return try map()[plugin]?[key]
    }

    public func set(plugin: String, key: String, value: String) throws {
        try Self.validate(key)
        guard value.utf8.count <= Self.maxValueBytes else { throw ServiceError("a secret is at most 64 KB") }
        var map = try map()
        map[plugin, default: [:]][key] = value
        try save(map)
    }

    public func delete(plugin: String, key: String) throws {
        try Self.validate(key)
        var map = try map()
        guard map[plugin]?.removeValue(forKey: key) != nil else { return }
        if map[plugin]?.isEmpty == true { map[plugin] = nil }
        try save(map)
    }

    public func deleteAll(plugin: String) throws {
        var map = try map()
        guard map.removeValue(forKey: plugin) != nil else { return }
        try save(map)
    }

    private func map() throws -> [String: [String: String]] {
        if let cache { return cache }
        let stored = try backend.read().map { try JSONDecoder().decode([String: [String: String]].self, from: $0) } ?? [:]
        cache = stored
        return stored
    }

    private func save(_ map: [String: [String: String]]) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        try backend.write(map.isEmpty ? nil : try encoder.encode(map))
        cache = map
    }

    private static func validate(_ key: String) throws {
        guard keyPattern.firstMatch(in: key, range: NSRange(key.startIndex..., in: key)) != nil else {
            throw ServiceError("secret keys match ^[A-Za-z0-9._-]{1,64}$ (got \(key))")
        }
    }
}

/// One generic-password item: service `com.justanarthur.justnotch.secrets`, account `plugins`.
public struct KeychainSecretsBackend: SecretsBackend {
    public let service: String
    public let account: String

    public init(service: String = "com.justanarthur.justnotch.secrets", account: String = "plugins") {
        self.service = service
        self.account = account
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    public func read() throws -> Data? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw Self.error(status) }
        return result as? Data
    }

    public func write(_ data: Data?) throws {
        guard let data else {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw Self.error(status) }
            return
        }
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw Self.error(update) }

        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrLabel as String] = "Just Notch plugin secrets"
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        var status = SecItemAdd(item as CFDictionary, nil)
        if status == errSecParam {
            // The legacy file keychain may refuse the accessibility class; its default is fine there.
            item[kSecAttrAccessible as String] = nil
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw Self.error(status) }
    }

    private static func error(_ status: OSStatus) -> ServiceError {
        let message = SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)"
        return ServiceError("Keychain: \(message)")
    }
}
