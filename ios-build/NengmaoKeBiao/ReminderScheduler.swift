import Foundation
import UserNotifications

/// 网页会通过 AndroidBridge.syncReminders(JSON) 传入未来 30 天的提醒：
/// [{ id, at: 毫秒时间戳, title, body }]
final class ReminderScheduler {
    static let shared = ReminderScheduler()
    private let center = UNUserNotificationCenter.current()

    func sync(json: String) {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let items = object as? [[String: Any]] else {
            return
        }
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            self.center.removeAllPendingNotificationRequests()
            let now = Date().timeIntervalSince1970
            var scheduled = 0
            for item in items {
                if scheduled >= 60 { break }
                guard let at = (item["at"] as? NSNumber)?.doubleValue else { continue }
                let fireAt = at / 1000.0
                let interval = fireAt - now
                if interval <= 1 { continue }

                let content = UNMutableNotificationContent()
                content.title = item["title"] as? String ?? "能猫课表"
                content.body = item["body"] as? String ?? ""
                content.sound = .default

                let id = item["id"] as? String ?? UUID().uuidString
                let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
                self.center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
                scheduled += 1
            }
        }
    }
}