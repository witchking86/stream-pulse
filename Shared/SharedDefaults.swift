import Foundation
import WidgetKit

/// Storage shared between the StreamPulse app and its widget extension via
/// an App Group. Set the SAME app group string in Signing & Capabilities
/// for BOTH targets, and update appGroupID below to match if you change it.
enum SharedDefaults {
    static let appGroupID = "group.com.example.streampulse" // <-- change to your own App Group ID (must match Signing & Capabilities on both targets)

    static var suite: UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }

    private static let serverURLKey = "plexServerURL"
    private static let tokenKey = "plexToken"
    private static let snapshotKey = "plexSnapshotCache"

    static var serverURL: String {
        get { suite?.string(forKey: serverURLKey) ?? "" }
        set { suite?.set(newValue, forKey: serverURLKey) }
    }

    static var token: String {
        get { suite?.string(forKey: tokenKey) ?? "" }
        set { suite?.set(newValue, forKey: tokenKey) }
    }

    static func cacheSnapshot(_ snapshot: PlexSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        suite?.set(data, forKey: snapshotKey)
    }

    static func loadCachedSnapshot() -> PlexSnapshot? {
        guard let data = suite?.data(forKey: snapshotKey) else { return nil }
        return try? JSONDecoder().decode(PlexSnapshot.self, from: data)
    }
}
