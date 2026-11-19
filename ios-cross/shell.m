// 极小的 iOS App 入口。故意**不 include 任何 SDK 头文件**：
// Windows 上没有 iPhoneOS.sdk 的 usr/include，但我们已经有了 .tbd 链接桩，
// 所以这里把用到的类型和函数自己声明一遍，就能编译 + 链接出 arm64 Mach-O。
//
// 干的事：用 ObjC 运行时在 main() 里现场造一个 AppDelegate 类，
// 然后 UIApplicationMain 起 App；didFinishLaunching 里建 UIWindow + WKWebView，
// 加载 bundle 里的 Web/index.html（allowingReadAccessToURL 指向 Web 目录）。
//
// 这样不需要 Xcode、不需要 Swift 的 iOS 标准库，也不需要任何头文件。

typedef signed char BOOL;
typedef unsigned long NSUInteger;
typedef unsigned int uint32_t;

typedef struct { double x, y; } CGPoint;
typedef struct { double width, height; } CGSize;
typedef struct { CGPoint origin; CGSize size; } CGRect;

// ---- C 运行时（libSystem） ----
extern void *malloc(unsigned long);
extern int strcmp(const char *, const char *);
extern unsigned long strlen(const char *);
extern char *strcpy(char *, const char *);
extern int _NSGetExecutablePath(char *buf, uint32_t *bufsize);

// ---- ObjC 运行时 ----
extern void *objc_getClass(const char *name);
extern void *sel_registerName(const char *name);
extern void *objc_msgSend(void *self, void *op, ...);
extern void *objc_allocateClassPair(void *superclass, const char *name, unsigned long extraBytes);
extern void objc_registerClassPair(void *cls);
extern BOOL class_addMethod(void *cls, void *sel, void *imp, const char *types);

// ---- UIKit / WebKit ----
extern int UIApplicationMain(int argc, char *argv[], void *principalClassName, void *delegateClassName);

// objc_msgSend 的几种调用签名（arm64 上结构体返回走隐藏指针，必须按真实签名转型）
typedef void *(*Msg0)(void *, void *);
typedef void *(*Msg1)(void *, void *, void *);
typedef void *(*Msg2)(void *, void *, void *, void *);
typedef void *(*Msg3)(void *, void *, void *, void *, void *);
typedef CGRect (*MsgRect)(void *, void *);
typedef void *(*MsgInitRect)(void *, void *, CGRect);
typedef void *(*MsgInitRectObj)(void *, void *, CGRect, void *);
typedef BOOL (*MsgBool1)(void *, void *, void *);
typedef BOOL (*MsgBool2)(void *, void *, void *, void *);
typedef void (*MsgVoid)(void *, void *);

#define SELC(s) sel_registerName(s)
#define CLS(s) objc_getClass(s)
#define SEND0(o, s) ((Msg0)objc_msgSend)((o), SELC(s))
#define SEND1(o, s, a) ((Msg1)objc_msgSend)((o), SELC(s), (a))
#define SEND2(o, s, a, b) ((Msg2)objc_msgSend)((o), SELC(s), (a), (b))
#define SEND3(o, s, a, b, c) ((Msg3)objc_msgSend)((o), SELC(s), (a), (b), (c))

static void *nsstring(const char *utf8) {
    return SEND1(CLS("NSString"), "stringWithUTF8String:", (void *)utf8);
}

// 把可执行文件所在目录（也就是 .app 根目录）写进 out
static void bundle_path(char *out, unsigned long cap) {
    uint32_t size = (uint32_t)cap;
    if (_NSGetExecutablePath(out, &size) != 0) { out[0] = 0; return; }
    long i = (long)strlen(out) - 1;
    while (i > 0 && out[i] != '/') { i--; }
    out[i] = 0;                     // 去掉 /NengmaoKeBiao
    if (strlen(out) == 0) { strcpy(out, "."); }
}

// application:didFinishLaunchingWithOptions:
static BOOL app_did_finish(void *self, void *cmd, void *application, void *options) {
    (void)self; (void)cmd; (void)application; (void)options;

    CGRect bounds = ((MsgRect)objc_msgSend)(SEND0(CLS("UIScreen"), "mainScreen"), SELC("bounds"));

    void *window = SEND0(CLS("UIWindow"), "alloc");
    window = ((MsgInitRect)objc_msgSend)(window, SELC("initWithFrame:"), bounds);

    void *config = SEND0(SEND0(CLS("WKWebViewConfiguration"), "alloc"), "init");
    SEND1(config, "setAllowsInlineMediaPlayback:", (void *)1);

    void *web = SEND0(CLS("WKWebView"), "alloc");
    web = ((MsgInitRectObj)objc_msgSend)(web, SELC("initWithFrame:configuration:"), bounds, config);
    SEND1(web, "setOpaque:", (void *)0);

    void *vc = SEND0(SEND0(CLS("UIViewController"), "alloc"), "init");
    SEND1(vc, "setView:", web);

    SEND1(window, "setRootViewController:", vc);
    SEND0(window, "makeKeyAndVisible");

    // bundle/Web/index.html
    char exe[4096];
    bundle_path(exe, sizeof(exe));
    char html[4300];
    char webdir[4300];
    strcpy(html, exe); strcpy(webdir, exe);
    strcpy(html + strlen(html), "/Web/index.html");
    strcpy(webdir + strlen(webdir), "/Web");

    void *url = SEND1(SEND0(CLS("NSURL"), "alloc"), "initFileURLWithPath:", nsstring(html));
    void *root = SEND1(SEND0(CLS("NSURL"), "alloc"), "initFileURLWithPath:", nsstring(webdir));
    SEND2(web, "loadFileURL:allowingReadAccessToURL:", url, root);

    return (BOOL)1;
}

int main(int argc, char *argv[]) {
    void *cls = objc_allocateClassPair(CLS("UIResponder"), "NengmaoAppDelegate", 0);
    if (cls) {
        class_addMethod(cls, SELC("application:didFinishLaunchingWithOptions:"),
                        (void *)app_did_finish, "c@:@@");
        objc_registerClassPair(cls);
    }
    return UIApplicationMain(argc, argv, (void *)0, nsstring("NengmaoAppDelegate"));
}