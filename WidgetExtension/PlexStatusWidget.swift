import WidgetKit
import SwiftUI

struct PlexEntry: TimelineEntry {
    let date: Date
    let snapshot: PlexSnapshot
}

struct PlexProvider: TimelineProvider {
    func placeholder(in context: Context) -> PlexEntry {
        PlexEntry(date: Date(), snapshot: .empty)
    }

    func getSnapshot(in context: Context, completion: @escaping (PlexEntry) -> Void) {
        completion(PlexEntry(date: Date(), snapshot: .empty))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PlexEntry>) -> Void) {
        Task {
            var snapshot = PlexSnapshot.empty

            if let client = PlexClient(serverURL: PlexConfig.serverURL, token: PlexConfig.token) {
                snapshot = await client.fetchSnapshot()
            }

            let entry = PlexEntry(date: Date(), snapshot: snapshot)
            // Ask the system to check again in 10 minutes. WidgetKit's own
            // refresh budget (not this app) decides how often that actually
            // happens — see the README's "refresh rate" note.
            let nextRefresh = Calendar.current.date(byAdding: .minute, value: 10, to: Date()) ?? Date().addingTimeInterval(600)
            completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
        }
    }
}

struct PlexStatusWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: PlexEntry

    var body: some View {
        Group {
            switch family {
            case .systemSmall:
                SmallStatusView(snapshot: entry.snapshot)
            case .systemMedium:
                MediumStatusView(snapshot: entry.snapshot)
            default:
                LargeStatusView(snapshot: entry.snapshot)
            }
        }
        // Required as of recent WidgetKit SDKs -- without an explicit
        // containerBackground, the system shows a "Please adopt
        // containerBackground API" placeholder instead of this view,
        // no matter what it renders.
        .containerBackground(for: .widget) {
            Color(red: 0.07, green: 0.08, blue: 0.12)
        }
    }
}

struct SmallStatusView: View {
    let snapshot: PlexSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Circle()
                    .fill(snapshot.isOnline ? .green : .red)
                    .frame(width: 8, height: 8)
                Text(snapshot.isOnline ? "Online" : "Offline")
                    .font(.caption).bold()
            }
            Spacer()
            Text("\(snapshot.sessions.count)")
                .font(.system(size: 34, weight: .bold))
            Text(snapshot.sessions.count == 1 ? "stream" : "streams")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("\(Set(snapshot.sessions.map { $0.userName }).count) user(s) streaming")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}

struct MediumStatusView: View {
    let snapshot: PlexSnapshot

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Circle().fill(snapshot.isOnline ? .green : .red).frame(width: 8, height: 8)
                    Text(snapshot.isOnline ? "Server Online" : "Server Offline").font(.caption).bold()
                }
                Text("\(snapshot.sessions.count) active \(snapshot.sessions.count == 1 ? "stream" : "streams")")
                    .font(.caption2).foregroundStyle(.secondary)
                Text("\(Set(snapshot.sessions.map { $0.userName }).count) user(s) streaming")
                    .font(.caption2).foregroundStyle(.secondary)
                ForEach(snapshot.libraryCounts.sorted(by: { $0.key < $1.key }).prefix(3), id: \.key) { name, count in
                    Text("\(name): \(count)").font(.caption2)
                }
            }
            Divider()
            VStack(alignment: .leading, spacing: 4) {
                Text("Now Playing").font(.caption).bold()
                if snapshot.sessions.isEmpty {
                    Text("Nothing playing").font(.caption2).foregroundStyle(.secondary)
                } else {
                    ForEach(snapshot.sessions.prefix(2)) { session in
                        Text(session.displayTitle).font(.caption2).lineLimit(1)
                        Text(session.userName).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding()
    }
}

struct LargeStatusView: View {
    let snapshot: PlexSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Circle().fill(snapshot.isOnline ? .green : .red).frame(width: 10, height: 10)
                Text(snapshot.isOnline ? "Server Online" : "Server Offline").font(.headline)
                Spacer()
                Text("\(Set(snapshot.sessions.map { $0.userName }).count) streaming")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Text("Now Playing").font(.subheadline).bold()
            if snapshot.sessions.isEmpty {
                Text("Nothing playing").font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(snapshot.sessions.prefix(3)) { session in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.displayTitle).font(.caption).lineLimit(1)
                        HStack {
                            Text(session.userName).font(.caption2).foregroundStyle(.secondary)
                            Spacer()
                            Text(session.state.capitalized).font(.caption2).foregroundStyle(.secondary)
                        }
                        ProgressView(value: session.progress)
                    }
                }
            }

            Divider()

            Text("Recently Added").font(.subheadline).bold()
            if snapshot.recentlyAdded.isEmpty {
                Text("Nothing yet").font(.caption2).foregroundStyle(.secondary)
            } else {
                ForEach(snapshot.recentlyAdded.prefix(3)) { item in
                    Text(item.displayTitle).font(.caption2).lineLimit(1)
                }
            }

            Divider()

            Text("Library").font(.subheadline).bold()
            ForEach(snapshot.libraryCounts.sorted(by: { $0.key < $1.key }), id: \.key) { name, count in
                Text("\(name): \(count)").font(.caption2)
            }

            Spacer()
            Text("Updated \(entryTimeString)")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding()
    }

    private var entryTimeString: String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: snapshot.fetchedAt)
    }
}

struct PlexStatusWidget: Widget {
    let kind: String = "StreamPulseWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PlexProvider()) { entry in
            PlexStatusWidgetView(entry: entry)
        }
        .configurationDisplayName("StreamPulse")
        .description("Now playing, recently added, library stats, and server status for your Plex server.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
