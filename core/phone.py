"""Synchronisation avec l'appli Android d'Audora, sur le Wi-Fi de la maison.

- Decouverte : le telephone envoie un message UDP en diffusion, le PC repond avec son adresse.
- Association : un code a 6 chiffres affiche sur le PC (valable 5 minutes) donne au telephone
  un jeton secret ; seul son empreinte SHA-256 est gardee sur le PC.
- Synchro : le telephone recupere la liste des musiques choisies ("manifeste"), telecharge
  celles qui lui manquent, et renvoie ses ecoutes.

Ce serveur ecoute sur le reseau local (contrairement au serveur de l'interface, limite au PC)
et n'expose que les musiques envoyees sur le telephone, uniquement a un telephone associe.

Chiffrement : le meme port accepte le HTTP simple (page d'installation, telechargement de l'appli,
anciennes versions de l'appli) et le TLS (synchro de l'appli a jour, voir tls.py). Un telephone
qui s'est connecte une fois en TLS ne peut plus utiliser le HTTP simple.
"""

import hashlib
import hmac
import http.server
import json
import logging
import os
import re
import secrets
import socket
import ssl
import sys
import threading
import time
import urllib.parse
import uuid

from . import config
from . import search as youtube
from . import tls

log = logging.getLogger("audora")
SYNC_PORT = 47936
DISCOVERY_PORT = 47937
DISCOVERY_MESSAGE = b"AUDORA_DISCOVER"
PAIRING_TTL = 300
MAX_PAIRING_ATTEMPTS = 10
APK_NAME = "Audora.apk"
_CHUNK = 256 * 1024


def local_ip():
    """Adresse du PC sur le reseau local (aucun paquet n'est envoye)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
        except OSError:
            return "127.0.0.1"


def apk_path():
    for candidate in (os.path.join(config.APP_DIR, APK_NAME),
                      os.path.join(config.APP_DIR, "dist", APK_NAME),
                      os.path.join(config.RESOURCE_DIR, APK_NAME)):
        if os.path.exists(candidate):
            return candidate
    return None


def apk_info():
    """Version de l'appli Android disponible sur ce PC (ecrite par android/build_apk.py)."""
    path = apk_path()
    if not path:
        return None
    try:
        with open(os.path.splitext(path)[0] + ".json", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class _SyncServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    tls_context = None

    def server_bind(self):
        if sys.platform == "win32" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def finish_request(self, request, client_address):
        """Chaque connexion (dans son propre fil) : TLS si elle commence par une poignee de main TLS."""
        secure = None
        if self.tls_context is not None:
            try:
                request.settimeout(20)
                if request.recv(1, socket.MSG_PEEK) == b"\x16":  # 0x16 = debut d'une poignee de main TLS
                    secure = self.tls_context.wrap_socket(request, server_side=True)  # `request` est detache
                else:
                    request.settimeout(None)
            except (OSError, ssl.SSLError):
                return
        if secure is None:
            self.RequestHandlerClass(request, client_address, self)
            return
        secure.settimeout(None)
        try:
            self.RequestHandlerClass(secure, client_address, self)
        finally:
            try:
                secure.close()
            except OSError:
                pass


class PhoneSync:
    def __init__(self, library, cfg, emit, downloads=None):
        self._library = library
        self._downloads = downloads
        self._config = cfg
        self._emit = emit
        self._lock = threading.Lock()
        self._server = None
        self._udp = None
        self._pairing = None  # {"code", "expires", "attempts"}
        self.error = None
        if not cfg.get("pc_id"):
            cfg.set("pc_id", uuid.uuid4().hex)

    # --- Etat ---

    @property
    def running(self):
        return self._server is not None

    def pc_name(self):
        return socket.gethostname()

    def devices(self):
        return list(self._config.get("phone_devices") or [])

    def state(self):
        self.sync_all_playlists()
        ip = local_ip()
        pairing = None
        with self._lock:
            if self._pairing and self._pairing["expires"] > time.time():
                pairing = {"code": self._pairing["code"], "expires_in": int(self._pairing["expires"] - time.time())}
        return {
            "enabled": bool(self._config.get("phone_sync")),
            "running": self.running,
            "error": self.error,
            "ip": ip,
            "port": SYNC_PORT,
            "install_url": f"http://{ip}:{SYNC_PORT}/",
            "apk_available": apk_path() is not None,
            "pairing": pairing,
            "all_playlists": bool(self._config.get("phone_all_playlists")),
            "devices": [{k: d.get(k) for k in ("id", "name", "paired_at", "last_sync")} for d in self.devices()],
            "items": self._library.phone_items(),
        }

    def install_qr_svg(self):
        import qrcode
        import qrcode.image.svg

        img = qrcode.make(self.state()["install_url"], image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
        return img.to_string(encoding="unicode")

    # --- Marche / arret ---

    def set_enabled(self, enabled):
        self._config.set("phone_sync", bool(enabled))
        if enabled:
            self.start()
        else:
            self.stop()
        return self.state()

    def start(self):
        if self._server:
            return
        handler = type("SyncHandler", (_SyncHandler,), {"sync": self})
        try:
            self._server = _SyncServer(("0.0.0.0", SYNC_PORT), handler)
        except OSError as exc:
            self.error = f"Le port {SYNC_PORT} est déjà utilisé ({exc.strerror or exc})."
            self._server = None
            return
        try:
            self._server.tls_context = tls.server_context(f"Audora {self.pc_name()}")
        except Exception:
            log.exception("Chiffrement de la synchro indisponible")
            self._server.tls_context = None  # sans chiffrement plutot que sans synchro
        self.error = None
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        try:
            self._udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._udp.bind(("", DISCOVERY_PORT))
            threading.Thread(target=self._discovery_loop, args=(self._udp,), daemon=True).start()
        except OSError:
            self._udp = None  # la decouverte automatique ne marchera pas, l'adresse manuelle oui

    def stop(self):
        server, self._server = self._server, None
        if server:
            threading.Thread(target=lambda: (server.shutdown(), server.server_close()), daemon=True).start()
        udp, self._udp = self._udp, None
        if udp:
            try:
                udp.close()
            except OSError:
                pass

    def _discovery_loop(self, sock):
        reply = json.dumps({"app": "audora", "pc_id": self._config.get("pc_id"),
                            "name": self.pc_name(), "port": SYNC_PORT}).encode("utf-8")
        while self._udp is sock:
            try:
                data, addr = sock.recvfrom(1024)
            except OSError:
                return
            if data.strip() == DISCOVERY_MESSAGE:
                try:
                    sock.sendto(reply, addr)
                except OSError:
                    pass

    # --- Association ---

    def start_pairing(self):
        with self._lock:
            self._pairing = {"code": f"{secrets.randbelow(1_000_000):06d}",
                             "expires": time.time() + PAIRING_TTL, "attempts": 0}
        return self.state()

    def cancel_pairing(self):
        with self._lock:
            self._pairing = None

    def pair(self, code, name):
        with self._lock:
            pairing = self._pairing
            if not pairing or pairing["expires"] < time.time():
                return None
            pairing["attempts"] += 1
            if pairing["attempts"] > MAX_PAIRING_ATTEMPTS:
                self._pairing = None  # trop d'essais : il faut redemander un code
                return None
            if not hmac.compare_digest(str(code), pairing["code"]):
                return None
            self._pairing = None
        token = secrets.token_hex(32)
        device = {"id": uuid.uuid4().hex[:12], "name": (name or "Téléphone")[:60],
                  "token_sha256": _hash_token(token), "paired_at": time.time(), "last_sync": None}
        self._config.set("phone_devices", self.devices() + [device])
        self._emit("phone_changed", None)
        return {"token": token, "device_id": device["id"], "pc_id": self._config.get("pc_id"), "pc_name": self.pc_name()}

    def remove_device(self, device_id):
        self._config.set("phone_devices", [d for d in self.devices() if d.get("id") != device_id])
        return self.state()

    def device_for_token(self, token, secure=False):
        if not token:
            return None
        digest = _hash_token(token)
        for device in self.devices():
            if hmac.compare_digest(device.get("token_sha256", ""), digest):
                if secure and not device.get("tls"):
                    self._mark_tls(device["id"])  # ce telephone a l'appli a jour : chiffrement obligatoire
                elif not secure and device.get("tls"):
                    return None  # tentative en clair pour un telephone qui chiffre : refusee
                return device
        return None

    def _mark_tls(self, device_id):
        with self._lock:
            devices = self.devices()
            for device in devices:
                if device.get("id") == device_id:
                    device["tls"] = True
            self._config.set("phone_devices", devices)

    @property
    def tls_enabled(self):
        return bool(self._server and self._server.tls_context)

    def touch_device(self, device_id):
        with self._lock:
            devices = self.devices()
            for device in devices:
                if device.get("id") == device_id:
                    device["last_sync"] = time.time()
            self._config.set("phone_devices", devices)

    # --- Donnees ---

    # --- Toutes les playlists automatiquement ---

    def sync_all_playlists(self):
        """Mode "toutes les playlists" : ajoute a la synchro celles qui n'y sont pas encore
        (sauf celles retirees a la main)."""
        if not self._config.get("phone_all_playlists"):
            return
        excluded = set(self._config.get("phone_playlists_excluded") or [])
        sent = set(self._library.phone_items()["playlists"])
        missing = [p["id"] for p in self._library.list_playlists() if p["id"] not in excluded and p["id"] not in sent]
        if missing:
            self._library.phone_add("playlist", missing)

    def set_all_playlists(self, enabled):
        self._config.set("phone_all_playlists", bool(enabled))
        if enabled:
            self._config.set("phone_playlists_excluded", [])
            self.sync_all_playlists()
        return self.state()

    def note_playlists(self, ids, sent):
        """Playlist envoyee ou retiree a la main : le mode automatique respecte ce choix."""
        excluded = set(self._config.get("phone_playlists_excluded") or [])
        excluded = excluded - set(ids) if sent else excluded | set(ids)
        self._config.set("phone_playlists_excluded", sorted(excluded))

    def manifest(self):
        self.sync_all_playlists()
        data = self._library.phone_manifest()
        data["theme"] = self._config.get("theme")
        data["pc_name"] = self.pc_name()
        info = apk_info()
        if info:
            data["apk"] = {"version_code": info.get("version_code"), "version_name": info.get("version_name"),
                           "url": f"http://{local_ip()}:{SYNC_PORT}/{APK_NAME}"}
        return data

    def _apply_playlist_ops(self, ops):
        """Playlists creees ou modifiees sur le telephone. Les nouvelles sont creees sur le PC
        et envoyees au telephone ; "remove" retire seulement la playlist du telephone."""
        playlist_ids = {p["id"] for p in self._library.list_playlists()}
        created = {}
        for op in ops or []:
            kind = op.get("op")
            tracks = [int(t) for t in op.get("track_ids") or [] if str(t).lstrip("-").isdigit() and int(t) > 0]
            if kind == "create":
                new_id = self._library.create_playlist(str(op.get("name") or "Nouvelle playlist")[:120], tracks)
                self._library.phone_add("playlist", [new_id])
                created[str(op.get("temp_id"))] = new_id
                playlist_ids.add(new_id)
                continue
            pid = op.get("id")
            pid = created.get(str(pid), pid)
            if not isinstance(pid, int) or pid not in playlist_ids:
                continue
            if kind == "update":
                if op.get("name"):
                    self._library.rename_playlist(pid, str(op["name"])[:120])
                if op.get("track_ids") is not None:
                    self._library.set_playlist_tracks(pid, tracks)
            elif kind == "remove":
                self._library.phone_remove("playlist", [pid])
                self.note_playlists([pid], sent=False)

    # --- Recherche et telechargement demandes depuis le telephone ---

    def search(self, query):
        tracks = self._library.list_tracks()
        by_source = {t["source_id"]: t["id"] for t in tracks if t.get("source_id")}
        on_phone = self._library.phone_track_ids()
        results = youtube.search(query, known_artists=self._library.known_artist_keys())
        for r in results:
            r["on_pc"] = r["id"] in by_source
            r["on_phone"] = by_source.get(r["id"]) in on_phone
        return results

    def download(self, payload):
        """Le PC telecharge, puis le titre part sur le telephone a la prochaine synchro."""
        if self._downloads is None:
            raise ValueError("Téléchargement indisponible")
        video_id = str(payload.get("id") or "")
        if not re.fullmatch(r"[\w-]{6,20}", video_id):
            raise ValueError("Vidéo inconnue")
        url = f"https://www.youtube.com/watch?v={video_id}"
        existing = next((t for t in self._library.list_tracks()
                         if t.get("source_id") == video_id and t["kind"] == "audio"), None)
        if existing:
            self._library.phone_add("track", [existing["id"]])  # deja sur le PC : simple envoi
            self._emit("phone_changed", None)
            return {"id": None, "url": url, "status": "done", "progress": 1, "detail": "Déjà sur le PC, envoyé au téléphone"}
        job = self._downloads.add(url, format="mp3", title=payload.get("title"), thumb=payload.get("thumb"), for_phone=True)
        self._emit("toast", {"message": "Téléchargement demandé depuis le téléphone"})
        return _public_job(job)

    def phone_jobs(self):
        if self._downloads is None:
            return []
        return [_public_job(j) for j in self._downloads.list() if j.get("for_phone")]

    def report(self, device, payload):
        if payload.get("playlist_ops"):
            self._apply_playlist_ops(payload["playlist_ops"])
            self._emit("library_changed", None)
        if payload.get("remove_all"):
            # "Supprimer toutes les musiques" sur le telephone : on vide la liste d'envoi.
            items = self._library.phone_items()
            self._library.phone_remove("track", items["tracks"])
            self._library.phone_remove("playlist", items["playlists"])
        removed_playlists = [int(i) for i in payload.get("removed_playlists") or [] if str(i).isdigit()]
        if removed_playlists:
            self._library.phone_remove("playlist", removed_playlists)
        plays = payload.get("plays") or {}
        for track_id, count in plays.items():
            if str(track_id).isdigit() and isinstance(count, int) and 0 < count < 1000:
                self._library.add_plays(int(track_id), count)
        removed = [int(i) for i in payload.get("removed") or [] if str(i).isdigit()]
        if removed:
            self._library.phone_remove("track", removed)
        self.touch_device(device["id"])
        self._emit("phone_changed", None)
        if plays:
            self._emit("library_changed", None)


def _public_job(job):
    return {k: job.get(k) for k in ("id", "url", "title", "thumb", "status", "progress", "detail", "error")}


class _SyncHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    sync = None

    def log_message(self, format_str, *args):
        pass

    def _send(self, status, body=b"", content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def _json(self, status, payload):
        self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    @property
    def secure(self):
        return isinstance(self.connection, ssl.SSLSocket)

    def _device(self):
        auth = self.headers.get("Authorization") or ""
        token = auth[7:].strip() if auth.startswith("Bearer ") else ""
        return self.sync.device_for_token(token, self.secure)

    def _read_json(self):
        length = min(int(self.headers.get("Content-Length") or 0), 1024 * 1024)
        try:
            return json.loads(self.rfile.read(length) or b"{}") if length else {}
        except ValueError:
            return {}

    def _serve_file(self, path, content_type):
        if not path or not os.path.isfile(path):
            self._send(404)
            return
        size = os.path.getsize(path)
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(size))
        self.end_headers()
        with open(path, "rb") as f:
            while True:
                chunk = f.read(_CHUNK)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        try:
            if path in ("/", "/index.html"):
                self._send(200, _install_page(self.sync).encode("utf-8"), "text/html; charset=utf-8")
                return
            if path == "/" + APK_NAME:
                self._serve_file(apk_path(), "application/vnd.android.package-archive")
                return
            if path == "/sync/hello":
                self._json(200, {"app": "audora", "pc_id": self.sync._config.get("pc_id"), "name": self.sync.pc_name(),
                                 "tls": self.sync.tls_enabled})
                return

            device = self._device()
            if not device:
                self._json(401, {"error": "Téléphone non associé"})
                return
            if path == "/sync/manifest":
                self._json(200, self.sync.manifest())
                return
            query = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            if path == "/sync/search":
                self._json(200, {"results": self.sync.search((query.get("q") or [""])[0])})
                return
            if path == "/sync/details":
                ids = (query.get("ids") or [""])[0].split(",")
                self._json(200, {"details": youtube.details(ids)})
                return
            match = re.fullmatch(r"/sync/stream/([\w-]{6,20})", path)
            if match:
                try:
                    self._json(200, {"url": youtube.stream_url(match.group(1))})
                except Exception as exc:
                    self._json(404, {"error": str(exc)[:200]})
                return
            if path == "/sync/downloads":
                self._json(200, {"jobs": self.sync.phone_jobs()})
                return
            match = re.fullmatch(r"/sync/lyrics/(\d+)", path)
            if match:
                track_id = int(match.group(1))
                found = self.sync._library.get_lyrics(track_id) if track_id in self.sync._library.phone_track_ids() else None
                self._json(200 if found else 404, {"synced": (found or {}).get("synced"), "plain": (found or {}).get("plain")})
                return
            match = re.fullmatch(r"/sync/(file|cover)/(\d+)", path)
            if match:
                track_id = int(match.group(2))
                if track_id not in self.sync._library.phone_track_ids():
                    self._send(404)  # seulement les musiques envoyees sur le telephone
                    return
                if match.group(1) == "file":
                    self._serve_file(self.sync._library.get_track_path(track_id), "application/octet-stream")
                else:
                    self._serve_file(self.sync._library.get_cover_path(track_id), "image/jpeg")
                return
            self._send(404)
        except (ConnectionError, BrokenPipeError):
            pass

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        payload = self._read_json()
        if path == "/sync/pair":
            result = self.sync.pair(payload.get("code"), payload.get("name"))
            if result:
                self._json(200, result)
            else:
                self._json(403, {"error": "Code incorrect ou expiré. Affiche un nouveau code dans Audora sur le PC."})
            return
        device = self._device()
        if not device:
            self._json(401, {"error": "Téléphone non associé"})
            return
        if path == "/sync/report":
            self.sync.report(device, payload)
            self._json(200, {"status": "ok"})
            return
        if path == "/sync/download":
            try:
                job = self.sync.download(payload)
                self._json(200, {"job": job})
            except Exception as exc:
                self._json(400, {"error": str(exc)[:200]})
            return
        self._send(404)


def _install_page(sync):
    available = apk_path() is not None
    link = (f'<a class="btn" href="/{APK_NAME}">Télécharger Audora pour Android</a>'
            if available else "<p>L'appli Android n'est pas encore disponible sur ce PC.</p>")
    return f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Audora pour Android</title>
<style>body{{margin:0;background:#17121f;color:#f4effa;font:16px/1.5 system-ui,sans-serif;padding:32px 20px}}
h1{{font-size:34px;margin:0 0 8px}}p{{color:#b3a8c6}}.btn{{display:inline-block;margin:18px 0;padding:16px 24px;
border-radius:28px;background:#ffb547;color:#2b1a00;font-weight:700;text-decoration:none}}ol{{color:#b3a8c6;padding-left:20px}}</style>
</head><body><h1>Audora</h1><p>Ta musique, sur ton téléphone, même sans internet.</p>{link}
<ol><li>Ouvre le fichier téléchargé.</li><li>Si Android le demande, autorise l'installation depuis ton navigateur.</li>
<li>Ouvre Audora, puis associe-le avec le code affiché sur ton PC.</li></ol></body></html>"""
