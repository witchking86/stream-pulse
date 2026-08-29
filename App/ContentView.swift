import SwiftUI

struct ContentView: View {
    @State private var testResult: String = ""
    @State private var isTesting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("StreamPulse")
                .font(.title2).bold()

            Text("Your Plex server URL and token live in Shared/PlexConfig.swift -- same approach as the Uebersicht widget. Edit that file and rebuild to change them; nothing here needs to be saved.")
                .font(.caption)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 4) {
                Text("Server URL").font(.headline)
                Text(PlexConfig.serverURL)
                    .font(.callout)
                    .textSelection(.enabled)
            }

            Button(isTesting ? "Testing…" : "Test Connection") {
                Task { await testConnection() }
            }
            .disabled(isTesting)
            .keyboardShortcut(.defaultAction)

            if !testResult.isEmpty {
                Text(testResult)
                    .font(.callout)
                    .foregroundStyle(testResult.hasPrefix("✅") ? .green : .red)
            }

            Divider()

            Text("The widget fetches directly from your Plex server every time WidgetKit refreshes it -- this window is just a quick connectivity check.")
                .font(.caption2)
                .foregroundStyle(.secondary)

            Spacer()
        }
        .padding(24)
        .frame(width: 420, height: 300)
    }

    private func testConnection() async {
        isTesting = true
        defer { isTesting = false }
        guard let client = PlexClient(serverURL: PlexConfig.serverURL, token: PlexConfig.token) else {
            testResult = "❌ Invalid server URL or token in Shared/PlexConfig.swift"
            return
        }
        let snapshot = await client.fetchSnapshot()
        testResult = snapshot.isOnline
            ? "✅ Connected — server v\(snapshot.serverVersion ?? "?")"
            : "❌ Could not reach server"
    }
}
