import Foundation
import Capacitor

/// On-device state + version-check plugin for the live-updates POC.
///
/// Storage layout (see `PRD.md` → "On-device storage layout"):
///   <Application Support>/liveupdates/
///     ├── current/www/    active bundle (populated by a later slice)
///     ├── previous/www/   prior bundle, used for rollback
///     └── state.json      { "current": <int|null>, "previous": <int|null> }
///
/// This slice (issue 04) only manages on-device state and the version check
/// against the server manifest. Download/unzip/swap/reload/rollback arrive in
/// later issues and are intentionally absent here.
///
/// Registration: this class conforms to `CAPBridgedPlugin`; the SPM target is
/// linked into the app and the bridge instantiates the class because
/// `cap sync` adds `LiveUpdatePlugin` to `packageClassList` in
/// `capacitor.config.json` (it scans this package's Swift sources for
/// `@objc(...)`).
@objc(LiveUpdatePlugin)
public class LiveUpdatePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveUpdatePlugin"
    public let jsName = "LiveUpdate"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ensureStorage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkForUpdate", returnType: CAPPluginReturnPromise),
    ]

    // MARK: - Path constants

    private let dirName = "liveupdates"
    private let currentDirName = "current"
    private let previousDirName = "previous"
    private let stateFileName = "state.json"

    /// `<Application Support>/liveupdates/` — writable, app-scoped, persists
    /// across launches, and is inspectable via `xcrun simctl get_app_container`.
    private var rootURL: URL {
        FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first!
            .appendingPathComponent(dirName, isDirectory: true)
    }

    private var stateURL: URL { rootURL.appendingPathComponent(stateFileName) }
    private var currentURL: URL { rootURL.appendingPathComponent(currentDirName, isDirectory: true) }
    private var previousURL: URL { rootURL.appendingPathComponent(previousDirName, isDirectory: true) }

    // MARK: - Plugin methods

    /// Create the storage layout if missing and seed an initial `state.json`
    /// (`{ "current": null, "previous": null }`). Resolves with the absolute
    /// root path so the JS layer can surface it for debugging.
    @objc func ensureStorage(_ call: CAPPluginCall) {
        do {
            try ensureLayout()
            call.resolve(["root": rootURL.path])
        } catch {
            call.reject("ensureStorage failed: \(error.localizedDescription)")
        }
    }

    /// Read `state.json`. Resolves with `{ current, previous }` where each
    /// value is an integer or null.
    @objc func getState(_ call: CAPPluginCall) {
        do {
            try ensureLayout()
            let state = try readState()
            call.resolve(stateToJS(state))
        } catch {
            call.reject("getState failed: \(error.localizedDescription)")
        }
    }

    /// Fetch the server manifest and compare `server.version` against the
    /// locally recorded current version. When `state.current` is null (no update
    /// applied yet) the app-bundle `baselineVersion` is used as the local
    /// baseline for comparison.
    ///
    /// Non-blocking by design: the file IO + network fetch run on a background
    /// queue and the promise resolves only once the check completes. The web
    /// view renders its current bundle immediately; this resolves later.
    @objc func checkForUpdate(_ call: CAPPluginCall) {
        let opts = call.options
        guard let serverUrl = opts?["serverUrl"] as? String, !serverUrl.isEmpty else {
            call.reject("serverUrl is required")
            return
        }
        let baseline = (opts?["baselineVersion"] as? Int) ?? 0

        DispatchQueue.global(qos: .utility).async {
            do {
                try self.ensureLayout()
                let state = try self.readState()
                let localVersion = state.current ?? baseline
                let serverVersion = try self.fetchManifestVersion(url: serverUrl)
                call.resolve([
                    "currentVersion": localVersion,
                    "serverVersion": serverVersion,
                    "updateAvailable": serverVersion > localVersion,
                ])
            } catch {
                call.reject("checkForUpdate failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Storage helpers

    private func ensureLayout() throws {
        let fm = FileManager.default
        try fm.createDirectory(at: rootURL, withIntermediateDirectories: true)
        try fm.createDirectory(at: currentURL, withIntermediateDirectories: true)
        try fm.createDirectory(at: previousURL, withIntermediateDirectories: true)
        if !fm.fileExists(atPath: stateURL.path) {
            try writeState(LiveUpdateState(current: nil, previous: nil))
        }
    }

    private struct LiveUpdateState {
        let current: Int?
        let previous: Int?
    }

    private func readState() throws -> LiveUpdateState {
        let data = try Data(contentsOf: stateURL)
        let json = (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        return LiveUpdateState(
            current: json["current"] as? Int,
            previous: json["previous"] as? Int
        )
    }

    private func writeState(_ state: LiveUpdateState) throws {
        var obj: [String: Any] = [:]
        obj["current"] = state.current ?? NSNull()
        obj["previous"] = state.previous ?? NSNull()
        let data = try JSONSerialization.data(
            withJSONObject: obj,
            options: [.prettyPrinted, .sortedKeys]
        )
        try data.write(to: stateURL, options: .atomic)
    }

    private func stateToJS(_ state: LiveUpdateState) -> [String: Any] {
        return [
            "current": state.current ?? NSNull(),
            "previous": state.previous ?? NSNull(),
        ]
    }

    // MARK: - Network helper

    /// Synchronously fetch the manifest JSON and return its integer `version`.
    /// Must be called off the main thread (uses a DispatchSemaphore).
    private func fetchManifestVersion(url urlString: String) throws -> Int {
        guard let url = URL(string: urlString) else {
            throw LiveUpdateError.invalidUrl(urlString)
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 10

        let semaphore = DispatchSemaphore(value: 0)
        var data: Data?
        var responseError: Error?
        var statusCode: Int = 0

        let task = URLSession.shared.dataTask(with: request) { d, response, err in
            data = d
            responseError = err
            if let http = response as? HTTPURLResponse {
                statusCode = http.statusCode
            }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + 15)

        if let err = responseError {
            throw err
        }
        guard statusCode == 200 else {
            throw LiveUpdateError.badStatus(statusCode)
        }
        guard let payload = data else {
            throw LiveUpdateError.noData
        }
        let json = (try JSONSerialization.jsonObject(with: payload) as? [String: Any]) ?? [:]
        guard let version = json["version"] as? Int else {
            throw LiveUpdateError.missingVersion
        }
        return version
    }

    private enum LiveUpdateError: Error, LocalizedError {
        case invalidUrl(String)
        case badStatus(Int)
        case noData
        case missingVersion

        var errorDescription: String? {
            switch self {
            case .invalidUrl(let s): return "invalid url: \(s)"
            case .badStatus(let c): return "unexpected HTTP status \(c)"
            case .noData: return "empty response body"
            case .missingVersion: return "manifest missing integer 'version'"
            }
        }
    }
}
