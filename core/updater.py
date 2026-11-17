"""Mise a jour automatique d'Audora lui-meme.

Les versions sont publiees sur GitHub (depot public UPDATE_REPO dans version.py) : chaque
version porte l'installateur "Audora-Setup-X.Y.Z.exe" et son empreinte "....exe.sha256".
Audora regarde une fois par jour s'il y a plus recent, et propose de l'installer : il
telecharge l'installateur, verifie son empreinte, le lance en mode silencieux puis se ferme ;
l'installateur relance Audora a la fin. Les donnees ne sont jamais touchees.
"""

import hashlib
import json
import logging
import os
import re
import subprocess
import threading
import time
import urllib.request

from . import config
from .version import UPDATE_REPO, VERSION

log = logging.getLogger("audora")
UPDATES_DIR = os.path.join(config.DATA_DIR, "mises-a-jour")
CHECK_EVERY = 24 * 3600


def _version_key(text):
    return tuple(int(n) for n in re.findall(r"\d+", text or "")[:3]) or (0,)


def enabled():
    return bool(UPDATE_REPO) and config.IS_FROZEN


def _get_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": f"Audora/{VERSION}",
                                                   "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def latest():
    """{"version", "notes", "installer", "checksum"} si une version plus recente existe, sinon None."""
    release = _get_json(f"https://api.github.com/repos/{UPDATE_REPO}/releases/latest")
    version = (release.get("tag_name") or "").lstrip("vV")
    if _version_key(version) <= _version_key(VERSION):
        return None
    assets = {a["name"]: a["browser_download_url"] for a in release.get("assets") or []}
    installer = next((n for n in assets if re.fullmatch(r"Audora-Setup-[\d.]+\.exe", n)), None)
    if not installer or installer + ".sha256" not in assets:
        return None  # version publiee sans installateur verifiable : on l'ignore
    return {"version": version, "notes": (release.get("body") or "")[:1500],
            "installer": assets[installer], "checksum": assets[installer + ".sha256"], "name": installer}


class Updater:
    def __init__(self, on_available):
        self._on_available = on_available
        self.available = None
        self.installing = False

    def check_in_background(self, force=False):
        if not enabled():
            return

        def run():
            stamp = os.path.join(UPDATES_DIR, "derniere-verification")
            try:
                if not force and os.path.exists(stamp) and time.time() - os.path.getmtime(stamp) < CHECK_EVERY:
                    return
                os.makedirs(UPDATES_DIR, exist_ok=True)
                self.available = latest()
                open(stamp, "w").close()
                if self.available:
                    self._on_available(self.available)
            except Exception as exc:
                log.warning("Verification des mises a jour impossible : %s", exc)

        threading.Thread(target=run, daemon=True, name="mise-a-jour").start()

    def install(self, quit_app):
        """Telecharge, verifie et lance l'installateur, puis ferme Audora."""
        info = self.available
        if not info or self.installing:
            return False
        self.installing = True
        try:
            os.makedirs(UPDATES_DIR, exist_ok=True)
            dest = os.path.join(UPDATES_DIR, info["name"])
            request = urllib.request.Request(info["checksum"], headers={"User-Agent": f"Audora/{VERSION}"})
            with urllib.request.urlopen(request, timeout=20) as response:
                expected = response.read().decode("ascii", "replace").split()[0].strip().lower()
            digest = hashlib.sha256()
            request = urllib.request.Request(info["installer"], headers={"User-Agent": f"Audora/{VERSION}"})
            with urllib.request.urlopen(request, timeout=120) as response, open(dest + ".part", "wb") as f:
                while chunk := response.read(1 << 16):
                    digest.update(chunk)
                    f.write(chunk)
            if digest.hexdigest() != expected:
                os.remove(dest + ".part")
                raise ValueError("Le fichier téléchargé est abîmé (empreinte différente) : mise à jour annulée.")
            os.replace(dest + ".part", dest)
            log.info("Installation de la version %s", info["version"])
            subprocess.Popen([dest, "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART"], close_fds=True)
            quit_app()
            return True
        finally:
            self.installing = False
