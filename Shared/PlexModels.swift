import Foundation

// MARK: - Raw Plex API response models
// These mirror the JSON Plex Media Server returns when requests include
// an `Accept: application/json` header. Field names match Plex's own
// attribute names (see https://github.com/Arcanemagus/plex-api/wiki).

struct PlexIdentityResponse: Codable {
    struct Container: Codable {
        let machineIdentifier: String?
        let version: String?
    }
    let MediaContainer: Container
}

struct PlexSessionsResponse: Codable {
    struct Container: Codable {
        let size: Int
        let Metadata: [PlexSession]?
    }
    let MediaContainer: Container
}

struct PlexSession: Codable, Identifiable {
    var id: String { sessionKey ?? ratingKey ?? UUID().uuidString }
    let sessionKey: String?
    let ratingKey: String?
    let title: String?
    let grandparentTitle: String?
    let type: String?
    let viewOffset: Int?
    let duration: Int?
    let User: PlexUser?
    let Player: PlexPlayer?

    var displayTitle: String {
        if let g = grandparentTitle, !g.isEmpty { return "\(g) — \(title ?? "")" }
        return title ?? "Unknown"
    }

    var progress: Double {
        guard let d = duration, d > 0, let v = viewOffset else { return 0 }
        return min(1.0, max(0.0, Double(v) / Double(d)))
    }
}

struct PlexUser: Codable {
    let title: String?
}

struct PlexPlayer: Codable {
    let state: String? // playing, paused, buffering
    let title: String? // device name
}

struct PlexRecentlyAddedResponse: Codable {
    struct Container: Codable {
        let Metadata: [PlexMetadataItem]?
    }
    let MediaContainer: Container
}

struct PlexMetadataItem: Codable, Identifiable {
    var id: String { ratingKey ?? UUID().uuidString }
    let ratingKey: String?
    let title: String?
    let grandparentTitle: String?
    let parentTitle: String?
    let type: String?
    let addedAt: Int?

    var displayTitle: String {
        switch type {
        case "episode":
            return "\(grandparentTitle ?? "") — \(title ?? "")"
        case "season":
            return "\(parentTitle ?? "") \(title ?? "")"
        default:
            return title ?? "Unknown"
        }
    }
}

struct PlexSectionsResponse: Codable {
    struct Container: Codable {
        let Directory: [PlexSection]?
    }
    let MediaContainer: Container
}

struct PlexSection: Codable, Identifiable {
    var id: String { key }
    let key: String
    let title: String
    let type: String
}

struct PlexSectionCountResponse: Codable {
    struct Container: Codable {
        let totalSize: Int?
        let size: Int
    }
    let MediaContainer: Container
}

// MARK: - App-level summary model
// This is what the widget and app actually render, and what gets cached
// in the shared App Group so the widget has something to show instantly.

struct PlexSnapshot: Codable, Sendable {
    var isOnline: Bool
    var serverVersion: String?
    var sessions: [SessionSummary]
    var recentlyAdded: [RecentItemSummary]
    var libraryCounts: [String: Int]
    var fetchedAt: Date

    struct SessionSummary: Codable, Identifiable, Sendable {
        var id: String
        var displayTitle: String
        var userName: String
        var state: String
        var progress: Double
    }

    struct RecentItemSummary: Codable, Identifiable, Sendable {
        var id: String
        var displayTitle: String
        var type: String
        var addedAt: Date
    }

    static let empty = PlexSnapshot(isOnline: false, serverVersion: nil, sessions: [], recentlyAdded: [], libraryCounts: [:], fetchedAt: .distantPast)
}
