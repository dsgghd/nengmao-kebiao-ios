import Foundation

/// 把 Swift 字符串安全地写成 JS 字面量（给注入脚本用）。
///
/// 为什么单独一个文件：这里不依赖 UIKit/WebKit/Network，所以可以在非 Apple 平台上
/// **真编译、真运行**（见 tools/swift_literal_test.py）。注入脚本里那句
/// `var seed = {…};` 一旦转义写错，真机上就是整段脚本语法错误、存储悄悄失效，
/// 而这种错误在 Xcode 里编译是看不出来的，只能靠跑起来发现。
enum JSLiteral {
    /// ["k": "v"] -> {"k":"v"}
    static func object(_ dict: [String: String]) -> String {
        if dict.isEmpty { return "{}" }
        let parts = dict.map { string($0.key) + ":" + string($0.value) }
        return "{" + parts.joined(separator: ",") + "}"
    }

    /// Swift 字符串 -> JSON/JS 双引号字符串字面量。
    /// 覆盖：双引号、反斜杠、换行、回车、制表、所有 < 0x20 的控制字符、U+2028/U+2029
    /// （后者在 JS 里是换行符，不转义会让整段脚本解析失败）。
    static func string(_ text: String) -> String {
        var out = "\""
        for scalar in text.unicodeScalars {
            let value = scalar.value
            switch value {
            case 0x22:            // "
                out += "\\\""
            case 0x5C:            // backslash
                out += "\\\\"
            case 0x0A:            // \n
                out += "\\n"
            case 0x0D:            // \r
                out += "\\r"
            case 0x09:            // \t
                out += "\\t"
            case 0x08:            // \b
                out += "\\b"
            case 0x0C:            // \f
                out += "\\f"
            default:
                if value < 0x20 || value == 0x2028 || value == 0x2029 {
                    out += String(format: "\\u%04x", value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        return out + "\""
    }
}