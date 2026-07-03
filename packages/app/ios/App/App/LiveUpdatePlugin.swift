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
        CAPPluginMethod(name: "downloadAndStageUpdate", returnType: CAPPluginReturnPromise),
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

    private var stagingDir: URL {
        liveUpdatesRoot.appendingPathComponent("staging", isDirectory: true)
    }

    /// Nested www/ inside staging/ where the unzipped bundle will land.
    private var stagingWwwDir: URL {
        stagingDir.appendingPathComponent("www", isDirectory: true)
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

            var result: [String: Any] = ["current": NSNull(), "previous": NSNull()]
            if let current = json["current"] as? Int { result["current"] = current }
            if let previous = json["previous"] as? Int { result["previous"] = previous }
            call.resolve(result)
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
                    "zipUrl": NSNull(),
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
                    "zipUrl": NSNull(),
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
                        "zipUrl": NSNull(),
                    ])
                    return
                }

                // Determine local version: state.current ?? bundledBuildNumber
                let localVersion: Int? = self.readCurrentVersion() ?? bundledBuildNumber
                let updateAvailable = localVersion.map { serverVersion > $0 } ?? true

                // Extract the zip URL from the manifest
                let zipUrl = json["url"] as? String

                call.resolve([
                    "localVersion": localVersion as Any,
                    "serverVersion": serverVersion,
                    "updateAvailable": updateAvailable,
                    "zipUrl": zipUrl as Any,
                ])
            } catch {
                call.resolve([
                    "localVersion": NSNull(),
                    "serverVersion": NSNull(),
                    "updateAvailable": false,
                    "zipUrl": NSNull(),
                ])
                NSLog("[LiveUpdate] Manifest parse error: %@", error.localizedDescription)
            }
        }
        task.resume()
    }

    // MARK: - downloadAndStageUpdate

    /// Download a zip from `zipUrl`, unzip it into the staging directory, and validate.
    ///
    /// Accepts options:
    ///   - zipUrl: string (full URL to the payload zip)
    ///   - version: number (the version of the payload being staged)
    ///
    /// On success returns `{ success: true, version: N, error: null }`.
    /// On any failure cleans up staging and temp, returns `{ success: false, version: null, error: "…" }`.
    @objc func downloadAndStageUpdate(_ call: CAPPluginCall) {
        guard let zipUrlString = call.getString("zipUrl"),
              let zipUrl = URL(string: zipUrlString) else {
            call.resolve([
                "success": false,
                "version": NSNull(),
                "error": "Missing or invalid 'zipUrl' parameter",
            ])
            return
        }

        let version = call.getInt("version") ?? 0

        NSLog("[LiveUpdate] downloadAndStageUpdate: downloading v%d from %@", version, zipUrlString)

        // 1. Download the zip to a temporary location
        let task = URLSession.shared.downloadTask(with: zipUrl) { [weak self] tempUrl, response, error in
            guard let self = self else { return }

            // Error during download
            if let error = error {
                NSLog("[LiveUpdate] Download failed: %@", error.localizedDescription)
                self.cleanupStaging()
                call.resolve([
                    "success": false,
                    "version": NSNull(),
                    "error": "Download failed: \(error.localizedDescription)",
                ])
                return
            }

            // Check HTTP status
            if let httpResponse = response as? HTTPURLResponse,
               httpResponse.statusCode != 200 {
                NSLog("[LiveUpdate] Download returned non-200: %d", httpResponse.statusCode)
                self.cleanupStaging()
                call.resolve([
                    "success": false,
                    "version": NSNull(),
                    "error": "Download returned HTTP \(httpResponse.statusCode)",
                ])
                return
            }

            guard let tempUrl = tempUrl else {
                NSLog("[LiveUpdate] Download returned no temp file URL")
                self.cleanupStaging()
                call.resolve([
                    "success": false,
                    "version": NSNull(),
                    "error": "Download produced no temp file",
                ])
                return
            }

            NSLog("[LiveUpdate] Download complete, unzipping…")

            // 2. Clean any prior staging directory, then create it fresh
            self.cleanupStaging()

            do {
                try self.createDirectoryIfNeeded(self.stagingDir)
            } catch {
                NSLog("[LiveUpdate] Failed to create staging directory: %@", error.localizedDescription)
                call.resolve([
                    "success": false,
                    "version": NSNull(),
                    "error": "Failed to create staging directory: \(error.localizedDescription)",
                ])
                return
            }

            // 3. Unzip the downloaded file into the staging directory
            do {
                try self.unzipFile(at: tempUrl, to: self.stagingDir)
            } catch {
                NSLog("[LiveUpdate] Unzip failed: %@", error.localizedDescription)
                self.cleanupStaging()
                call.resolve([
                    "success": false,
                    "version": NSNull(),
                    "error": "Unzip failed: \(error.localizedDescription)",
                ])
                return
            }

            // 4. Validate: check that an index.html exists at the root of the unzipped bundle
            //    Capacitor's web build puts index.html directly in the www/ folder,
            //    so check both staging/www/index.html and staging/index.html
            let indexAtWww = self.stagingWwwDir.appendingPathComponent("index.html")
            let indexAtRoot = self.stagingDir.appendingPathComponent("index.html")

            if !FileManager.default.fileExists(atPath: indexAtWww.path) &&
               !FileManager.default.fileExists(atPath: indexAtRoot.path) {
                NSLog("[LiveUpdate] Validation failed: no index.html found in unzipped bundle")
                self.cleanupStaging()
                call.resolve([
                    "success": false,
                    "version": NSNull(),
                    "error": "Validation failed: no index.html in bundle",
                ])
                return
            }

            NSLog("[LiveUpdate] Staging complete for v%d", version)
            call.resolve([
                "success": true,
                "version": version,
                "error": NSNull(),
            ])
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

    /// Remove the staging directory and any downloaded temp file associated with it.
    /// Safe to call even if staging doesn't exist — swallows errors.
    private func cleanupStaging() {
        let fm = FileManager.default
        if fm.fileExists(atPath: stagingDir.path) {
            try? fm.removeItem(at: stagingDir)
        }
    }

    /// Unzip the file at `source` into `destination`.
    /// Uses `NSTemporaryDirectory()` + Process (unzip) since iOS doesn't bundle
    /// a Foundation unzip API, OR falls back to a manual copy if the zip was
    /// already decompressed by URLSession's downloadTask.
    ///
    /// On iOS simulator, we shell out to `/usr/bin/unzip` as a pragmatic POC shortcut.
    private func unzipFile(at source: URL, to destination: URL) throws {
        // URLSession.downloadTask sometimes unzips automatically if served with
        // Content-Encoding, but normally it leaves the raw zip. We shell out to unzip.
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        process.arguments = ["-o", source.path, "-d", destination.path]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        try process.run()
        process.waitUntilExit()

        if process.terminationStatus != 0 {
            throw NSError(
                domain: "LiveUpdate",
                code: Int(process.terminationStatus),
                userInfo: [NSLocalizedDescriptionKey: "unzip failed with status \(process.terminationStatus)"]
            )
        }
    }
}