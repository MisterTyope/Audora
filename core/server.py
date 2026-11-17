"""Serveur local (127.0.0.1) : interface web, lecture des fichiers, pont avec l'extension navigateur."""

import http.server
import json
import os
import re
import socket
import sys
import threading
import urllib.parse

from . import config
from .downloads import is_youtube_url

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".opus": "audio/ogg",
    ".ogg": "audio/ogg", ".flac": "audio/flac", ".wav": "audio/wav",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska", ".mov": "video/quicktime",
}
_EXTENSION_ORIGINS = ("chrome-extension://", "moz-extension://")
_CHUNK = 256 * 1024


class _Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    # Sous Windows, SO_REUSEADDR permet a un 2e processus d'ecouter sur le meme
    # port : on veut au contraire que le 2e lancement echoue pour le detecter.
    allow_reuse_address = False

    def server_bind(self):
        if sys.platform == "win32" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class _Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    app = None
    bridge_enabled = False

    def log_message(self, format_str, *args):
        pass

    # --- Utilitaires ---

    def _host_ok(self):
        # Bloque le "DNS rebinding" : seules les requetes adressees a 127.0.0.1/localhost passent.
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
        return host in ("127.0.0.1", "localhost")

    def _send(self, status, body=b"", content_type="application/json", headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def _json(self, status, payload, headers=None):
        self._send(status, json.dumps(payload).encode("utf-8"), headers=headers)

    def _serve_file(self, path, allow_range=False, cache=False):
        if not path or not os.path.isfile(path):
            self._send(404)
            return
        size = os.path.getsize(path)
        content_type = _CONTENT_TYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream")
        start, end, status = 0, size - 1, 200

        range_header = self.headers.get("Range")
        if allow_range and range_header:
            match = re.match(r"bytes=(\d*)-(\d*)$", range_header.strip())
            if match:
                first, last = match.groups()
                if first == "" and last:
                    start = max(0, size - int(last))
                else:
                    start = int(first or 0)
                    end = min(int(last), size - 1) if last else size - 1
                if start > end or start >= size:
                    self._send(416, headers={"Content-Range": f"bytes */{size}"})
                    return
                status = 206

        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "max-age=86400" if cache else "no-cache")
        if allow_range:
            self.send_header("Accept-Ranges", "bytes")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if self.command == "HEAD":
            return

        remaining = end - start + 1
        with open(path, "rb") as f:
            f.seek(start)
            while remaining > 0:
                chunk = f.read(min(_CHUNK, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    # --- Routes ---

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self._host_ok():
            self._send(403)
            return
        path = urllib.parse.urlparse(self.path).path
        try:
            if path == "/ping":
                self._json(200, {"status": "ok", "bridge": self.bridge_enabled})
                return

            match = re.fullmatch(r"/media/(\d+)", path)
            if match:
                self._serve_file(self.app.library.get_track_path(int(match.group(1))), allow_range=True)
                return

            match = re.fullmatch(r"/cover/(\d+)", path)
            if match:
                self._serve_file(self.app.library.get_cover_path(int(match.group(1))), cache=True)
                return

            self._serve_static(path)
        except (ConnectionError, BrokenPipeError):
            pass  # le lecteur coupe souvent la connexion quand on avance dans un morceau

    def _serve_static(self, path):
        relative = "index.html" if path in ("", "/") else path.lstrip("/")
        web_root = os.path.realpath(config.WEB_DIR)
        full = os.path.realpath(os.path.join(web_root, relative))
        if not full.startswith(web_root + os.sep):
            self._send(404)
            return
        self._serve_file(full)

    def do_POST(self):
        if not self._host_ok():
            self._send(403)
            return
        path = urllib.parse.urlparse(self.path).path
        origin = self.headers.get("Origin") or ""
        length = min(int(self.headers.get("Content-Length") or 0), 64 * 1024)
        body = self.rfile.read(length) if length else b""

        if path == "/focus":
            # Envoye par un 2e lancement de l'appli (pas de navigateur => pas d'Origin).
            if origin:
                self._send(403)
                return
            self.app.show_window()
            self._json(200, {"status": "ok"})
            return

        if path == "/action":
            # Envoye par un lancement "Audora --action ..." (liste de raccourcis de la barre des taches).
            if origin:
                self._send(403)
                return
            try:
                action = str(json.loads(body or b"{}").get("action") or "")
            except ValueError:
                action = ""
            self.app.handle_action(action)
            self._json(200, {"status": "ok"})
            return

        if path == "/download":
            # Un site web ne peut pas falsifier l'en-tete Origin : seule l'extension passe.
            if not origin.startswith(_EXTENSION_ORIGINS):
                self._json(403, {"status": "error", "message": "Origine refusée"})
                return
            try:
                data = json.loads(body or b"{}")
            except ValueError:
                data = {}
            url = str(data.get("url") or "")
            fmt = data.get("format") if data.get("format") in ("mp3", "mp4") else "mp3"
            if not is_youtube_url(url):
                self._json(400, {"status": "error", "message": "URL invalide"})
                return
            self.app.handle_external_download(url, fmt)
            self._json(200, {"status": "started"}, headers={"Access-Control-Allow-Origin": origin})
            return

        self._send(404)


def start_server(app, port):
    """Demarre le serveur sur `port` (0 = port libre au hasard). Retourne None si le port est pris."""
    handler = type("Handler", (_Handler,), {"app": app, "bridge_enabled": port == config.BRIDGE_PORT})
    try:
        server = _Server(("127.0.0.1", port), handler)
    except OSError:
        return None
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
