"""Chemins de l'application et reglages persistants (%LOCALAPPDATA%\\Audora\\config.json)."""

import json
import os
import shutil
import subprocess
import sqlite3
import sys
import threading

IS_FROZEN = getattr(sys, "frozen", False)
# En .exe (PyInstaller), les ressources embarquees (web/, icon.ico) sont dans sys._MEIPASS.
APP_DIR = os.path.dirname(sys.executable) if IS_FROZEN else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESOURCE_DIR = getattr(sys, "_MEIPASS", APP_DIR)

# Les donnees (bibliotheque, reglages, pochettes) vivent dans le dossier standard de
# Windows, commun au .exe et au lancement depuis les sources : reconstruire le .exe ou
# le deplacer ne fait rien perdre.
DATA_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local"), "Audora")
LEGACY_DATA_DIR = os.path.join(APP_DIR, "data")  # emplacement des versions precedentes
COVERS_DIR = os.path.join(DATA_DIR, "covers")
DB_PATH = os.path.join(DATA_DIR, "library.db")
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")
WEBVIEW_STORAGE = os.path.join(DATA_DIR, "webview")
WEB_DIR = os.path.join(RESOURCE_DIR, "web")
ICON_PATH = os.path.join(RESOURCE_DIR, "icon.ico")

def launcher():
    """(programme, debut des arguments) qui relancent Audora : le .exe, ou pythonw + app.py."""
    if IS_FROZEN:
        return sys.executable, ""
    pythonw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    exe = pythonw if os.path.exists(pythonw) else sys.executable
    return exe, f'"{os.path.join(APP_DIR, "app.py")}" '


def migrate_legacy_data(legacy_dir=LEGACY_DATA_DIR):
    """Copie une seule fois les donnees d'une ancienne version (dossier data/ a cote de l'appli).

    Copie et non deplacement : l'ancien dossier reste intact en cas de souci.
    """
    old_db = os.path.join(legacy_dir, "library.db")
    if os.path.exists(DB_PATH) or not os.path.exists(old_db):
        return False
    os.makedirs(DATA_DIR, exist_ok=True)
    shutil.copy2(old_db, DB_PATH)
    old_config = os.path.join(legacy_dir, "config.json")
    if os.path.exists(old_config):
        shutil.copy2(old_config, CONFIG_PATH)
    old_covers = os.path.join(legacy_dir, "covers")
    if os.path.isdir(old_covers):
        shutil.copytree(old_covers, COVERS_DIR, dirs_exist_ok=True)
        # Les chemins des pochettes sont enregistres en entier dans la base : on les met a jour.
        db = sqlite3.connect(DB_PATH)
        try:
            prefix = old_covers.lower()
            rows = db.execute("SELECT id, cover FROM tracks WHERE cover IS NOT NULL").fetchall()
            for track_id, cover in rows:
                if cover.lower().startswith(prefix):
                    db.execute("UPDATE tracks SET cover = ? WHERE id = ?", (COVERS_DIR + cover[len(old_covers):], track_id))
            db.commit()
        finally:
            db.close()
    return True


DEFAULT_LIBRARY = os.path.join(os.path.expanduser("~"), "Downloads", "YouTube")
BRIDGE_PORT = 47935

# yt-dlp utilise par defaut sa propre liste de certificats (certifi). Les antivirus qui
# analysent le HTTPS (Norton, Avast, Kaspersky...) signent les connexions avec un
# certificat ajoute seulement au magasin Windows : on utilise donc celui de Windows.
YTDLP_BASE_OPTS = {"compat_opts": {"no-certifi"}}

# Mais un Windows neuf n'a pas encore tous les certificats racine : il ne les telecharge qu'a la
# demande, quand un navigateur en a besoin. Sans eux, Audora ne pouvait rien telecharger sur un
# PC neuf (CERTIFICATE_VERIFY_FAILED). On ajoute donc la liste de reference (certifi, embarquee) :
# Python et yt-dlp chargent alors le magasin Windows ET cette liste.
try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except ImportError:
    pass

# Programmes embarques dans le .exe (voir vendor_tools.py) : ffmpeg/ffprobe (conversion,
# decoupe, volume) et Node.js (moteur JavaScript que YouTube exige pour donner tous ses
# formats). A defaut (lancement depuis les sources), ceux installes sur le PC.
TOOLS_DIR = os.path.join(RESOURCE_DIR, "bin")


def tool_path(name):
    bundled = os.path.join(TOOLS_DIR, name + ".exe")
    return bundled if os.path.exists(bundled) else shutil.which(name)


NODE_MIN_MAJOR = 22  # yt-dlp refuse les Node.js plus anciens


def _node_ok(path):
    """Node.js du PC assez recent ? (celui embarque l'est toujours)"""
    if not path or path.startswith(TOOLS_DIR):
        return bool(path)
    try:
        out = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=10,
                             creationflags=0x08000000 if sys.platform == "win32" else 0).stdout
        return int(out.strip().lstrip("v").split(".")[0]) >= NODE_MIN_MAJOR
    except (OSError, ValueError, subprocess.SubprocessError):
        return False


FFMPEG = tool_path("ffmpeg") if tool_path("ffprobe") else None  # yt-dlp a besoin des deux
NODE = tool_path("node")
if not _node_ok(NODE):
    NODE = None
if FFMPEG:
    YTDLP_BASE_OPTS["ffmpeg_location"] = os.path.dirname(FFMPEG)
if NODE:
    YTDLP_BASE_OPTS["js_runtimes"] = {"node": {"path": NODE}}

DEFAULTS = {
    "library_folder": DEFAULT_LIBRARY,
    "format": "mp3",
    "quality": "best",
    "volume": 0.8,
    "theme": "prune",
    "organize_by_artist": True,
    "trim_audio": True,  # couper blancs et passages parles des nouveaux telechargements
    "normalize_volume": True,  # volume egalise entre les morceaux
    "spatial": False,  # mode Spatial : image stereo elargie
    "crossfade": 0,  # fondu enchaine en secondes (0 = desactive)
    "phone_all_playlists": False,  # toutes les playlists vont sur le telephone automatiquement
    "phone_playlists_excluded": [],  # ... sauf celles retirees a la main
    "tray_hint_shown": False,
    "session": None,
}

# Cles que l'interface a le droit de modifier directement.
EDITABLE_KEYS = {"format", "quality", "volume", "organize_by_artist", "session", "theme", "trim_audio",
                 "normalize_volume", "crossfade", "spatial"}


class Config:
    def __init__(self):
        self._lock = threading.Lock()
        self._data = dict(DEFAULTS)
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                self._data.update(json.load(f))
        except Exception:
            pass

    def get(self, key):
        with self._lock:
            return self._data.get(key, DEFAULTS.get(key))

    def set(self, key, value):
        with self._lock:
            self._data[key] = value
            self._save_locked()

    def public(self):
        with self._lock:
            return {k: v for k, v in self._data.items() if k != "tray_hint_shown"}

    def _save_locked(self):
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            tmp = CONFIG_PATH + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, CONFIG_PATH)
        except Exception:
            pass
