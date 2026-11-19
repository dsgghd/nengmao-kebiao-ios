import Foundation

/// 多帧课表合并器：按“课程身份”去重，同一课程的多份结果把周次取并集。
///
/// 抽出来的原因：这段逻辑决定“自动导入到底抓全了没有”，也是最容易写出
/// “丢课 / 重复课 / 周次被覆盖”的地方。它只用 Foundation，因此可以在 Windows 上
/// 用真 Swift 编译器跑单测（tools/swift_unit_tests.py）。
///
/// 行为（与导入页原有实现一致，测试锁死）：
///   * 身份 = 名称 + 教师 + 课程号 + 教室 + 校区 + 星期 + 起节 + 止节
///   * 名称为空 → 丢弃
///   * 已存在且周次并集没有变大 → 返回 false（不算变化，不重置安静期）
///   * 周次只接受 1...60 的整数，输出为升序数组
struct CourseMerger {
    private var merged: [String: [String: Any]] = [:]
    private var order: [String] = []

    var count: Int { order.count }

    /// 按到达顺序输出合并结果。
    var courses: [[String: Any]] {
        return order.compactMap { merged[$0] }
    }

    mutating func reset() {
        merged.removeAll()
        order.removeAll()
    }

    /// 返回是否产生了新信息（新课程，或周次并集变大）。
    @discardableResult
    mutating func merge(_ course: [String: Any]) -> Bool {
        let key = CourseMerger.key(for: course)
        guard !key.isEmpty else { return false }

        let weeks = CourseMerger.weekSet(course["weeks"])
        if var existing = merged[key] {
            let old = CourseMerger.weekSet(existing["weeks"])
            let union = old.union(weeks)
            if union.count == old.count { return false }
            existing["weeks"] = union.sorted()
            merged[key] = existing
            return true
        }

        var normalized = course
        normalized["weeks"] = weeks.sorted()
        merged[key] = normalized
        order.append(key)
        return true
    }

    // MARK: - 身份与取值

    static func key(for course: [String: Any]) -> String {
        let name = (course["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return "" }
        let teacher = (course["teacher"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let code = (course["code"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let room = (course["room"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let campus = (course["campus"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let day = intValue(course["day"]) ?? 0
        let start = intValue(course["startPeriod"]) ?? 0
        let end = intValue(course["endPeriod"]) ?? 0
        return [name, teacher, code, room, campus, "\(day)", "\(start)", "\(end)"].joined(separator: "|")
    }

    static func weekSet(_ value: Any?) -> Set<Int> {
        var out = Set<Int>()
        if let array = value as? [Any] {
            for item in array {
                if let week = intValue(item), week >= 1, week <= 60 {
                    out.insert(week)
                }
            }
        } else if let single = intValue(value), single >= 1, single <= 60 {
            // 兼容个别解析器直接给一个数字（不是数组）的情况。
            out.insert(single)
        }
        return out
    }

    static func intValue(_ value: Any?) -> Int? {
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String {
            let trimmed = string.trimmingCharacters(in: .whitespaces)
            if let parsed = Int(trimmed) { return parsed }
            // "1.0" 这种浮点写法也接受
            if let double = Double(trimmed) { return Int(double) }
        }
        return nil
    }
}