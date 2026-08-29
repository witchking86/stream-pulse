import Foundation

struct PlexClient: Sendable {
    let baseURL: URL
    let token: String

    init?(serverURL: String, token: String) {
        guard !serverURL.isEmpty, !token.isEmpty, let url = URL(string: serverURL) else { return nil }
        self.baseURL = url
        self.token = token
    }

    private func makeRequest(path: String, queryItems: [URLQueryItem] = []) -> URLRequest? {
        guard var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        ) else { return nil }
        var items = queryItems
        items.append(URLQueryItem(name: "X-Plex-Token", value: token))
        components.queryItems = items
        guard let url = components.url else { return nil }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 8
        return request
    }

    /// Fetches server status, active sessions, recently added items, and
    /// per-library counts, and returns a single summary snapshot.
    /// Individual sub-fetches fail silently (leaving that part of the
    /// snapshot empty) so one flaky endpoint doesn't blank the whole widget.
    func fetchSnapshot() async -> PlexSnapshot {
        var snapshot = PlexSnapshot.empty
        snapshot.fetchedAt = Date()

        guard let identityRequest = makeRequest(path: "/identity") else { return snapshot }
        do {
            let (data, response) = try await URLSession.shared.data(for: identityRequest)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return snapshot
            }
            let identity = try JSONDecoder().decode(PlexIdentityResponse.self, from: data)
            snapshot.isOnline = true
            snapshot.serverVersion = identity.MediaContainer.version
        } catch {
            snapshot.isOnline = false
            return snapshot
        }

        if let sessionsRequest = makeRequest(path: "/status/sessions"),
           let (data, response) = try? await URLSession.shared.data(for: sessionsRequest),
           let http = response as? HTTPURLResponse, http.statusCode == 200,
           let decoded = try? JSONDecoder().decode(PlexSessionsResponse.self, from: data) {
            snapshot.sessions = (decoded.MediaContainer.Metadata ?? []).map { session in
                PlexSnapshot.SessionSummary(
                    id: session.id,
                    displayTitle: session.displayTitle,
                    userName: session.User?.title ?? "Unknown",
                    state: session.Player?.state ?? "unknown",
                    progress: session.progress
                )
            }
        }

        if let recentRequest = makeRequest(
            path: "/library/recentlyAdded",
            queryItems: [URLQueryItem(name: "X-Plex-Container-Size", value: "8")]
        ),
           let (data, response) = try? await URLSession.shared.data(for: recentRequest),
           let http = response as? HTTPURLResponse, http.statusCode == 200,
           let decoded = try? JSONDecoder().decode(PlexRecentlyAddedResponse.self, from: data) {
            snapshot.recentlyAdded = (decoded.MediaContainer.Metadata ?? []).map { item in
                PlexSnapshot.RecentItemSummary(
                    id: item.id,
                    displayTitle: item.displayTitle,
                    type: item.type ?? "item",
                    addedAt: item.addedAt.map { Date(timeIntervalSince1970: TimeInterval($0)) } ?? Date()
                )
            }
        }

        if let sectionsRequest = makeRequest(path: "/library/sections"),
           let (data, response) = try? await URLSession.shared.data(for: sectionsRequest),
           let http = response as? HTTPURLResponse, http.statusCode == 200,
           let decoded = try? JSONDecoder().decode(PlexSectionsResponse.self, from: data) {
            let sections = decoded.MediaContainer.Directory ?? []
            for section in sections {
                if let countRequest = makeRequest(
                    path: "/library/sections/\(section.key)/all",
                    queryItems: [
                        URLQueryItem(name: "X-Plex-Container-Start", value: "0"),
                        URLQueryItem(name: "X-Plex-Container-Size", value: "1")
                    ]
                ),
                   let (cdata, cresponse) = try? await URLSession.shared.data(for: countRequest),
                   let chttp = cresponse as? HTTPURLResponse, chttp.statusCode == 200,
                   let cdecoded = try? JSONDecoder().decode(PlexSectionCountResponse.self, from: cdata) {
                    snapshot.libraryCounts[section.title] = cdecoded.MediaContainer.totalSize ?? cdecoded.MediaContainer.size
                }
            }
        }

        return snapshot
    }
}
