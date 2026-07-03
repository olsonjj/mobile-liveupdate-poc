import Foundation
import Capacitor

@objc(LiveUpdatePlugin)
public class LiveUpdatePlugin: CAPPlugin, CAPBridgedPlugin {

    // MARK: - CAPBridgedPlugin conformance

    public let identifier = "LiveUpdatePlugin"
    public let jsName = "LiveUpdate"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkForUpdate", returnType: CAPPluginReturnPromise),
    ]

    // MARK: - Storage paths

    /// Root: Library/Application Support/liveupdates/
    private var liveUpdatesRoot: URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return appSupport.appendingPathComponent("liveupdates", isDirectory: true)
    }

    private var currentDir: URL {
        liveUpdatesRoot.appendingPathComponent("current", isDirectory: true)
    }

    private var previousDir: URL {
        liveUpdatesRoot.appendingPathComponent("previous", isDirectory: true)
    }

    private var stateFile: URL {
        liveUpdatesRoot.appendingPathComponent("state.json")
    }

    // MARK: - initialize

    /// Ensure the storage layout exists.
    /// Creates `liveupdates/`, `current/`, `previous/`, and an initial `state.json`
    /// with `{ "current": null, "previous": null }` if one doesn't already exist.
    @objc func initialize(_ call: CAPPluginCall) {
        do {
            try createDirectoryIfNeeded(liveUpdatesRoot)
            try createDirectoryIfNeeded(currentDir)
            try createDirectoryIfNeeded(previousDir)

            if !FileManager.default.fileExists(atPath: stateFile.path) {
                let initial: [String: Any?] = ["current": nil, "previous": nil]
                let data = try JSONSerialization.data(withJSONObject: initial, options: [.prettyPrinted, .sortedKeys])
                try data.write(to: stateFile, options: .atomic)
            }

            call.resolve([:])
        } catch {
            call.reject("Failed to initialize storage: \(error.localizedDescription)")
        }
    }

    // MARK: - getState

    /// Read and return the contents of state.json.
    @objc func getState(_ call: CAPPluginCall) {
        do {
            guard FileManager.default.fileExists(atPath: stateFile.path) else {
                call.resolve(["current": NSNull(), "previous": NSNull()])
                return
            }

            let data = try Data(contentsOf: stateFile)
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]

            let current = json["current"] as? Int ?? NSNull()
            let previous = json["previous"] as? Int ?? NSNull()

            call.resolve(["current": current, "previous": previous])
        } catch {
            call.reject("Failed to read state: \(error.localizedDescription)")
        }
    }

    // MARK: - checkForUpdate

    /// Fetch the server manifest, compare versions, and return the check result.
    ///
    /// Accepts options:
    ///   - serverUrl: string (base URL like "http://localhost:3000")
    ///   - bundledBuildNumber: number (from version.ts)
    @objc func checkForUpdate(_ call: CAPPluginCall) {
        guard let serverUrlString = call.getString("serverUrl"),
              let serverUrl = URL(string: serverUrlString) else {
            call.reject("Missing or invalid 'serverUrl' parameter")
            return
        }

        let bundledBuildNumber = call.getInt("bundledBuildNumber") ?? 1

        let manifestUrl = serverUrl.appendingPathComponent("api/updates/latest")

        // Perform the fetch asynchronously
        let task = URLSession.shared.dataTask(with: manifestUrl) { [weak self] data, response, error in
            guard let self = self else { return }

            if let error = error {
                call.resolve([
                    "localVersion": NSNull(),
                    "serverVersion": NSNull(),
                    "updateAvailable": false,
                ])
                NSLog("[LiveUpdate] Manifest fetch failed: %@", error.localizedDescription)
                return
            }

            guard let data = data,
                  let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                call.resolve([
                    "localVersion": NSNull(),
                    "serverVersion": NSNull(),
                    "updateAvailable": false,
                ])
                NSLog("[LiveUpdate] Manifest fetch returned non-200")
                return
            }

            do {
                guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let serverVersion = json["version"] as? Int else {
                    call.resolve([
                        "localVersion": NSNull(),
                        "serverVersion": NSNull(),
                        "updateAvailable": false,
                    ])
                    return
                }

                // Determine local version: state.current ?? bundledBuildNumber
                let localVersion: Int? = self.readCurrentVersion() ?? bundledBuildNumber
                let updateAvailable = localVersion.map { serverVersion > $0 } ?? true

                call.resolve([
                    "localVersion": localVersion as Any,
                    "serverVersion": serverVersion,
                    "updateAvailable": updateAvailable,
                ])
            } catch {
                call.resolve([
                    "localVersion": NSNull(),
                    "serverVersion": NSNull(),
                    "updateAvailable": false,
                ])
                NSLog("[LiveUpdate] Manifest parse error: %@", error.localizedDescription)
            }
        }
        task.resume()
    }

    // MARK: - Helpers

    /// Read the `current` version from state.json, or nil if it doesn't exist or has no value.
    private func readCurrentVersion() -> Int? {
        guard FileManager.default.fileExists(atPath: stateFile.path),
              let data = try? Data(contentsOf: stateFile),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let current = json["current"] as? Int else {
            return nil
        }
        return current
    }

    /// Create a directory (including intermediate directories) if it doesn't already exist.
    private func createDirectoryIfNeeded(_ url: URL) throws {
        var isDir: ObjCBool = false
        if !FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: nil)
        }
    }
}