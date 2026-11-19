#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""课程表本地服务器：修正 js / webmanifest 的 MIME，并自动打开浏览器。

默认监听 0.0.0.0，同一 Wi-Fi 下的手机可以访问。
只想本机使用：python server.py 8765 --local
"""

import http.server
import mimetypes
import os
import socket
import socketserver
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("text/calendar", ".ics")
mimetypes.add_type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx")

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8765
LOCAL_ONLY = "--local" in sys.argv
OPEN_BROWSER = "--no-browser" not in sys.argv
HOST = "127.0.0.1" if LOCAL_ONLY else "0.0.0.0"


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        # 安静一点，只保留错误
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    local_url = f"http://127.0.0.1:{PORT}/"
    phone_ip = None if LOCAL_ONLY else lan_ip()

    print()
    print("  课程表 · 本地服务器")
    print(f"  本机：{local_url}")
    if phone_ip and phone_ip != "127.0.0.1":
        print(f"  手机（同一 Wi-Fi）：http://{phone_ip}:{PORT}/")
        print("  手机安装为 App 需要 HTTPS；局域网 HTTP 可正常查看，但不能安装 PWA。")
    print("  按 Ctrl+C 停止")
    print()

    if OPEN_BROWSER:
        threading.Timer(0.8, lambda: webbrowser.open(local_url)).start()

    with Server((HOST, PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止。")


if __name__ == "__main__":
    main()