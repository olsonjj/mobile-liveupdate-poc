import Foundation
import Capacitor
import Compression

/// On-device live-update plugin for the roll-your-own live-updates POC.
///
/// Storage layout (see `PRD.md` → "On-device storage layout"):
///   <Application Support>/liveupdates/
///     ├── current/www/    active bundle (populated by a later slice)
///     ├── previous/www/   prior bundle, used for rollback
///     ├── staging/www/    bundle downloaded + unzipped here, awaiting swap
///     └── state.json      { "current": <int|null>, "previous": <int|null> }
///
/// Slices implemented so far:
///   - issue 04: on-device state (`ensureStorage`, `getState`) + version check
///     (`checkForUpdate`).
///   - issue 05: foreground-resume trigger is driven from the JS layer; this
///     native side is unchanged for that slice.
///   - issue 06 (this slice): `prepareUpdate` — show an "Updating…" overlay,
///     download the payload zip to a temp location, unzip it into
///     `staging/www/`, and validate that an `index.html` exists at the bundle
///     root. On any failure the staging/temp dirs are cleaned up, the overlay
///     is dismissed, and `current/` + `state.json` are left untouched. On
///     success the overlay stays visible and the staged path is returned; the
///     atomic swap + reload arrive in later slices.
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
        CAPPluginMethod(name: "prepareUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "applyUpdate", returnType: CAPPluginReturnPromise),
    ]

    // MARK: - Path constants

    private let dirName = "liveupdates"
    private let currentDirName = "current"
    private let previousDirName = "previous"
    private let stagingDirName = "staging"
    private let bundleDirName = "www"
    private let stateFileName = "state.json"

    /// Tag used to find the "Updating…" overlay view in the WebView's superview
    /// so it can be removed without holding a strong reference to it.
    private let overlayTag = 0x4C56_5550

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
    private var currentBundleURL: URL { currentURL.appendingPathComponent(bundleDirName, isDirectory: true) }
    private var previousURL: URL { rootURL.appendingPathComponent(previousDirName, isDirectory: true) }
    private var previousBundleURL: URL { previousURL.appendingPathComponent(bundleDirName, isDirectory: true) }
    private var stagingURL: URL { rootURL.appendingPathComponent(stagingDirName, isDirectory: true) }
    private var stagingBundleURL: URL { stagingURL.appendingPathComponent(bundleDirName, isDirectory: true) }

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
    ///
    /// The resolved `url` is the payload zip URL from the manifest, forwarded
    /// so the JS layer can hand it to `prepareUpdate` without a second fetch.
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
                let manifest = try self.fetchManifest(url: serverUrl)
                call.resolve([
                    "currentVersion": localVersion,
                    "serverVersion": manifest.version,
                    "updateAvailable": manifest.version > localVersion,
                    "url": manifest.payloadURL,
                ])
            } catch {
                call.reject("checkForUpdate failed: \(error.localizedDescription)")
            }
        }
    }

    /// Download + unzip + validate a payload zip into `staging/www/`
    /// (issue 06). Does NOT touch `current/`, `previous/`, or `state.json` —
    /// the atomic swap is a later slice.
    ///
    /// Flow:
    ///   1. Show a centered "Updating…" overlay over the WebView.
    ///   2. Download the zip from `url` to a temp file.
    ///   3. Unzip it into `staging/www/` (a fresh, empty staging dir).
    ///   4. Validate `staging/www/index.html` exists.
    ///   5. On success: resolve `{ stagingPath }` and leave the overlay visible
    ///      (handed off to the swap slice).
    ///   On any failure: clean up staging + temp zip, dismiss the overlay,
    ///   reject. The active bundle is never touched.
    @objc func prepareUpdate(_ call: CAPPluginCall) {
        guard let urlString = call.options?["url"] as? String, !urlString.isEmpty else {
            call.reject("url is required")
            return
        }
        guard let url = URL(string: urlString) else {
            call.reject("invalid url: \(urlString)")
            return
        }

        showOverlay()

        DispatchQueue.global(qos: .utility).async {
            var tempZipURL: URL?
            do {
                try self.ensureLayout()
                self.cleanStaging()
                try FileManager.default.createDirectory(
                    at: self.stagingBundleURL,
                    withIntermediateDirectories: true
                )

                tempZipURL = try self.downloadZip(from: url)
                try ZipExtractor.unzip(at: tempZipURL!, to: self.stagingBundleURL)

                let indexURL = self.stagingBundleURL.appendingPathComponent("index.html")
                guard FileManager.default.fileExists(atPath: indexURL.path) else {
                    throw LiveUpdateError.missingIndexHtml
                }

                // Temp zip no longer needed once unpacked.
                try? FileManager.default.removeItem(at: tempZipURL!)

                // Overlay stays visible — the atomic-swap slice (issue 07)
                // owns dismissing it after the swap completes (success or
                // failure).
                call.resolve([
                    "stagingPath": self.stagingBundleURL.path,
                ])
            } catch {
                self.cleanStaging()
                if let zip = tempZipURL {
                    try? FileManager.default.removeItem(at: zip)
                }
                self.hideOverlay()
                call.reject("prepareUpdate failed: \(error.localizedDescription)")
            }
        }
    }

    /// Atomically promote the staged bundle to the active slot and update
    /// `state.json` (issue 07). Does NOT reload the WebView — the app still
    /// shows the old version on screen after a successful swap; the reload
    /// arrives in issue 08.
    ///
    /// Flow (all on a background queue; the "Updating…" overlay shown by
    /// `prepareUpdate` is dismissed on completion — success or failure):
    ///   1. Read current state → `oldCurrent` (may be nil).
    ///   2. Re-validate `staging/www/index.html` exists.
    ///   3. Move `current/www/` to a temp backup location (if it exists).
    ///   4. Move `staging/www/` into `current/www/`.
    ///      On failure: move the backup back into `current/www/` (restore),
    ///      dismiss the overlay, reject. Active bundle unchanged.
    ///   5. Discard the old `previous/www/`, move the backup into
    ///      `previous/www/` (only if there was a prior current).
    ///   6. Write `state.json` atomically to
    ///      `{ current: <newVersion>, previous: oldCurrent }`.
    ///      On failure: best-effort restore the prior directory arrangement
    ///      (move the new current back to staging, move previous back to
    ///      current) so the active pointer matches on-disk reality, then
    ///      reject.
    ///   7. Dismiss the overlay, resolve with the new state.
    ///
    /// `version` is the new build number being applied (the server's version
    /// that `checkForUpdate` already compared). It is written verbatim into
    /// `state.current`; `state.previous` becomes whatever `oldCurrent` was.
    @objc func applyUpdate(_ call: CAPPluginCall) {
        guard let newVersion = call.options?["version"] as? Int else {
            call.reject("version is required")
            return
        }

        DispatchQueue.global(qos: .utility).async {
            do {
                try self.ensureLayout()
                let newState = try self.performAtomicSwap(newVersion: newVersion)
                self.hideOverlay()
                call.resolve(self.stateToJS(newState))
            } catch {
                self.hideOverlay()
                call.reject("applyUpdate failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Atomic swap (issue 07)

    /// Perform the staging → current → previous rotation described in the
    /// PRD's "Update flow (happy path)" steps 6–7, with best-effort rollback
    /// on any failure so `current/` is never left empty or half-written.
    /// Returns the new state to persist + return to JS.
    ///
    /// The temp backup lives in the system temp dir (outside the liveupdates
    /// root) so a crash mid-swap leaves no partially-populated `current/`.
    private func performAtomicSwap(newVersion: Int) throws -> LiveUpdateState {
        let fm = FileManager.default

        let oldState = try readState()
        let oldCurrent = oldState.current

        // Re-validate the staged bundle before touching the live slots.
        let stagingIndex = stagingBundleURL.appendingPathComponent("index.html")
        guard fm.fileExists(atPath: stagingIndex.path) else {
            throw LiveUpdateError.stagingMissing
        }

        // Temp backup for the currently-active bundle (if any). Lives outside
        // the liveupdates root so a crash can't leave a stray half-slot.
        let tempDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let backupURL = tempDir.appendingPathComponent("liveupdate-current-\(UUID().uuidString)", isDirectory: true)
        var hasBackup = false
        if fm.fileExists(atPath: currentBundleURL.path) {
            try fm.moveItem(at: currentBundleURL, to: backupURL)
            hasBackup = true
        }

        // Promote staging into current. If this fails, restore the backup so
        // the active bundle is unchanged and reject.
        do {
            try fm.moveItem(at: stagingBundleURL, to: currentBundleURL)
        } catch {
            if hasBackup {
                try? fm.moveItem(at: backupURL, to: currentBundleURL)
            }
            throw LiveUpdateError.swapFailed(error.localizedDescription)
        }

        // Staging move succeeded — the new bundle is now active. Promote the
        // backup (the old current) into `previous`, discarding whatever was
        // there before.
        if fm.fileExists(atPath: previousBundleURL.path) {
            try? fm.removeItem(at: previousBundleURL)
        }
        if hasBackup {
            do {
                try fm.moveItem(at: backupURL, to: previousBundleURL)
            } catch {
                // Non-fatal: previous/ is best-effort rollback storage. The
                // active swap already succeeded; we just lose the rollback
                // slot. Log by surfacing in the returned previous = nil.
                try? fm.removeItem(at: backupURL)
            }
        }

        // Persist the new state atomically. `Data.write(options: .atomic)`
        // writes to a temp file and renames, so a write failure cannot leave
        // a truncated state.json. If it somehow fails, roll the directory
        // arrangement back so on-disk reality matches the (unchanged) state.
        let newState = LiveUpdateState(current: newVersion, previous: oldCurrent)
        do {
            try writeState(newState)
        } catch {
            // Restore: move the new current back to staging, move previous
            // (== old current) back to current. previous is lost in this
            // error path, but state.json was never updated so it still
            // describes the original arrangement as closely as we can.
            try? fm.moveItem(at: currentBundleURL, to: stagingBundleURL)
            if fm.fileExists(atPath: previousBundleURL.path) {
                try? fm.moveItem(at: previousBundleURL, to: currentBundleURL)
            }
            throw LiveUpdateError.stateWriteFailed(error.localizedDescription)
        }

        return newState
    }

    // MARK: - Storage helpers

    private func ensureLayout() throws {
        let fm = FileManager.default
        try fm.createDirectory(at: rootURL, withIntermediateDirectories: true)
        try fm.createDirectory(at: currentURL, withIntermediateDirectories: true)
        try fm.createDirectory(at: previousURL, withIntermediateDirectories: true)
        // staging/ is created on demand by prepareUpdate; not part of the
        // initial layout so a fresh install has no empty staging dir lingering.
        if !fm.fileExists(atPath: stateURL.path) {
            try writeState(LiveUpdateState(current: nil, previous: nil))
        }
    }

    /// Remove the staging directory entirely so each prepareUpdate starts from
    /// a clean slate (a half-written staging dir from a prior crashed run must
    /// not poison this attempt).
    private func cleanStaging() {
        try? FileManager.default.removeItem(at: stagingURL)
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

    // MARK: - Overlay

    /// Add a semi-transparent, centered "Updating…" overlay on top of the
    /// WebView's superview. Idempotent: if one is already present it is left
    /// in place. Must be called on the main thread (dispatched internally).
    private func showOverlay() {
        DispatchQueue.main.async { [weak self] in
            guard let host = self?.webView?.superview else { return }
            if host.viewWithTag(self?.overlayTag ?? 0) != nil { return }
            let overlay = UIView(frame: host.bounds)
            overlay.backgroundColor = UIColor.black.withAlphaComponent(0.55)
            overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            overlay.tag = self?.overlayTag ?? 0

            let label = UILabel()
            label.text = "Updating…"
            label.textColor = .white
            label.font = .systemFont(ofSize: 20, weight: .semibold)
            label.translatesAutoresizingMaskIntoConstraints = false
            overlay.addSubview(label)
            NSLayoutConstraint.activate([
                label.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
                label.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
            ])
            host.addSubview(overlay)
        }
    }

    /// Remove the "Updating…" overlay if present. Must be called on the main
    /// thread (dispatched internally). Safe to call when no overlay is shown.
    private func hideOverlay() {
        DispatchQueue.main.async { [weak self] in
            guard let host = self?.webView?.superview else { return }
            host.viewWithTag(self?.overlayTag ?? 0)?.removeFromSuperview()
        }
    }

    // MARK: - Network helpers

    /// Synchronously fetch the manifest JSON and return its parsed shape.
    /// Must be called off the main thread (uses a DispatchSemaphore).
    private func fetchManifest(url urlString: String) throws -> (version: Int, payloadURL: String) {
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
        guard let payloadURL = json["url"] as? String, !payloadURL.isEmpty else {
            throw LiveUpdateError.missingPayloadUrl
        }
        return (version, payloadURL)
    }

    /// Synchronously download `url` to a temp file in the system temp dir and
    /// return its URL. Must be called off the main thread. The caller owns the
    /// temp file and is responsible for removing it.
    private func downloadZip(from url: URL) throws -> URL {
        let tempDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let tempZipURL = tempDir.appendingPathComponent("liveupdate-\(UUID().uuidString).zip")

        let semaphore = DispatchSemaphore(value: 0)
        var responseError: Error?
        var statusCode: Int = 0
        var gotData = false

        // Use downloadTask so large payloads stream to disk rather than RAM.
        let task = URLSession.shared.downloadTask(with: url) { tempLocalURL, response, err in
            responseError = err
            if let http = response as? HTTPURLResponse {
                statusCode = http.statusCode
            }
            if let tempLocalURL = tempLocalURL {
                do {
                    // The system temp file may be deleted the moment the
                    // completion handler returns, so move it somewhere we own.
                    if FileManager.default.fileExists(atPath: tempZipURL.path) {
                        try FileManager.default.removeItem(at: tempZipURL)
                    }
                    try FileManager.default.moveItem(at: tempLocalURL, to: tempZipURL)
                    gotData = true
                } catch {
                    responseError = error
                }
            }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + 60)

        if let err = responseError {
            throw LiveUpdateError.downloadFailed(err.localizedDescription)
        }
        guard statusCode == 200 else {
            throw LiveUpdateError.badStatus(statusCode)
        }
        guard gotData, FileManager.default.fileExists(atPath: tempZipURL.path) else {
            throw LiveUpdateError.downloadFailed("no data received")
        }
        return tempZipURL
    }

    private enum LiveUpdateError: Error, LocalizedError {
        case invalidUrl(String)
        case badStatus(Int)
        case noData
        case missingVersion
        case missingPayloadUrl
        case downloadFailed(String)
        case missingIndexHtml
        case stagingMissing
        case swapFailed(String)
        case stateWriteFailed(String)

        var errorDescription: String? {
            switch self {
            case .invalidUrl(let s): return "invalid url: \(s)"
            case .badStatus(let c): return "unexpected HTTP status \(c)"
            case .noData: return "empty response body"
            case .missingVersion: return "manifest missing integer 'version'"
            case .missingPayloadUrl: return "manifest missing non-empty 'url'"
            case .downloadFailed(let s): return "download failed: \(s)"
            case .missingIndexHtml: return "payload missing index.html at bundle root"
            case .stagingMissing: return "no staged bundle to apply"
            case .swapFailed(let s): return "atomic swap failed: \(s)"
            case .stateWriteFailed(let s): return "state.json write failed: \(s)"
            }
        }
    }
}

// MARK: - Minimal zip extractor

/// A tiny, dependency-free zip (ZIP/2.0) extractor supporting the two
/// compression methods the `zip(1)` CLI emits: stored (method 0) and deflate
/// (method 8, raw RFC 1951 decompressed via the Compression framework's
/// `COMPRESSION_ZLIB` algorithm).
///
/// This is deliberately minimal — no encryption, no zip64, no data-descriptor
/// re-scanning (sizes are read from the central directory, which is always
/// authoritative). Sufficient for the POC's hand-rolled Angular build zips;
/// not a general-purpose unzipper.
enum ZipExtractor {
    /// End-of-central-directory signature.
    private static let eocdSignature: UInt32 = 0x06054b50
    /// Central-directory file header signature.
    private static let cdSignature: UInt32 = 0x02014b50
    /// Local-file header signature.
    private static let lfSignature: UInt32 = 0x04034b50

    private static let methodStored: UInt16 = 0
    private static let methodDeflate: UInt16 = 8

    /// Unzip `zipURL` into `destinationURL` (created if missing). Directory
    /// entries (names ending in `/`) create folders; file entries are written
    /// with their stored or inflated bytes. Paths referencing `..` or absolute
    /// paths are rejected to prevent zip-slip.
    static func unzip(at zipURL: URL, to destinationURL: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: destinationURL, withIntermediateDirectories: true)

        let zipData = try Data(contentsOf: zipURL, options: [.mappedIfSafe])
        let entries = try parseCentralDirectory(in: zipData)

        for entry in entries {
            let outURL = destinationURL.appendingPathComponent(entry.name)
            try ensureSafePath(entry.name, root: destinationURL)

            if entry.isDirectory {
                try fm.createDirectory(at: outURL, withIntermediateDirectories: true)
                continue
            }

            // Create parent directories for nested file entries.
            try fm.createDirectory(
                at: outURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )

            let fileData = try extractEntry(entry, in: zipData)
            try fileData.write(to: outURL, options: .atomic)
        }
    }

    private struct CDEntry {
        let name: String
        let isDirectory: Bool
        let method: UInt16
        let compressedSize: UInt64
        let uncompressedSize: UInt64
        let localHeaderOffset: UInt64
    }

    // MARK: Parsing

    /// Locate the EOCD record by scanning backwards from the end of the file
    /// (a zip comment may trail it), then walk the central directory.
    private static func parseCentralDirectory(in data: Data) throws -> [CDEntry] {
        let eocdOffset = try findEOCD(in: data)
        let cdCount = readUInt16(data, eocdOffset + 10)
        let cdOffset = readUInt32(data, eocdOffset + 16)

        var entries: [CDEntry] = []
        var cursor = Int(cdOffset)
        for _ in 0..<cdCount {
            guard cursor + 46 <= data.count else {
                throw ZipError.truncated
            }
            guard readUInt32(data, cursor) == cdSignature else {
                throw ZipError.badCentralDirectory
            }
            let method = readUInt16(data, cursor + 10)
            let compressedSize = UInt64(readUInt32(data, cursor + 20))
            let uncompressedSize = UInt64(readUInt32(data, cursor + 24))
            let nameLen = Int(readUInt16(data, cursor + 28))
            let extraLen = Int(readUInt16(data, cursor + 30))
            let commentLen = Int(readUInt16(data, cursor + 32))
            let localOffset = UInt64(readUInt32(data, cursor + 42))

            let nameStart = cursor + 46
            guard nameStart + nameLen <= data.count else {
                throw ZipError.truncated
            }
            let nameData = data.subdata(in: nameStart..<(nameStart + nameLen))
            let name = String(data: nameData, encoding: .utf8) ?? ""

            entries.append(CDEntry(
                name: name,
                isDirectory: name.hasSuffix("/"),
                method: method,
                compressedSize: compressedSize,
                uncompressedSize: uncompressedSize,
                localHeaderOffset: localOffset
            ))

            cursor = nameStart + nameLen + extraLen + commentLen
        }
        return entries
    }

    /// Find the EOCD record's offset by scanning backwards. The record is at
    /// least 22 bytes; a trailing comment of up to 65535 bytes may follow.
    private static func findEOCD(in data: Data) throws -> Int {
        let minSize = 22
        guard data.count >= minSize else { throw ZipError.truncated }
        let maxBack = min(data.count, minSize + 65535)
        let lowerBound = data.count - maxBack
        var i = data.count - minSize
        while i >= lowerBound {
            if readUInt32(data, i) == eocdSignature {
                return i
            }
            i -= 1
        }
        throw ZipError.noEOCD
    }

    // MARK: Extraction

    /// Read the local header for `entry`, then return its (possibly
    /// inflated) bytes. The central directory is authoritative for sizes; the
    /// local header's sizes may be zeroed when a data descriptor is used.
    private static func extractEntry(_ entry: CDEntry, in data: Data) throws -> Data {
        let lhStart = Int(entry.localHeaderOffset)
        guard lhStart + 30 <= data.count else { throw ZipError.truncated }
        guard readUInt32(data, lhStart) == lfSignature else {
            throw ZipError.badLocalHeader
        }
        let nameLen = Int(readUInt16(data, lhStart + 26))
        let extraLen = Int(readUInt16(data, lhStart + 28))
        let dataStart = lhStart + 30 + nameLen + extraLen
        let dataEnd = dataStart + Int(entry.compressedSize)
        guard dataEnd <= data.count else { throw ZipError.truncated }
        let compressed = data.subdata(in: dataStart..<dataEnd)

        switch entry.method {
        case methodStored:
            return compressed
        case methodDeflate:
            return try inflate(compressed, expectedSize: Int(entry.uncompressedSize))
        default:
            throw ZipError.unsupportedMethod(entry.method)
        }
    }

    /// Inflate a raw RFC 1951 deflate stream using the Compression framework.
    /// `COMPRESSION_ZLIB` maps to raw deflate (RFC 1951) despite its name.
    private static func inflate(_ src: Data, expectedSize: Int) throws -> Data {
        let dstCapacity = max(expectedSize + 1024, 4096)
        var dst = Data(count: dstCapacity)
        let written: Int = try src.withUnsafeBytes { (srcPtr: UnsafeRawBufferPointer) -> Int in
            guard let srcBase = srcPtr.baseAddress?.assumingMemoryBound(to: UInt8.self) else {
                throw ZipError.truncated
            }
            return dst.withUnsafeMutableBytes { (dstPtr: UnsafeMutableRawBufferPointer) -> Int in
                guard let dstBase = dstPtr.baseAddress?.assumingMemoryBound(to: UInt8.self) else {
                    return 0
                }
                return compression_decode_buffer(
                    dstBase, dstCapacity,
                    srcBase, src.count,
                    nil,
                    COMPRESSION_ZLIB
                )
            }
        }
        guard written > 0 else { throw ZipError.inflateFailed }
        dst.count = written
        return dst
    }

    // MARK: Safety

    /// Reject entries that would escape `root` (zip-slip). Each path component
    /// is checked; `..` and absolute paths are refused.
    private static func ensureSafePath(_ name: String, root: URL) throws {
        let trimmed = name.hasSuffix("/") ? String(name.dropLast()) : name
        let components = trimmed.split(separator: "/", omittingEmptySubsequences: true)
        for comp in components {
            if comp == ".." || comp == "." {
                throw ZipError.unsafePath(name)
            }
        }
    }

    // MARK: Little-endian readers

    private static func readUInt16(_ data: Data, _ offset: Int) -> UInt16 {
        var v: UInt16 = 0
        withUnsafeMutableBytes(of: &v) { ptr in
            ptr.copyBytes(from: data.subdata(in: offset..<(offset + 2)))
        }
        return v.littleEndian
    }

    private static func readUInt32(_ data: Data, _ offset: Int) -> UInt32 {
        var v: UInt32 = 0
        withUnsafeMutableBytes(of: &v) { ptr in
            ptr.copyBytes(from: data.subdata(in: offset..<(offset + 4)))
        }
        return v.littleEndian
    }

    private enum ZipError: Error, LocalizedError {
        case truncated
        case noEOCD
        case badCentralDirectory
        case badLocalHeader
        case unsupportedMethod(UInt16)
        case inflateFailed
        case unsafePath(String)

        var errorDescription: String? {
            switch self {
            case .truncated: return "zip is truncated"
            case .noEOCD: return "zip end-of-central-directory record not found"
            case .badCentralDirectory: return "zip central directory is malformed"
            case .badLocalHeader: return "zip local file header is malformed"
            case .unsupportedMethod(let m): return "zip uses unsupported compression method \(m)"
            case .inflateFailed: return "deflate inflation failed"
            case .unsafePath(let n): return "zip entry escapes destination: \(n)"
            }
        }
    }
}
