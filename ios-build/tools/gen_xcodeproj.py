#!/usr/bin/env python3
"""生成 NengmaoKeBiao.xcodeproj/project.pbxproj（不依赖 macOS / xcodegen）。

Windows 上没有 XcodeGen，也就不能在本地跑 `xcodegen generate`。为了让工程“打开即用”，
这里直接按 Xcode 14/15 的 OpenStep plist 格式写出 project.pbxproj：

  * Swift 源文件显式列进 Sources（不靠目录扫描，避免把 Info.plist 当资源）
  * Web/ 与 Scripts/ 用 folder reference（蓝色目录）进 Copy Bundle Resources，
    这样 Bundle.main.url(forResource: "Web") 才拿得到目录
  * Assets.xcassets 进 Resources，并设置 AppIcon / AccentColor
  * DEVELOPMENT_TEAM 留空，签名用 Automatic，首次在 Mac 上选一次 Team 即可
  * 构建阶段里有 Resources，但没有对 folder 做逐文件展开——与 Xcode 行为一致

生成后用 tools/validate_project.py 校验（UUID 唯一、文件存在、资源齐全）。
"""
from __future__ import annotations

import hashlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IOS_BUILD = os.path.dirname(HERE)
APP_DIR = os.path.join(IOS_BUILD, "NengmaoKeBiao")
PROJECT_PATH = os.path.join(IOS_BUILD, "NengmaoKeBiao.xcodeproj", "project.pbxproj")

PROJECT_NAME = "NengmaoKeBiao"
TARGET_NAME = "NengmaoKeBiao"
BUNDLE_ID = "com.kebiao.app.ios"
DEPLOYMENT_TARGET = "15.0"
SWIFT_VERSION = "5.0"
MARKETING_VERSION = "1.0"
BUILD_NUMBER = "1"

SWIFT_SOURCES = [
    "MainViewController.swift",
    "ImportViewController.swift",
    "ReminderScheduler.swift",
    "WebStorage.swift",
    "LocalWebServer.swift",
    "CookieVault.swift",
    "JSLiteral.swift",
    "WebAssetPath.swift",
    "CourseMerger.swift",
    "WebStoreFile.swift",
]

RESOURCE_FILES = [
    ("Assets.xcassets", False),
    ("Web", True),      # folder reference
    ("Scripts", True),  # folder reference
]

_seen: set[str] = set()
TARGET_UUID = ""


def uid(name: str) -> str:
    """稳定、唯一、24 位十六进制的对象 ID（Xcode 只要求唯一）。"""
    digest = hashlib.md5(("nengmao-kebiao:" + name).encode("utf-8")).hexdigest().upper()
    candidate = digest[:24]
    salt = 0
    while candidate in _seen:
        salt += 1
        candidate = hashlib.md5(("nengmao-kebiao:%s:%d" % (name, salt)).encode("utf-8")).hexdigest().upper()[:24]
    _seen.add(candidate)
    return candidate


def build() -> str:
    objects: list[str] = []

    def add(uuid: str, body: str) -> None:
        objects.append("\t\t%s = %s" % (uuid, body))

    project_uuid = uid("project")
    target_uuid = uid("target")
    global TARGET_UUID
    TARGET_UUID = target_uuid
    main_group = uid("group:main")
    app_group = uid("group:app")
    products_group = uid("group:products")
    product_ref = uid("fileref:product")

    sources_phase = uid("phase:sources")
    frameworks_phase = uid("phase:frameworks")
    resources_phase = uid("phase:resources")

    project_cfg_list = uid("cfglist:project")
    target_cfg_list = uid("cfglist:target")
    project_debug = uid("cfg:project:debug")
    project_release = uid("cfg:project:release")
    target_debug = uid("cfg:target:debug")
    target_release = uid("cfg:target:release")

    # --- 源文件 ---
    source_refs = []
    source_builds = []
    for name in SWIFT_SOURCES:
        ref = uid("fileref:" + name)
        bf = uid("buildfile:" + name)
        source_refs.append((ref, name))
        source_builds.append((bf, ref, name))
        add(bf, "{isa = PBXBuildFile; fileRef = %s /* %s */; };" % (ref, name))
        add(ref, "{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = %s; sourceTree = \"<group>\"; };" % name)

    # --- 资源 ---
    resource_refs = []
    resource_builds = []
    for name, is_folder in RESOURCE_FILES:
        ref = uid("fileref:" + name)
        bf = uid("buildfile:" + name)
        resource_refs.append((ref, name, is_folder))
        resource_builds.append((bf, ref, name))
        if is_folder:
            file_type = "folder"
        elif name.endswith(".xcassets"):
            file_type = "folder.assetcatalog"
        else:
            file_type = "file"
        add(bf, "{isa = PBXBuildFile; fileRef = %s /* %s */; };" % (ref, name))
        add(ref, "{isa = PBXFileReference; lastKnownFileType = %s; path = %s; sourceTree = \"<group>\"; };" % (file_type, name))

    info_ref = uid("fileref:Info.plist")
    add(info_ref, "{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = \"<group>\"; };")

    add(product_ref,
        "{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; "
        "path = %s.app; sourceTree = BUILT_PRODUCTS_DIR; };" % TARGET_NAME)

    # --- 分组 ---
    add(app_group, "{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n%s\t\t\t);\n\t\t\tpath = %s;\n\t\t\tsourceTree = \"<group>\";\n\t\t};" % (
        "".join("\t\t\t\t%s /* %s */,\n" % (r, n) for r, n in source_refs)
        + "".join("\t\t\t\t%s /* %s */,\n" % (r, n) for r, n, _ in resource_refs)
        + "\t\t\t\t%s /* Info.plist */,\n" % info_ref,
        APP_DIR_NAME,
    ))
    add(products_group, "{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t%s /* %s.app */,\n\t\t\t);\n\t\t\tname = Products;\n\t\t\tsourceTree = \"<group>\";\n\t\t};" % (product_ref, TARGET_NAME))
    add(main_group, "{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t%s /* %s */,\n\t\t\t\t%s /* Products */,\n\t\t\t);\n\t\t\tsourceTree = \"<group>\";\n\t\t};" % (app_group, APP_DIR_NAME, products_group))

    # --- 构建阶段 ---
    add(sources_phase, "{\n\t\t\tisa = PBXSourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n%s\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};" % (
        "".join("\t\t\t\t%s /* %s */,\n" % (bf, n) for bf, _, n in source_builds)))
    add(frameworks_phase, "{\n\t\t\tisa = PBXFrameworksBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};")
    add(resources_phase, "{\n\t\t\tisa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n%s\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};" % (
        "".join("\t\t\t\t%s /* %s */,\n" % (bf, n) for bf, _, n in resource_builds)))

    # --- target ---
    add(target_uuid, "{\n\t\t\tisa = PBXNativeTarget;\n\t\t\tbuildConfigurationList = %s /* Build configuration list for PBXNativeTarget \"%s\" */;\n"
                     "\t\t\tbuildPhases = (\n\t\t\t\t%s /* Sources */,\n\t\t\t\t%s /* Frameworks */,\n\t\t\t\t%s /* Resources */,\n\t\t\t);\n"
                     "\t\t\tbuildRules = (\n\t\t\t);\n\t\t\tdependencies = (\n\t\t\t);\n\t\t\tname = %s;\n\t\t\tproductName = %s;\n"
                     "\t\t\tproductReference = %s /* %s.app */;\n\t\t\tproductType = \"com.apple.product-type.application\";\n\t\t};" % (
                         target_cfg_list, TARGET_NAME, sources_phase, frameworks_phase, resources_phase,
                         TARGET_NAME, TARGET_NAME, product_ref, TARGET_NAME))

    # --- project ---
    add(project_uuid, "{\n\t\t\tisa = PBXProject;\n\t\t\tattributes = {\n\t\t\t\tBuildIndependentTargetsInParallel = 1;\n"
                      "\t\t\t\tLastSwiftUpdateCheck = 1500;\n\t\t\t\tLastUpgradeCheck = 1500;\n"
                      "\t\t\t\tTargetAttributes = {\n\t\t\t\t\t%s = {\n\t\t\t\t\t\tCreatedOnToolsVersion = 15.0;\n"
                      "\t\t\t\t\t\tProvisioningStyle = Automatic;\n\t\t\t\t\t};\n\t\t\t\t};\n\t\t\t};\n"
                      "\t\t\tbuildConfigurationList = %s /* Build configuration list for PBXProject \"%s\" */;\n"
                      "\t\t\tcompatibilityVersion = \"Xcode 14.0\";\n\t\t\tdevelopmentRegion = en;\n"
                      "\t\t\thasScannedForEncodings = 0;\n\t\t\tknownRegions = (\n\t\t\t\ten,\n\t\t\t\tBase,\n\t\t\t\t\"zh-Hans\",\n\t\t\t);\n"
                      "\t\t\tmainGroup = %s;\n\t\t\tproductRefGroup = %s /* Products */;\n\t\t\tprojectDirPath = \"\";\n"
                      "\t\t\tprojectRoot = \"\";\n\t\t\ttargets = (\n\t\t\t\t%s /* %s */,\n\t\t\t);\n\t\t};" % (
                          target_uuid, project_cfg_list, PROJECT_NAME, main_group, products_group, target_uuid, TARGET_NAME))

    # --- 构建配置 ---
    common_project = """\t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
\t\t\t\tCLANG_ANALYZER_NONNULL = YES;
\t\t\t\tCLANG_ANALYZER_NUMBER_OBJECT_CONVERSION = YES_AGGRESSIVE;
\t\t\t\tCLANG_CXX_LANGUAGE_STANDARD = "gnu++20";
\t\t\t\tCLANG_ENABLE_MODULES = YES;
\t\t\t\tCLANG_ENABLE_OBJC_ARC = YES;
\t\t\t\tCLANG_ENABLE_OBJC_WEAK = YES;
\t\t\t\tCLANG_WARN_BLOCK_CAPTURE_AUTORELEASING = YES;
\t\t\t\tCLANG_WARN_BOOL_CONVERSION = YES;
\t\t\t\tCLANG_WARN_COMMA = YES;
\t\t\t\tCLANG_WARN_CONSTANT_CONVERSION = YES;
\t\t\t\tCLANG_WARN_DEPRECATED_OBJC_IMPLEMENTATIONS = YES;
\t\t\t\tCLANG_WARN_DIRECT_OBJC_ISA_USAGE = YES_ERROR;
\t\t\t\tCLANG_WARN_DOCUMENTATION_COMMENTS = YES;
\t\t\t\tCLANG_WARN_EMPTY_BODY = YES;
\t\t\t\tCLANG_WARN_ENUM_CONVERSION = YES;
\t\t\t\tCLANG_WARN_INFINITE_RECURSION = YES;
\t\t\t\tCLANG_WARN_INT_CONVERSION = YES;
\t\t\t\tCLANG_WARN_NON_LITERAL_NULL_CONVERSION = YES;
\t\t\t\tCLANG_WARN_OBJC_IMPLICIT_RETAIN_SELF = YES;
\t\t\t\tCLANG_WARN_OBJC_LITERAL_CONVERSION = YES;
\t\t\t\tCLANG_WARN_OBJC_ROOT_CLASS = YES_ERROR;
\t\t\t\tCLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER = YES;
\t\t\t\tCLANG_WARN_RANGE_LOOP_ANALYSIS = YES;
\t\t\t\tCLANG_WARN_STRICT_PROTOTYPES = YES;
\t\t\t\tCLANG_WARN_SUSPICIOUS_MOVE = YES;
\t\t\t\tCLANG_WARN_UNGUARDED_AVAILABILITY = YES_AGGRESSIVE;
\t\t\t\tCLANG_WARN_UNREACHABLE_CODE = YES;
\t\t\t\tCLANG_WARN__DUPLICATE_METHOD_MATCH = YES;
\t\t\t\tCOPY_PHASE_STRIP = NO;
\t\t\t\tENABLE_STRICT_OBJC_MSGSEND = YES;
\t\t\t\tGCC_C_LANGUAGE_STANDARD = gnu17;
\t\t\t\tGCC_NO_COMMON_BLOCKS = YES;
\t\t\t\tGCC_WARN_64_TO_32_BIT_CONVERSION = YES;
\t\t\t\tGCC_WARN_ABOUT_RETURN_TYPE = YES_ERROR;
\t\t\t\tGCC_WARN_UNDECLARED_SELECTOR = YES;
\t\t\t\tGCC_WARN_UNINITIALIZED_AUTOS = YES_AGGRESSIVE;
\t\t\t\tGCC_WARN_UNUSED_FUNCTION = YES;
\t\t\t\tGCC_WARN_UNUSED_VARIABLE = YES;
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = %s;
\t\t\t\tMTL_FAST_MATH = YES;
\t\t\t\tSDKROOT = iphoneos;
""" % DEPLOYMENT_TARGET

    def config(uuid: str, name: str, base: str, extra: str) -> None:
        add(uuid, "{\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {\n%s%s\t\t\t};\n\t\t\tname = %s;\n\t\t};" % (base, extra, name))

    config(project_debug, "Debug", common_project,
           "\t\t\t\tDEBUG_INFORMATION_FORMAT = dwarf;\n\t\t\t\tENABLE_TESTABILITY = YES;\n"
           "\t\t\t\tGCC_DYNAMIC_NO_PIC = NO;\n\t\t\t\tGCC_OPTIMIZATION_LEVEL = 0;\n"
           "\t\t\t\tGCC_PREPROCESSOR_DEFINITIONS = (\n\t\t\t\t\t\"DEBUG=1\",\n\t\t\t\t\t\"$(inherited)\",\n\t\t\t\t);\n"
           "\t\t\t\tMTL_ENABLE_DEBUG_INFO = INCLUDE_SOURCE;\n\t\t\t\tONLY_ACTIVE_ARCH = YES;\n"
           "\t\t\t\tSWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;\n\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = \"-Onone\";\n")
    config(project_release, "Release", common_project,
           "\t\t\t\tDEBUG_INFORMATION_FORMAT = \"dwarf-with-dsym\";\n\t\t\t\tENABLE_NS_ASSERTIONS = NO;\n"
           "\t\t\t\tMTL_ENABLE_DEBUG_INFO = NO;\n\t\t\t\tSWIFT_COMPILATION_MODE = wholemodule;\n"
           "\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = \"-O\";\n\t\t\t\tVALIDATE_PRODUCT = YES;\n")

    target_common = """\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
\t\t\t\tASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor;
\t\t\t\tCLANG_ENABLE_MODULES = YES;
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = %s;
\t\t\t\tDEVELOPMENT_TEAM = "";
\t\t\t\tENABLE_PREVIEWS = YES;
\t\t\t\tGENERATE_INFOPLIST_FILE = NO;
\t\t\t\tINFOPLIST_FILE = %s/Info.plist;
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = %s;
\t\t\t\tLD_RUNPATH_SEARCH_PATHS = (
\t\t\t\t\t"$(inherited)",
\t\t\t\t\t"@executable_path/Frameworks",
\t\t\t\t);
\t\t\t\tMARKETING_VERSION = %s;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = %s;
\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";
\t\t\t\tSWIFT_EMIT_LOC_STRINGS = YES;
\t\t\t\tSWIFT_VERSION = %s;
\t\t\t\tTARGETED_DEVICE_FAMILY = 1;
""" % (BUILD_NUMBER, APP_DIR_NAME, DEPLOYMENT_TARGET, MARKETING_VERSION, BUNDLE_ID, SWIFT_VERSION)

    config(target_debug, "Debug", target_common, "")
    config(target_release, "Release", target_common, "")

    add(project_cfg_list, "{\n\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = (\n\t\t\t\t%s /* Debug */,\n\t\t\t\t%s /* Release */,\n\t\t\t);\n"
                          "\t\t\tdefaultConfigurationIsVisible = 0;\n\t\t\tdefaultConfigurationName = Release;\n\t\t};" % (project_debug, project_release))
    add(target_cfg_list, "{\n\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = (\n\t\t\t\t%s /* Debug */,\n\t\t\t\t%s /* Release */,\n\t\t\t);\n"
                         "\t\t\tdefaultConfigurationIsVisible = 0;\n\t\t\tdefaultConfigurationName = Release;\n\t\t};" % (target_debug, target_release))

    header = "// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 56;\n\tobjects = {\n"
    footer = "\t};\n\trootObject = %s /* Project object */;\n}\n" % project_uuid
    return header + "\n".join(objects) + "\n" + footer


APP_DIR_NAME = "NengmaoKeBiao"
SCHEME_PATH = os.path.join(IOS_BUILD, "NengmaoKeBiao.xcodeproj", "xcshareddata", "xcschemes", "NengmaoKeBiao.xcscheme")

SCHEME_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "1500" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "{target_uuid}"
               BuildableName = "{target}.app"
               BlueprintName = "{target}"
               ReferencedContainer = "container:{target}.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv = "YES">
      <Testables>
      </Testables>
   </TestAction>
   <LaunchAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" debugServiceExtension = "internal" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "{target_uuid}"
            BuildableName = "{target}.app"
            BlueprintName = "{target}"
            ReferencedContainer = "container:{target}.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction buildConfiguration = "Release" shouldUseLaunchSchemeArgsEnv = "YES" savedToolIdentifier = "" useCustomWorkingDirectory = "NO" debugDocumentVersioning = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "{target_uuid}"
            BuildableName = "{target}.app"
            BlueprintName = "{target}"
            ReferencedContainer = "container:{target}.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction buildConfiguration = "Release" revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
"""


def write_scheme(target_uuid: str) -> None:
    """共享 scheme：没有它，xcodebuild -scheme 在没打开过 Xcode 的机器上会找不到 scheme。"""
    os.makedirs(os.path.dirname(SCHEME_PATH), exist_ok=True)
    with open(SCHEME_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(SCHEME_TEMPLATE.format(target_uuid=target_uuid, target=TARGET_NAME))


def main() -> int:
    text = build()
    os.makedirs(os.path.dirname(PROJECT_PATH), exist_ok=True)
    with open(PROJECT_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    write_scheme(TARGET_UUID)
    print("已写出 %s (%d 字节, %d 个对象)" % (PROJECT_PATH, len(text.encode("utf-8")), len(_seen)))
    print("已写出共享 scheme %s" % SCHEME_PATH)
    return 0


if __name__ == "__main__":
    sys.exit(main())