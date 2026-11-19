// AppleStubs —— 只为“在 Windows 上做类型检查”而存在的假框架。
//
// 用途：本机没有 UIKit/WebKit/Network/UserNotifications/Security，但 Swift 编译器是真的。
// 把这些框架里**本工程用到的** API 按真实签名写成桩，就能让 swiftc 对 App 源码做类型检查，
// 抓出“自己写错”的那类问题（可选值、闭包签名、协议实现、重载选择、属性名拼错）。
//
// 边界（很重要）：桩的签名是我按 Apple 文档手写的，所以它**不能**证明“我记的 API 就是 Apple 的 API”。
// 它只能证明“代码内部自洽”。真正的 API 校验仍然只能靠 Xcode。
//
// 另外 Windows 版 Foundation 把 HTTPCookie / URLCredential / URLAuthenticationChallenge
// 砍成了 AnyObject 占位，所以类型检查时把源码里这几个名字换成下面的 T* 版本（只换名字，不改用法）。

import Foundation
import FoundationNetworking

// MARK: - Security

public let TTAuthMethodServerTrust = "NSURLAuthenticationMethodServerTrust"

public final class SecTrust {
    public init() {}
}

public func SecTrustEvaluateWithError(_ trust: SecTrust, _ error: UnsafeMutablePointer<AnyObject?>?) -> Bool {
    return true
}

// MARK: - Foundation 在 Windows 上的替身（仅名字不同，API 形状与 Apple 一致）

public final class TCookie {
    public let name: String
    public let value: String
    public let domain: String
    public let path: String
    public let isSecure: Bool
    public let isHTTPOnly: Bool
    public let version: Int
    public let expires: Date?

    public init?(properties: [HTTPCookiePropertyKey: Any]) {
        guard let name = properties[.name] as? String,
              let value = properties[.value] as? String,
              let domain = properties[.domain] as? String else { return nil }
        self.name = name
        self.value = value
        self.domain = domain
        self.path = properties[.path] as? String ?? "/"
        self.isSecure = (properties[.secure] as? String) == "TRUE"
        self.isHTTPOnly = (properties[HTTPCookiePropertyKey(rawValue: "HttpOnly")] as? String) == "TRUE"
        self.version = properties[.version] as? Int ?? 0
        self.expires = properties[.expires] as? Date
    }
}

public final class TCookieStorage {
    public static let shared = TCookieStorage()
    public func cookies(for url: URL) -> [TCookie]? { return [] }
    public func setCookie(_ cookie: TCookie) {}
}

public final class TCredential {
    public init(trust: SecTrust) {}
}

public final class TProtectionSpace {
    public let authenticationMethod: String = TTAuthMethodServerTrust
    public let host: String = ""
    public let serverTrust: SecTrust? = SecTrust()
}

public final class TChallenge {
    public let protectionSpace: TProtectionSpace = TProtectionSpace()
}

// MARK: - UIKit

open class UIResponder {
    public init() {}
}

public enum UIInterfaceOrientation { case portrait }

public struct UIUserNotificationSettingsStub {}

public protocol UIApplicationDelegate: AnyObject {
    var window: UIWindow? { get set }
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool
}

public extension UIApplicationDelegate {
    static func main() {}
}

public final class UIApplication {
    public struct LaunchOptionsKey: RawRepresentable, Hashable {
        public let rawValue: String
        public init(rawValue: String) { self.rawValue = rawValue }
    }
    public static let shared = UIApplication()
    public func open(_ url: URL, options: [String: Any] = [:], completionHandler: ((Bool) -> Void)? = nil) {}

    public static let didEnterBackgroundNotification = Notification.Name("didEnterBackground")
    public static let willTerminateNotification = Notification.Name("willTerminate")
}

public final class UIWindow {
    public var rootViewController: UIViewController?
    public init(frame: CGRect) { }
    public func makeKeyAndVisible() {}
}

open class UIViewController: UIResponder {
    open var view: UIView = UIView()
    open var presentedViewController: UIViewController?
    open var presentingViewController: UIViewController?
    open var navigationController: UINavigationController?
    open var isBeingDismissed: Bool = false
    open var modalPresentationStyle: UIModalPresentationStyle = .fullScreen
    open var popoverPresentationController: UIPopoverPresentationController?

    public override init() { super.init() }
    public init(nibName: String?, bundle: Bundle?) { super.init() }
    public required init?(coder: NSCoder) {}
    open func viewDidLoad() {}
    open func viewDidDisappear(_ animated: Bool) {}
    open func present(_ viewControllerToPresent: UIViewController, animated: Bool, completion: (() -> Void)? = nil) {}
    open func dismiss(animated: Bool, completion: (() -> Void)? = nil) {}
}

public enum UIModalPresentationStyle { case fullScreen, automatic }

public final class UINavigationController: UIViewController {
    public override var isBeingDismissed: Bool { get { return false } set {} }
}

public final class UIPopoverPresentationController {
    public var sourceView: UIView?
    public var sourceRect: CGRect = .zero
}

open class UIView: UIResponder {
    public var backgroundColor: UIColor?
    public var translatesAutoresizingMaskIntoConstraints: Bool = true
    public var bounds: CGRect = .zero
    public var window: UIWindow?
    public var hidden: Bool = false
    public var safeAreaLayoutGuide: UILayoutGuide = UILayoutGuide()
    public init(frame: CGRect = .zero) {}
    public func addSubview(_ view: UIView) {}
    public func removeFromSuperview() {}
    public var topAnchor: NSLayoutYAxisAnchor { return NSLayoutYAxisAnchor() }
    public var bottomAnchor: NSLayoutYAxisAnchor { return NSLayoutYAxisAnchor() }
    public var leadingAnchor: NSLayoutXAxisAnchor { return NSLayoutXAxisAnchor() }
    public var trailingAnchor: NSLayoutXAxisAnchor { return NSLayoutXAxisAnchor() }
    public var centerYAnchor: NSLayoutYAxisAnchor { return NSLayoutYAxisAnchor() }
    public var centerXAnchor: NSLayoutXAxisAnchor { return NSLayoutXAxisAnchor() }
    public var widthAnchor: NSLayoutDimension { return NSLayoutDimension() }
    public var heightAnchor: NSLayoutDimension { return NSLayoutDimension() }
}

public final class UIScrollView: UIView {
    public enum ContentInsetAdjustmentBehavior { case never, automatic }
    public var contentInsetAdjustmentBehavior: ContentInsetAdjustmentBehavior = .automatic
}

public final class UILayoutGuide {
    public var topAnchor: NSLayoutYAxisAnchor { return NSLayoutYAxisAnchor() }
    public var bottomAnchor: NSLayoutYAxisAnchor { return NSLayoutYAxisAnchor() }
    public var leadingAnchor: NSLayoutXAxisAnchor { return NSLayoutXAxisAnchor() }
    public var trailingAnchor: NSLayoutXAxisAnchor { return NSLayoutXAxisAnchor() }
}

public final class NSLayoutConstraint {
    public static func activate(_ constraints: [NSLayoutConstraint]) {}
}

public final class NSLayoutAnchor<AnchorType> {
    public init() {}
    public func constraint(equalTo anchor: NSLayoutAnchor<AnchorType>) -> NSLayoutConstraint { return NSLayoutConstraint() }
    public func constraint(equalTo anchor: NSLayoutAnchor<AnchorType>, constant: CGFloat) -> NSLayoutConstraint { return NSLayoutConstraint() }
    public func constraint(greaterThanOrEqualTo anchor: NSLayoutAnchor<AnchorType>, constant: CGFloat) -> NSLayoutConstraint { return NSLayoutConstraint() }
    public func constraint(lessThanOrEqualTo anchor: NSLayoutAnchor<AnchorType>, constant: CGFloat) -> NSLayoutConstraint { return NSLayoutConstraint() }
}

public typealias NSLayoutXAxisAnchor = NSLayoutAnchor<AnyObject>
public typealias NSLayoutYAxisAnchor = NSLayoutAnchor<AnyObject>

public final class NSLayoutDimension {
    public func constraint(equalToConstant c: CGFloat) -> NSLayoutConstraint { return NSLayoutConstraint() }
}

public final class UILabel: UIView {
    public init() { super.init(frame: .zero) }
    public var text: String?
    public var font: UIFont = UIFont.systemFont(ofSize: 12)
    public var textColor: UIColor?
    public var numberOfLines: Int = 1
    public var textAlignment: NSTextAlignment = .natural
    public var lineBreakMode: NSLineBreakMode = .byTruncatingTail
}

public enum NSTextAlignment { case natural, center, left, right }
public enum NSLineBreakMode { case byTruncatingTail, byWordWrapping }

public final class Selector {}

// Windows 版 Foundation 只有 block 形式的 addObserver（Objective-C 的 selector 版本不存在）。
// App 用的是真 iOS 的 selector 版本，这里补一个同形重载让类型检查能过。
public extension NotificationCenter {
    func addObserver(_ observer: Any, selector aSelector: Selector, name aName: NSNotification.Name?, object anObject: Any?) {}
}

public func TSelector(_ name: String) -> Selector { return Selector() }

public final class UIButton: UIView {
    public enum ButtonType { case system, custom }
    public let titleLabel: UILabel? = UILabel()
    public init(type: ButtonType) { super.init() }
    public func setTitle(_ title: String?, for state: UIControl.State) {}
    public func setTitleColor(_ color: UIColor?, for state: UIControl.State) {}
    public func addTarget(_ target: Any?, action: Selector, for event: UIControl.Event) {}
}

public final class UIControl {
    public struct State: RawRepresentable {
        public let rawValue: UInt
        public init(rawValue: UInt) { self.rawValue = rawValue }
        public static let normal = State(rawValue: 0)
    }
    public struct Event: RawRepresentable {
        public let rawValue: UInt
        public init(rawValue: UInt) { self.rawValue = rawValue }
        public static let touchUpInside = Event(rawValue: 1 << 6)
    }
}

public final class UIActivityIndicatorView: UIView {
    public enum Style { case medium, large }
    public var color: UIColor?
    public init(style: Style) { super.init() }
    public func startAnimating() {}
    public func stopAnimating() {}
}

public final class UIActivityViewController: UIViewController {
    public init(activityItems: [Any], applicationActivities: [AnyObject]?) { super.init(nibName: nil, bundle: nil) }
    public required init?(coder: NSCoder) { super.init(coder: coder) }
}

public final class UIPasteboard {
    public static let general = UIPasteboard()
    public var string: String?
}

public final class UIFont {
    public init() {}
    public enum Weight { case regular, medium, bold, black }
    public static func systemFont(ofSize size: CGFloat, weight: Weight = .regular) -> UIFont { return UIFont() }
}

public final class UIColor {
    public init(red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat) {}
    public static let darkGray = UIColor(red: 0.3, green: 0.3, blue: 0.3, alpha: 1)
    public static let black = UIColor(red: 0, green: 0, blue: 0, alpha: 1)
    public static let white = UIColor(red: 1, green: 1, blue: 1, alpha: 1)
    public static let clear = UIColor(red: 0, green: 0, blue: 0, alpha: 0)
}

public enum UIScreen {
    public static let main = Screen()
    public final class Screen {
        public var bounds: CGRect = .zero
    }
}

public enum UIListContentTextAlignment { case center }

public final class UIAlertController: UIViewController {
    public enum Style { case alert, actionSheet }
    public var title: String?
    public var message: String?
    public init(title: String?, message: String?, preferredStyle: Style) { super.init(nibName: nil, bundle: nil) }
    public required init?(coder: NSCoder) { super.init(coder: coder) }
    public func addAction(_ action: UIAlertAction) {}
}

public final class UIAlertAction {
    public enum Style { case `default`, cancel, destructive }
    public init(title: String?, style: Style, handler: ((UIAlertAction) -> Void)? = nil) {}
}

// MARK: - WebKit

public final class WKWebViewConfiguration {
    public init() {}
    public var defaultWebpagePreferences = WKWebpagePreferences()
    public var preferences = WKPreferences()
    public var websiteDataStore = WKWebsiteDataStore.default()
    public var userContentController = WKUserContentController()
}

public final class WKPreferences {
    public var javaScriptCanOpenWindowsAutomatically: Bool = false
}

public final class WKWebpagePreferences {
    public enum ContentMode { case mobile, desktop }
    public var allowsContentJavaScript: Bool = true
    public var preferredContentMode: ContentMode = .mobile
}

public final class WKWebsiteDataStore {
    public init() {}
    public static func `default`() -> WKWebsiteDataStore { return WKWebsiteDataStore() }
    public var httpCookieStore = WKHTTPCookieStore()
}

public final class WKHTTPCookieStore {
    public init() {}
    public func getAllCookies(_ completion: @escaping ([TCookie]) -> Void) { completion([]) }
    public func setCookie(_ cookie: TCookie, completionHandler: (() -> Void)? = nil) { completionHandler?() }
}

public final class WKUserContentController {
    public init() {}
    public func add(_ scriptMessageHandler: WKScriptMessageHandler, name: String) {}
    public func removeScriptMessageHandler(forName name: String) {}
    public func addUserScript(_ userScript: WKUserScript) {}
    public func removeAllUserScripts() {}
}

public enum WKUserScriptInjectionTime { case atDocumentStart, atDocumentEnd }

public final class WKUserScript {
    public init(source: String, injectionTime: WKUserScriptInjectionTime, forMainFrameOnly: Bool) {}
}

public final class WKFrameInfo {
    public var isMainFrame: Bool = true
}

public final class WKScriptMessage {
    public var body: Any = 0
    public var name: String = ""
    public var frameInfo = WKFrameInfo()
}

public protocol WKScriptMessageHandler: AnyObject {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage)
}

public final class WKNavigation {}

public enum WKNavigationActionPolicy { case allow, cancel }

public final class WKNavigationAction {
    public var request: URLRequest = URLRequest(url: URL(string: "about:blank")!)
    public var targetFrame: WKFrameInfo?
}

public final class WKWindowFeatures {}

public protocol WKNavigationDelegate: AnyObject {}

public protocol WKUIDelegate: AnyObject {}

public final class WKWebView: UIView {
    public var navigationDelegate: WKNavigationDelegate?
    public var uiDelegate: WKUIDelegate?
    public var customUserAgent: String?
    public var allowsBackForwardNavigationGestures: Bool = false
    public var scrollView = UIScrollView()
    public var url: URL?
    public var isInspectable: Bool = false
    public var configuration: WKWebViewConfiguration

    public init(frame: CGRect, configuration: WKWebViewConfiguration) {
        self.configuration = configuration
        super.init(frame: frame)
    }

    public func load(_ request: URLRequest) -> WKNavigation? { return nil }
    public func loadFileURL(_ url: URL, allowingReadAccessTo readAccessURL: URL) -> WKNavigation? { return nil }
    public func reload() -> WKNavigation? { return nil }
    public func stopLoading() {}
    public func evaluateJavaScript(_ javaScriptString: String,
                                  completionHandler: ((Any?, (any Error)?) -> Void)? = nil) {}

    public func callAsyncJavaScript(_ functionBody: String,
                                    arguments: [String: Any] = [:],
                                    in frame: WKFrameInfo? = nil,
                                    in contentWorld: WKContentWorld,
                                    completionHandler: ((Result<Any, any Error>) -> Void)? = nil) {}

    public func callAsyncJavaScript(_ functionBody: String,
                                    arguments: [String: Any] = [:],
                                    in frame: WKFrameInfo? = nil,
                                    contentWorld: WKContentWorld) async throws -> Any {
        return 0
    }
}

public final class WKContentWorld {
    public static let page = WKContentWorld()
}

// MARK: - Network

public final class NWEndpoint {
    public struct Port: RawRepresentable {
        public let rawValue: UInt16
        public init?(rawValue: UInt16) { self.rawValue = rawValue }
    }
}

public final class NWParameters {
    public init() {}
    public static let tcp = NWParameters()
    public var allowLocalEndpointReuse: Bool = false
}

public enum NWError: Error {
    case posix(code: Int32)
}

public final class NWListener {
    public enum State {
        case setup, waiting, ready, failed(NWError), cancelled
    }
    public var newConnectionHandler: ((NWConnection) -> Void)?
    public var stateUpdateHandler: ((State) -> Void)?
    public init(using parameters: NWParameters, on port: NWEndpoint.Port) throws {}
    public func start(queue: DispatchQueue) {}
    public func cancel() {}
}

public final class NWConnection {
    public final class ContentContext {}
    public enum SendCompletion {
        case contentProcessed(((NWError?) -> Void)?)
        case idempotent
    }
    public func start(queue: DispatchQueue) {}
    public func receive(minimumIncompleteLength: Int,
                        maximumLength: Int,
                        completion: @escaping (Data?, ContentContext?, Bool, NWError?) -> Void) {}
    public func send(content: Data?, completion: SendCompletion) {}
    public func cancel() {}
}

// MARK: - UserNotifications

public struct UNAuthorizationOptions: OptionSet {
    public let rawValue: UInt
    public init(rawValue: UInt) { self.rawValue = rawValue }
    public static let alert = UNAuthorizationOptions(rawValue: 1 << 0)
    public static let sound = UNAuthorizationOptions(rawValue: 1 << 1)
    public static let badge = UNAuthorizationOptions(rawValue: 1 << 2)
}

public struct UNNotificationPresentationOptions: OptionSet {
    public let rawValue: UInt
    public init(rawValue: UInt) { self.rawValue = rawValue }
    public static let badge = UNNotificationPresentationOptions(rawValue: 1 << 0)
    public static let sound = UNNotificationPresentationOptions(rawValue: 1 << 1)
    public static let banner = UNNotificationPresentationOptions(rawValue: 1 << 4)
}

public final class UNNotification {}

public final class UNNotificationSound {
    public init() {}
    public static let `default` = UNNotificationSound()
}

public final class UNMutableNotificationContent {
    public init() {}
    public var title: String = ""
    public var body: String = ""
    public var sound: UNNotificationSound?
}

public final class UNTimeIntervalNotificationTrigger {
    public init() {}
    public init(timeInterval: TimeInterval, repeats: Bool) {}
}

public final class UNNotificationRequest {
    public init(identifier: String, content: UNMutableNotificationContent, trigger: UNTimeIntervalNotificationTrigger?) {}
}

public protocol UNUserNotificationCenterDelegate: AnyObject {}

public final class UNUserNotificationCenter {
    public static func current() -> UNUserNotificationCenter { return UNUserNotificationCenter() }
    public var delegate: UNUserNotificationCenterDelegate?
    public func requestAuthorization(options: UNAuthorizationOptions,
                                     completionHandler: @escaping (Bool, (any Error)?) -> Void) {}
    public func removeAllPendingNotificationRequests() {}
    public func add(_ request: UNNotificationRequest, withCompletionHandler completionHandler: (((any Error)?) -> Void)? = nil) {}
}