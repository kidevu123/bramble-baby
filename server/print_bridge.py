"""Bramble print bridge: prints milk labels on a Bluetooth/USB label printer from wherever the adapter is.

The companion runs inside an LXC that cannot open Bluetooth sockets, so this tiny service runs on the
Proxmox host (or a Raspberry Pi next to the fridge) and the companion forwards label PNGs to it
(BRAMBLE_PRINTER=bridge://<host>:8110?token=…). Standard library + Pillow (+ pyserial for USB).

Env: BRIDGE_PORT (8110), BRIDGE_TOKEN (required), BRAMBLE_PRINTER (e.g. niimbot://bluetooth/AA:BB:..?model=b1).
"""
from __future__ import annotations

import hmac
import json
import logging
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import milk  # noqa: E402

log = logging.getLogger("bramble.bridge")
TOKEN = os.environ.get("BRIDGE_TOKEN", "")
PRINTER = milk.Printer(os.environ.get("BRAMBLE_PRINTER"), role="bridge")
MAX_BODY = 4 * 1024 * 1024
# One label at a time: two at once would open two RFCOMM/serial sessions to the one printer.
PRINT_LOCK = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    server_version = "bramble-print-bridge/1.0"

    def _json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authed(self) -> bool:
        given = self.headers.get("Authorization", "").encode()
        return bool(TOKEN) and hmac.compare_digest(given, f"Bearer {TOKEN}".encode())

    def do_GET(self):  # noqa: N802
        if self.path.rstrip("/") == "/status":
            if not self._authed():
                return self._json(401, {"detail": "bad bridge token"})
            return self._json(200, PRINTER.status())
        return self._json(404, {"detail": "Not found."})

    def do_POST(self):  # noqa: N802
        if self.path.rstrip("/") != "/print":
            return self._json(404, {"detail": "Not found."})
        if not self._authed():
            return self._json(401, {"detail": "bad bridge token"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._json(400, {"detail": "bad length"})
        if length <= 0 or length > MAX_BODY:
            return self._json(413, {"detail": "label too large"})
        try:
            data = json.loads(self.rfile.read(length).decode() or "{}")
            png = milk.decode_png_field(data)
        except ValueError:
            return self._json(400, {"detail": "missing: png"})
        try:
            with PRINT_LOCK:
                result = PRINTER.print_png(png)
            return self._json(200, result)
        except milk.PrinterError as exc:
            log.warning("print failed: %s", exc)
            return self._json(503, {"detail": str(exc)})

    def log_message(self, fmt, *args):  # quieter than the default
        log.info("%s " + fmt, self.address_string(), *args)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not TOKEN:
        log.error("BRIDGE_TOKEN is not set; refusing to start")
        sys.exit(2)
    port = int(os.environ.get("BRIDGE_PORT", "8110"))
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    log.info("bramble print bridge on :%s → %s", port, PRINTER.status())
    srv.serve_forever()


if __name__ == "__main__":
    main()
