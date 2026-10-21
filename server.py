"""Local Python server for the 6x6 block layout tool."""

from __future__ import annotations

import argparse
import json
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from solver import PuzzleInputError, solve


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR
MAX_REQUEST_BYTES = 1_000_000


class AppHandler(BaseHTTPRequestHandler):
    server_version = "BlockLayoutApp/1.0"

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - standard library handler API
        path = urlparse(self.path).path
        if path == "/api/health":
            self._send_json(200, {"status": "ok"})
            return

        requested = "index.html" if path in ("/", "") else path.lstrip("/")
        file_path = (STATIC_DIR / requested).resolve()
        if not file_path.is_relative_to(STATIC_DIR.resolve()) or not file_path.is_file():
            self.send_error(404)
            return
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
        }.get(file_path.suffix, "application/octet-stream")
        content = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self) -> None:  # noqa: N802 - standard library handler API
        if urlparse(self.path).path != "/api/solve":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"error": "請求長度格式錯誤。"})
            return
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self._send_json(413, {"error": "設定資料為空或超過大小限制。"})
            return
        try:
            config = json.loads(self.rfile.read(length).decode("utf-8"))
            result = solve(config)
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"error": "無法讀取設定資料。"})
            return
        except PuzzleInputError as error:
            self._send_json(400, {"error": str(error)})
            return
        except Exception as error:  # Return a stable message; do not expose local paths.
            self.log_error("solver error: %s", error)
            self._send_json(500, {"error": "搜尋時發生錯誤，請檢查設定後重試。"})
            return
        self._send_json(200, result)

    def log_message(self, format: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="6×6 板塊排列搜尋器")
    parser.add_argument("--host", default="127.0.0.1", help="監聽位置，預設只允許本機連線")
    parser.add_argument("--port", type=int, default=8000, help="連接埠，預設 8000")
    parser.add_argument("--no-browser", action="store_true", help="啟動後不自動開啟瀏覽器")
    args = parser.parse_args()
    address = f"http://{args.host}:{args.port}/"

    server = ThreadingHTTPServer((args.host, args.port), AppHandler)
    print(f"板塊排列工具已啟動：{address}")
    print("按 Ctrl+C 停止。")
    if not args.no_browser:
        webbrowser.open(address)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
