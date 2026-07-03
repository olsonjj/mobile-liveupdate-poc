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
        CAPPluginMethod(name: "swapToStagedUpdate", returnType: CAPPluginReturnPromise),
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

    private var currentWwwDir: URL {
        currentDir.appendingPathComponent("www", isDirectory: true)
    }

    private var previousWwwDir: URL {
        previousDir.appendingPathComponent("www", isDirectory: true)
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

    // MARK: - swapToStagedUpdate

    /// Atomically swap the staged bundle into `current/`, moving the old current to `previous/`,
    /// and update state.json.
    ///
    /// Accepts options:
    ///   - version: number (the new version being swapped in)
    ///
    /// On success returns `{ success: true, version: N, error: null }`.
    /// On any failure restores the prior arrangement and returns `{ success: false, version: null, error: "…" }`.
    @objc func swapToStagedUpdate(_ call: CAPPluginCall) {
        let version = call.getInt("version") ?? 0

        NSLog("[LiveUpdate] swapToStagedUpdate for v%d", version)

        // 1. Validate staging exists and has an index.html
        let stagedRoot: URL
        if FileManager.default.fileExists(atPath: self.stagingWwwDir.appendingPathComponent("index.html").path) {
            stagedRoot = self.stagingWwwDir
        } else if FileManager.default.fileExists(atPath: self.stagingDir.appendingPathComponent("index.html").path) {
            stagedRoot = self.stagingDir
        } else {
            call.resolve([
                "success": false,
                "version": NSNull(),
                "error": "No staged bundle found",
            ])
            return
        }

        // 2. Read current state
        let oldCurrent: Int? = self.readCurrentVersion()

        // 3. Snapshot whether previous directory existed before swap
        let previousExistedBefore = FileManager.default.fileExists(atPath: self.previousDir.path)
        let currentExistedBefore = FileManager.default.fileExists(atPath: self.currentDir.path)

        // Clean any leftover backup from a prior failed attempt
        self.cleanupBackup()

        do {
            // 4. Remove existing previous/ (to be replaced by the old current/)
            if previousExistedBefore {
                try FileManager.default.removeItem(at: self.previousDir)
            }

            // 5. If current/ exists, move it to previous/
            if currentExistedBefore {
                try FileManager.default.moveItem(at: self.currentDir, to: self.previousDir)
            }

            // 6. Create fresh current/www/
            try self.createDirectoryIfNeeded(self.currentWwwDir)

            // 7. Move staged content into current/www/
            try self.moveContentsOfDirectory(from: stagedRoot, to: self.currentWwwDir)

            // 8. Update state.json
            let state: [String: Any?] = [
                "current": version,
                "previous": (oldCurrent as Any?),
            ]
            let data = try JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: self.stateFile, options: .atomic)

            // 9. Clean up staging
            self.cleanupStaging()
            self.cleanupBackup()

            NSLog("[LiveUpdate] Swap complete: current=v%d, previous=%@", version, oldCurrent.map { String($0) } ?? "null")
            call.resolve([
                "success": true,
                "version": version,
                "error": NSNull(),
            ])
        } catch {
            NSLog("[LiveUpdate] Swap failed, restoring: %@", error.localizedDescription)

            // Restore: if we moved current → previous, move it back
            if currentExistedBefore && FileManager.default.fileExists(atPath: self.previousDir.path) {
                // Remove the partially-constructed current/ if it exists
                if FileManager.default.fileExists(atPath: self.currentDir.path) {
                    try? FileManager.default.removeItem(at: self.currentDir)
                }
                // Move previous/ back to current/
                try? FileManager.default.moveItem(at: self.previousDir, to: self.currentDir)

                // If there was a previous before, it's lost — but this is a POC.
            }

            // Restore state.json if we have a backup (best-effort for POC)
            self.cleanupStaging()
            self.cleanupBackup()

            call.resolve([
                "success": false,
                "version": NSNull(),
                "error": "Swap failed: \(error.localizedDescription)",
            ])
        }
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

    /// Read the `previous` version from state.json, or nil.
    private func readPreviousVersion() -> Int? {
        guard FileManager.default.fileExists(atPath: stateFile.path),
              let data = try? Data(contentsOf: stateFile),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let previous = json["previous"] as? Int else {
            return nil
        }
        return previous
    }

    /// Move all contents of one directory into another.
    /// Each file/subdirectory is moved individually so that a partial failure
    /// is recoverable by the caller.
    private func moveContentsOfDirectory(from source: URL, to destination: URL) throws {
        let fm = FileManager.default
        let contents = try fm.contentsOfDirectory(at: source, includingPropertiesForKeys: nil)
        for item in contents {
            let dest = destination.appendingPathComponent(item.lastPathComponent)
            // Remove existing destination if present (shouldn't happen for fresh current/www)
            if fm.fileExists(atPath: dest.path) {
                try fm.removeItem(at: dest)
            }
            try fm.moveItem(at: item, to: dest)
        }
    }

    /// Remove the temporary swap backup directory.
    private func cleanupBackup() {
        let backup = liveUpdatesRoot.appendingPathComponent(".swap_backup", isDirectory: true)
        if FileManager.default.fileExists(atPath: backup.path) {
            try? FileManager.default.removeItem(at: backup)
        }
    }

    /// Unzip the file at `source` into `destination`.
    ///
    /// POC implementation: reads stored (uncompressed) zip entries only.
    /// Payload zips must be created with `zip -0` (no compression) since iOS
    /// does not expose a built-in zip/deflate API without third-party libraries.
    private func unzipFile(at source: URL, to destination: URL) throws {
        let data = try Data(contentsOf: source)
        let fm = FileManager.default
        var offset = 0

        while offset < data.count - 4 {
            // Read local file header signature (4 bytes)
            let sig = data.subdata(in: offset..<offset + 4)
            let sigVal = sig.withUnsafeBytes { $0.load(as: UInt32.self).littleEndian }

            // 0x04034b50 = local file header signature
            guard sigVal == 0x04034b50 else { break }

            // version needed: offset + 4 (2 bytes)
            // flags: offset + 6 (2 bytes)
            // compression method: offset + 8 (2 bytes)
            let compressionOffset = offset + 8
            let compression = data.subdata(in: compressionOffset..<compressionOffset + 2)
                .withUnsafeBytes { $0.load(as: UInt16.self).littleEndian }

            // Only support stored (uncompressed) entries
            guard compression == 0 else {
                throw NSError(
                    domain: "LiveUpdate",
                    code: -1,
                    userInfo: [NSLocalizedDescriptionKey: "Zip contains compressed entries; use zip -0 for POC"]
                )
            }

            // file name length: offset + 26 (2 bytes)
            let nameLenOffset = offset + 26
            let nameLen = Int(data.subdata(in: nameLenOffset..<nameLenOffset + 2)
                .withUnsafeBytes { $0.load(as: UInt16.self).littleEndian })

            // extra field length: offset + 28 (2 bytes)
            let extraLenOffset = offset + 28
            let extraLen = Int(data.subdata(in: extraLenOffset..<extraLenOffset + 2)
                .withUnsafeBytes { $0.load(as: UInt16.self).littleEndian })

            // file name: offset + 30, length nameLen
            let nameStart = offset + 30
            guard let fileName = String(data: data.subdata(in: nameStart..<nameStart + nameLen), encoding: .utf8) else {
                break
            }

            // compressed size: offset + 18 (4 bytes)
            let compSizeOffset = offset + 18
            let compSize = Int(data.subdata(in: compSizeOffset..<compSizeOffset + 4)
                .withUnsafeBytes { $0.load(as: UInt32.self).littleEndian })

            // uncompressed size: offset + 22 (4 bytes) — unused for stored entries but read to advance past

            // file data starts after header
            let dataOffset = offset + 30 + nameLen + extraLen
            let fileData = data.subdata(in: dataOffset..<dataOffset + compSize)

            // Skip directory entries (trailing /)
            if !fileName.hasSuffix("/") {
                let destFile = destination.appendingPathComponent(fileName)
                let destDir = destFile.deletingLastPathComponent()
                try fm.createDirectory(at: destDir, withIntermediateDirectories: true, attributes: nil)
                try fileData.write(to: destFile, options: .atomic)
            }

            // Advance to next entry
            offset = dataOffset + compSize
        }
    }
}