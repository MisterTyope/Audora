"""Moteur YouTube (yt-dlp) tenu a jour sans recompiler Audora.

YouTube change souvent, et un yt-dlp de quelques semaines se fait vite bloquer. Le .exe
contient sa propre copie de yt-dlp, figee a la compilation : Audora telecharge donc en
arriere-plan la derniere version publiee sur PyPI (fichier .whl verifie par son empreinte
SHA-256) dans %LOCALAPPDATA%\\Audora\\engine, et la charge au lancement suivant a la place
de la copie integree. Si la nouvelle version ne se charge pas, on revient a la copie integree.
"""

import hashlib
import importlib.abc
import importlib.machinery
import json
import os
import sys
import threading
import time
import urllib.request
import zipfile

from . import config

ENGINE_DIR = os.path.join(config.DATA_DIR, "engine")
STATE_PATH = os.path.join(ENGINE_DIR, "engine.json")
CHECK_EVERY = 12 * 3600  # une verification toutes les 12 heures au plus
# paquet PyPI -> module Python. yt-dlp-ejs : scripts qui resolvent les "defis" JavaScript de YouTube.
PACKAGES = {"yt-dlp": "yt_dlp", "yt-dlp-ejs": "yt_dlp_ejs"}

_finders = []
active = {}  # paquet -> version chargee depuis le dossier engine


def _version_key(version):
    return tuple(int(p) if p.isdigit() else 0 for p in str(version).replace("-", ".").split("."))


def _load_state():
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_state(state):
    os.makedirs(ENGINE_DIR, exist_ok=True)
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=1)
    os.replace(tmp, STATE_PATH)


class _WheelFinder(importlib.abc.MetaPathFinder):
    """Fait passer `module` (et ses sous-modules) par le .whl, avant la copie integree au .exe."""

    def __init__(self, module, wheel):
        self.module, self.wheel = module, wheel

    def find_spec(self, fullname, path=None, target=None):
        if fullname != self.module and not fullname.startswith(self.module + "."):
            return None
        return importlib.machinery.PathFinder.find_spec(fullname, path or [self.wheel])


def _purge(module):
    for name in [n for n in sys.modules if n == module or n.startswith(module + ".")]:
        del sys.modules[name]


def activate():
    """A appeler avant le premier `import yt_dlp`. Charge les versions telechargees, si valides."""
    if not config.IS_FROZEN:
        return  # depuis les sources, c'est pip qui tient yt-dlp a jour
    state = _load_state()
    # D'abord tous les chemins (yt-dlp cherche yt_dlp_ejs des son import), ensuite les imports.
    candidates = []
    for package, module in PACKAGES.items():
        info = state.get(package) or {}
        wheel = os.path.join(ENGINE_DIR, info.get("file") or "")
        if info.get("file") and not info.get("bad") and os.path.exists(wheel):
            finder = _WheelFinder(module, wheel)
            sys.meta_path.insert(0, finder)
            candidates.append((package, module, info, finder))
    for package, module, info, finder in reversed(candidates):  # yt_dlp_ejs avant yt_dlp
        try:
            __import__(module)
            active[package] = info["version"]
            _finders.append(finder)
        except Exception:
            # Version cassee (ou incompatible) : on l'ecarte et on garde la copie integree.
            sys.meta_path.remove(finder)
            _purge(module)
            info["bad"] = True
            _save_state(state)


def current_version():
    try:
        from yt_dlp.version import __version__
        return __version__
    except Exception:
        return None


def status():
    state = _load_state()
    pending = {p: i["version"] for p, i in state.items()
               if isinstance(i, dict) and i.get("version") and not i.get("bad") and active.get(p) != i["version"]
               and (p != "yt-dlp" or _version_key(i["version"]) > _version_key(current_version() or "0"))}
    return {"version": current_version(), "updated": "yt-dlp" in active, "pending": pending,
            "checked": state.get("checked")}


def _fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Audora", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def _download_latest(package, module, state):
    """Telecharge le .whl le plus recent s'il est plus recent que ce qu'on a. True si nouveau."""
    data = _fetch_json(f"https://pypi.org/pypi/{package}/json")
    version = data["info"]["version"]
    known = (state.get(package) or {}).get("version")
    loaded = current_version() if package == "yt-dlp" else None
    floor = max([v for v in (known, loaded) if v] or ["0"], key=_version_key)
    if _version_key(version) <= _version_key(floor) and not (state.get(package) or {}).get("bad"):
        return False
    wheel = next((u for u in data["urls"] if u.get("packagetype") == "bdist_wheel"
                  and u["filename"].endswith("-py3-none-any.whl")), None)
    if not wheel:
        return False
    os.makedirs(ENGINE_DIR, exist_ok=True)
    dest = os.path.join(ENGINE_DIR, wheel["filename"])
    tmp = dest + ".part"
    request = urllib.request.Request(wheel["url"], headers={"User-Agent": "Audora"})
    digest = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=60) as response, open(tmp, "wb") as f:
        while chunk := response.read(1 << 16):
            digest.update(chunk)
            f.write(chunk)
    if digest.hexdigest() != wheel["digests"]["sha256"]:
        os.remove(tmp)
        raise ValueError(f"{package} : empreinte incorrecte, fichier ignoré")
    with zipfile.ZipFile(tmp) as z:  # c'est bien le module attendu ?
        if f"{module}/__init__.py" not in z.namelist():
            os.remove(tmp)
            raise ValueError(f"{package} : archive inattendue")
    os.replace(tmp, dest)
    old = (state.get(package) or {}).get("file")
    state[package] = {"version": version, "file": wheel["filename"], "downloaded": time.time()}
    if old and old != wheel["filename"] and (package not in active):
        try:
            os.remove(os.path.join(ENGINE_DIR, old))  # l'ancienne version n'est plus chargee
        except OSError:
            pass
    return True


def check_for_update(on_new=None, force=False):
    """En arriere-plan : telecharge les nouvelles versions. on_new() si quelque chose a change."""
    if not config.IS_FROZEN:
        return

    def run():
        state = _load_state()
        if not force and time.time() - (state.get("checked") or 0) < CHECK_EVERY:
            return
        changed = False
        for package, module in PACKAGES.items():
            try:
                changed |= _download_latest(package, module, state)
            except Exception:
                pass  # pas de reseau, PyPI indisponible... : on reessaiera plus tard
        state["checked"] = time.time()
        _save_state(state)
        if changed and on_new:
            on_new()

    threading.Thread(target=run, daemon=True).start()
