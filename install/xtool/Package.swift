// swift-tools-version: 6.0

import PackageDescription

// xtool 工程要求：**一个** library product 代表主 App。
// 源码不复制一份，直接指到 ios-build/NengmaoKeBiao，避免两套代码漂移；
// 资源（Web/ Scripts/）由 xtool.yml 负责打包，这里 exclude 掉。
let package = Package(
    name: "NengmaoKeBiao",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "NengmaoKeBiao",
            targets: ["NengmaoKeBiao"]
        ),
    ],
    targets: [
        .target(
            name: "NengmaoKeBiao",
            path: "../../ios-build/NengmaoKeBiao",
            exclude: [
                "Web",
                "Scripts",
                "Assets.xcassets",
                "Info.plist",
            ]
        ),
    ]
)