// swift-tools-version: 5.9
import PackageDescription

// Local Capacitor plugin package for the live-updates POC. The package/product/
// target name (`LiveUpdatePlugin`) matches what `cap sync` derives via
// `fixName("live-update-plugin")` so it can be referenced from the generated
// `CapApp-SPM/Package.swift` as `.product(name: "LiveUpdatePlugin", ...)`.
let package = Package(
    name: "LiveUpdatePlugin",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "LiveUpdatePlugin",
            targets: ["LiveUpdatePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "LiveUpdatePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/LiveUpdatePlugin")
    ]
)
