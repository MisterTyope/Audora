"""
Audora - bibliotheque musicale + lecteur + telechargements YouTube.

Le moteur (yt-dlp, bibliotheque, serveur local) est en Python ; l'interface est
une page web (dossier web/) affichee dans une fenetre native par pywebview.
"""

import ctypes
import json
import os
import subprocess
import sys
import threading
import time
import traceback
import urllib.request

from core import config


def _post_to_running_instance(path, payload=None):
    """Envoie une commande a Audora s'il tourne deja. True si ca a marche."""
    try:
        data = json.dumps(payload or {}).encode("utf-8")
        request = urllib.request.Request(f"http://127.0.0.1:{config.BRIDGE_PORT}{path}", data=data, method="POST",
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


# Lance par Windows au demarrage du PC : on demarre reduit dans la barre des taches.
_START_MINIMIZED = "--startup" in sys.argv

# Les entrees de la liste de raccourcis (clic droit sur l'icone) relancent Audora avec
# "--action ..." : on transmet la commande a l'instance ouverte et on s'arrete aussitot,
# avant de charger les modules lourds, pour que la reaction soit immediate.
_STARTUP_ACTION = None
if __name__ == "__main__" and "--action" in sys.argv:
    _index = sys.argv.index("--action")
    _STARTUP_ACTION = sys.argv[_index + 1] if _index + 1 < len(sys.argv) else ""
    if _post_to_running_instance("/action", {"action": _STARTUP_ACTION}) or _STARTUP_ACTION == "quit":
        sys.exit(0)
    # Audora n'etait pas ouvert : on le demarre, puis on executera la commande.

# Relance demandee par Audora lui-meme (ex. nouveau moteur YouTube) : l'ancienne instance
# est en train de se fermer, on attend qu'elle libere la place au lieu de lui passer la main.
_RESTARTED = "--restarted" in sys.argv

from core import engine, journal  # noqa: E402

journal.setup()  # journal des erreurs, avant tout le reste
engine.activate()  # yt-dlp a jour (telecharge en arriere-plan), a charger avant tout import de yt_dlp

import pystray  # noqa: E402
import webview  # noqa: E402
from PIL import Image  # noqa: E402

from core import search as youtube
from core.downloads import DownloadManager
from core.library import Library, _move_to_recycle_bin
from core.loudness import LoudnessAnalyzer
from core.lyrics import LyricsFinder, lyrics_for
from core.mini import MiniPlayer
from core import startup
from core.genres import FAMILY_ORDER, CoverFinder, GenreFinder
from core.trim import LibraryTrimmer
from core.updater import Updater, enabled as updater_enabled
from core.version import VERSION
from core.phone import PhoneSync
from core.server import start_server
from core.taskbar import THUMB_ACTIONS, Taskbar
from core.window_chrome import CustomTitleBar, enable_drag_regions, set_app_id

APP_TITLE = "Audora"
APP_ID = "Audora.MusicPlayer"
BG_COLOR = "#17121F"
# Page de demarrage vide : la zone de deplacement (app-region) de WebView2 ne s'active
# qu'a la navigation suivante, donc on l'active ici avant de charger la vraie interface.
_BOOT_HTML = f"<html><body style='margin:0;background:{BG_COLOR}'></body></html>"


def _read_clipboard_text():
    if sys.platform != "win32":
        return ""
    user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
    user32.GetClipboardData.restype = ctypes.c_void_p
    kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
    if not user32.OpenClipboard(None):
        return ""
    try:
        handle = user32.GetClipboardData(13)  # CF_UNICODETEXT
        if not handle:
            return ""
        pointer = kernel32.GlobalLock(handle)
        if not pointer:
            return ""
        try:
            return ctypes.wstring_at(pointer)
        finally:
            kernel32.GlobalUnlock(handle)
    finally:
        user32.CloseClipboard()


class Api:
    """Fonctions appelables depuis l'interface (window.pywebview.api.<nom>)."""

    def __init__(self, app):
        self._app = app

    # --- Etat ---

    def get_state(self):
        app = self._app
        return {
            "tracks": app.library.list_tracks(),
            "playlists": app.library.list_playlists(),
            "downloads": app.downloads.list(),
            "config": app.config.public(),
            "bridge": app.bridge_enabled,
            "autostart": startup.is_autostart_enabled(),
            "phone": app.phone.state(),
            "genres": FAMILY_ORDER,
            "engine": engine.status(),
            "tools": {"ffmpeg": bool(config.FFMPEG), "node": bool(config.NODE)},
            "app": {"version": VERSION, "updates": updater_enabled(),
                    "available": (self._app.updater.available or {}).get("version")},
        }

    # --- Moteur YouTube ---

    def engine_check(self):
        engine.check_for_update(self._app.on_engine_update, force=True)

    # --- Mini-lecteur ---

    def toggle_mini(self):
        self._app.toggle_mini()

    def mini_state(self, state):
        if self._app.mini is not None and isinstance(state, dict):
            self._app.mini.push(state)

    # --- Paroles ---

    def get_lyrics(self, track_id, refresh=False):
        try:
            return lyrics_for(self._app.library, int(track_id), refresh=bool(refresh))
        except Exception as exc:
            journal.log.warning("Paroles indisponibles : %s", exc)
            raise ValueError("Paroles indisponibles : pas de connexion à internet ?")

    # --- Sauvegardes et journal ---

    def backups_info(self):
        return {"backups": journal.backups(), "folder": journal.BACKUP_DIR}

    def backup_now(self):
        journal.backup_library(config.DB_PATH, force=True)
        return self.backups_info()

    def open_data_folder(self, which="sauvegardes"):
        folder = journal.BACKUP_DIR if which == "sauvegardes" else config.DATA_DIR
        os.makedirs(folder, exist_ok=True)
        os.startfile(folder)

    def log_js_error(self, message):
        journal.log.error("Interface : %s", str(message)[:2000])

    def check_app_update(self):
        self._app.updater.check_in_background(force=True)

    def install_app_update(self):
        try:
            return self._app.updater.install(self._app.quit)
        except Exception as exc:
            journal.log.exception("Mise a jour d'Audora impossible")
            raise ValueError(str(exc) or "Mise à jour impossible")

    def engine_status(self):
        return engine.status()

    def restart_app(self):
        self._app.restart()

    def get_library(self):
        return {"tracks": self._app.library.list_tracks(), "playlists": self._app.library.list_playlists()}

    def rescan(self):
        result = self._app.library.scan(self._app.config.get("library_folder"))
        return {**result, **self.get_library()}

    def set_config(self, key, value):
        if key not in config.EDITABLE_KEYS:
            raise ValueError(f"Réglage inconnu : {key}")
        self._app.config.set(key, value)
        return self._app.config.public()

    def choose_library_folder(self):
        dialog_type = getattr(getattr(webview, "FileDialog", None), "FOLDER", None) or webview.FOLDER_DIALOG
        result = self._app.window.create_file_dialog(dialog_type, directory=self._app.config.get("library_folder"))
        if not result:
            return None
        folder = result[0] if isinstance(result, (list, tuple)) else result
        self._app.config.set("library_folder", folder)
        return self.rescan() | {"config": self._app.config.public()}

    # --- Telephone ---

    def phone_state(self):
        return self._app.phone.state()

    def phone_enable(self, enabled):
        return self._app.phone.set_enabled(bool(enabled))

    def phone_start_pairing(self):
        return self._app.phone.start_pairing()

    def phone_cancel_pairing(self):
        self._app.phone.cancel_pairing()

    def phone_remove_device(self, device_id):
        return self._app.phone.remove_device(device_id)

    def phone_install_qr(self):
        return self._app.phone.install_qr_svg()

    def phone_send(self, kind, ids):
        """Ajoute des titres ("track") ou des playlists ("playlist") a la synchro du telephone."""
        if kind not in ("track", "playlist"):
            raise ValueError("Type inconnu")
        self._app.library.phone_add(kind, [int(i) for i in ids])
        if kind == "playlist":
            self._app.phone.note_playlists([int(i) for i in ids], sent=True)
        return self._app.library.phone_items()

    def phone_unsend(self, kind, ids):
        if kind not in ("track", "playlist"):
            raise ValueError("Type inconnu")
        self._app.library.phone_remove(kind, [int(i) for i in ids])
        if kind == "playlist":
            self._app.phone.note_playlists([int(i) for i in ids], sent=False)
        return self._app.library.phone_items()

    def phone_all_playlists(self, enabled):
        return self._app.phone.set_all_playlists(enabled)

    def set_autostart(self, enabled):
        return startup.set_autostart(bool(enabled))

    def create_desktop_shortcut(self):
        startup.create_desktop_shortcut(app_id=APP_ID)
        return True

    def open_library_folder(self):
        folder = self._app.config.get("library_folder")
        os.makedirs(folder, exist_ok=True)
        os.startfile(folder)

    def reveal_track(self, track_id):
        path = self._app.library.get_track_path(int(track_id))
        if path and os.path.exists(path):
            subprocess.Popen(["explorer", "/select,", path])

    # --- Fenetre (barre de titre sur mesure) ---

    def win_minimize(self):
        self._app.window.minimize()

    def win_toggle_maximize(self):
        if self._app.is_maximized():
            self._app.window.restore()
        else:
            self._app.window.maximize()

    def win_close(self):
        self._app.hide_to_tray()

    def win_is_maximized(self):
        return self._app.is_maximized()

    def read_clipboard(self):
        try:
            return (_read_clipboard_text() or "").strip()
        except Exception:
            return ""

    # --- YouTube ---

    def search(self, query):
        return youtube.search(query, known_artists=self._app.library.known_artist_keys())

    def search_details(self, ids):
        return youtube.details(ids)

    def preview_stream(self, video_id):
        return youtube.stream_url(video_id)

    def preview(self, url, as_playlist=False):
        return youtube.preview(url, as_playlist)

    def download(self, options):
        allowed = {"url", "format", "quality", "playlist", "start", "end", "title", "thumb"}
        return self._app.downloads.add(**{k: v for k, v in (options or {}).items() if k in allowed})

    def cancel_download(self, job_id):
        self._app.downloads.cancel(job_id)

    def retry_download(self, job_id):
        return self._app.downloads.retry(job_id)

    def clear_downloads(self):
        return self._app.downloads.clear_finished()

    # --- Bibliotheque ---

    def update_track(self, track_id, title, artist, album):
        return self._app.library.update_track(int(track_id), title, artist, album)

    def delete_track(self, track_id):
        self._app.library.delete_track(int(track_id), self._app.config.get("library_folder"))

    def set_track_genre(self, track_id, genre, whole_artist=False):
        self._app.library.set_track_genre(int(track_id), genre, bool(whole_artist))
        return self.get_library()

    # --- Seulement la musique (blancs et passages parles) ---

    def trim_state(self):
        return self._app.trimmer.snapshot()

    def trim_scan(self):
        return self._app.trimmer.scan()

    def trim_apply(self, selection):
        return self._app.trimmer.apply(selection)

    def find_duplicates(self):
        return self._app.library.find_duplicates(self._app.config.get("library_folder"))

    def delete_tracks(self, track_ids):
        """Suppression groupee (doublons). Retourne le nombre supprime et les erreurs eventuelles."""
        deleted, errors = 0, []
        for track_id in track_ids:
            try:
                self._app.library.delete_track(int(track_id), self._app.config.get("library_folder"))
                deleted += 1
            except Exception as exc:
                errors.append(str(exc))
        return {"deleted": deleted, "errors": errors}

    def phone_unsend_all(self):
        """Retire toutes les musiques du telephone : il les efface a sa prochaine synchro."""
        items = self._app.library.phone_items()
        self._app.config.set("phone_all_playlists", False)  # sinon elles reviendraient a la synchro suivante
        self._app.library.phone_remove("track", items["tracks"])
        self._app.library.phone_remove("playlist", items["playlists"])
        return self._app.library.phone_items()

    def record_play(self, track_id):
        self._app.library.record_play(int(track_id))
        self._app.schedule_jump_list_update()

    def set_playback_state(self, playing, title=None, artist=None):
        """L'interface previent quand la lecture demarre ou s'arrete (boutons de la barre des taches)."""
        if self._app.taskbar:
            tooltip = f"{title} – {artist}" if title else "Audora"
            self._app.taskbar.set_playing(bool(playing), tooltip)

    def create_playlist(self, name, track_ids=None):
        return self._app.library.create_playlist(name, track_ids or [])

    def rename_playlist(self, playlist_id, name):
        self._app.library.rename_playlist(int(playlist_id), name)

    def delete_playlist(self, playlist_id):
        self._app.library.delete_playlist(int(playlist_id))

    def add_to_playlist(self, playlist_id, track_ids):
        self._app.library.add_to_playlist(int(playlist_id), track_ids)

    def remove_from_playlist(self, playlist_id, index):
        self._app.library.remove_from_playlist(int(playlist_id), int(index))

    def set_playlist_order(self, playlist_id, track_ids):
        """Nouvel ordre d'une playlist (glisser-deposer) ; le telephone le recoit a la synchro."""
        self._app.library.set_playlist_tracks(int(playlist_id), [int(t) for t in track_ids])


class App:
    def __init__(self, startup_action=None):
        config.migrate_legacy_data()  # anciennes versions : donnees dans data/ a cote de l'appli
        os.makedirs(config.COVERS_DIR, exist_ok=True)
        self.config = config.Config()
        self.library = Library()
        self.downloads = DownloadManager(self.library, self.config.get, self.emit,
                                         os.path.join(os.path.dirname(config.DB_PATH), "file_attente.json"))
        self.window = None
        self.bridge_enabled = False
        self._tray = None
        self.mini = None  # mini-lecteur flottant (cree au lancement de la fenetre)
        self._quitting = False
        self._page_ready = threading.Event()
        self._title_bar = None
        self._ui_url = None
        self._startup_action = startup_action
        self._jump_list_timer = None
        self.taskbar = Taskbar(APP_ID) if sys.platform == "win32" else None
        self.phone = PhoneSync(self.library, self.config, self.emit, self.downloads)
        self.genres = GenreFinder(self.library, lambda: self.emit("library_changed"))
        self.covers = CoverFinder(self.library, lambda: self.emit("library_changed"))
        self.loudness = LoudnessAnalyzer(self.library, lambda: self.emit("library_changed"))
        self.lyrics = LyricsFinder(self.library, lambda: None)
        self.trimmer = LibraryTrimmer(self.library, self.emit, _move_to_recycle_bin)
        self.updater = Updater(lambda info: self.emit("app_update", {"version": info["version"], "notes": info["notes"]}))

    # --- Communication avec l'interface ---

    def emit(self, name, payload=None):
        if name == "download":
            self._update_download_progress()
        if name == "library_changed":
            self.genres.start()  # nouveaux artistes : on cherche leur genre
            self.covers.start()  # et les pochettes qui manquent
            self.loudness.start()  # et le volume des nouveaux titres
            self.lyrics.start()  # et les paroles des titres du telephone
        if not self.window or not self._page_ready.is_set():
            return
        script = (f"window.onBackendEvent && window.onBackendEvent("
                  f"{json.dumps(name)}, {json.dumps(payload, ensure_ascii=False)})")
        try:
            self.window.evaluate_js(script)
        except Exception:
            pass

    def handle_external_download(self, url, fmt):
        """Demande venant de l'extension navigateur : ajout direct a la file."""
        self.downloads.add(url, format=fmt, quality=self.config.get("quality"))
        self.emit("toast", {"message": "Ajouté aux téléchargements depuis le navigateur"})
        if self._tray is not None and self._is_minimized():
            try:
                self._tray.notify("Téléchargement ajouté depuis le navigateur.", APP_TITLE)
            except Exception:
                pass

    def handle_action(self, action):
        """Commandes venant de la barre des taches (liste de raccourcis, boutons sous l'apercu)."""
        if action == "quit":
            self.quit()
        elif action == "show":
            self.show_window()
        elif action == "mini":
            self.toggle_mini()
        elif action in ("toggle", "next", "prev", "shuffle", "repeat"):
            self.emit("player_action", {"action": action})
        elif action.startswith("play:") and action[5:].isdigit():
            self.emit("player_action", {"action": "play", "track": int(action[5:])})

    # --- Barre des taches ---

    def schedule_jump_list_update(self, delay=15.0):
        """Met a jour "Ecoutes souvent" (regroupe les mises a jour rapprochees)."""
        if not self.taskbar:
            return
        if self._jump_list_timer is not None:
            self._jump_list_timer.cancel()
        self._jump_list_timer = threading.Timer(delay, lambda: self.taskbar.update_jump_list(self.library.frequent_tracks()))
        self._jump_list_timer.daemon = True
        self._jump_list_timer.start()

    def _update_download_progress(self):
        if not self.taskbar:
            return
        active = [j for j in self.downloads.list() if j["status"] in ("queued", "downloading", "processing")]
        self.taskbar.set_progress(sum(j["progress"] for j in active) / len(active) if active else None)

    def _on_thumb_button(self, button_id):
        action = THUMB_ACTIONS.get(button_id)
        if action:
            # Appele depuis la boucle de messages de la fenetre : on ne bloque pas ce thread.
            threading.Thread(target=self.handle_action, args=(action,), daemon=True).start()

    # --- Fenetre ---

    def _is_minimized(self):
        return bool(self._title_bar and ctypes.windll.user32.IsIconic(self._title_bar.hwnd))

    def show_window(self):
        try:
            self.window.show()
            if self._is_minimized():
                self.window.restore()
            if self._title_bar:
                ctypes.windll.user32.SetForegroundWindow(self._title_bar.hwnd)
        except Exception:
            journal.log.exception("Affichage de la fenetre impossible")

    def is_maximized(self):
        return bool(self._title_bar and self._title_bar.is_maximized())

    def hide_to_tray(self):
        """La croix cache Audora : plus de bouton dans la barre des taches, seulement l'icone dans
        les icones cachees (^) pres de l'horloge. La musique, les telechargements et la synchro
        continuent. Clic sur l'icone : Audora revient ; clic droit > Quitter : il s'arrete vraiment."""
        threading.Thread(target=self.window.hide, daemon=True).start()
        if not self.config.get("tray_hint_shown") and self._tray is not None:
            self.config.set("tray_hint_shown", True)
            try:
                self._tray.notify("Audora continue en arrière-plan : retrouve-le dans les icônes cachées (^), "
                                  "près de l'horloge. Clic droit sur son icône > Quitter pour l'arrêter.", APP_TITLE)
            except Exception:
                pass

    def _on_closing(self):
        if self._quitting:
            return True
        self.hide_to_tray()  # Alt+F4 ou "Fermer la fenetre" : meme comportement que la croix
        return False

    def _ensure_shortcut(self):
        try:
            import pythoncom
            pythoncom.CoInitialize()
            startup.ensure_start_menu_shortcut(APP_ID)
        except Exception:
            journal.log.exception("Raccourci du menu Demarrer impossible")

    def toggle_mini(self):
        if self.mini is not None:
            self.mini.toggle()

    def quit(self, icon=None, item=None):
        self._quitting = True
        if self.mini is not None and self.mini.window is not None:
            try:
                self.mini.window.destroy()  # sinon la fenetre restante garderait Audora ouvert
            except Exception:
                pass
        if self._tray is not None:
            self._tray.stop()
        self.window.destroy()

    def _start_tray(self):
        try:
            image = Image.open(config.ICON_PATH)
        except Exception:
            image = Image.new("RGB", (64, 64), "#FFB547")
        def action(name):
            return lambda icon, item: self.handle_action(name)

        menu = pystray.Menu(
            pystray.MenuItem("Ouvrir Audora", action("show"), default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Lecture / Pause", action("toggle")),
            pystray.MenuItem("Titre précédent", action("prev")),
            pystray.MenuItem("Titre suivant", action("next")),
            pystray.MenuItem("Aléatoire", action("shuffle")),
            pystray.MenuItem("Répéter", action("repeat")),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Mini-lecteur", action("mini")),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quitter Audora", self.quit),
        )
        self._tray = pystray.Icon("audora", image, APP_TITLE, menu)
        threading.Thread(target=self._tray.run, daemon=True).start()

    def _on_loaded(self):
        if not self._page_ready.is_set() and self.window.get_current_url() != self._ui_url:
            # 1er chargement = page vide : on installe la barre sur mesure puis on charge l'interface.
            if sys.platform == "win32":
                try:
                    hwnd = self.window.native.Handle.ToInt64()
                    self._title_bar = CustomTitleBar(
                        hwnd, on_thumb_button=self._on_thumb_button,
                        on_taskbar_button_created=lambda: self.taskbar and self.taskbar.taskbar_button_recreated())
                    enable_drag_regions(self.window)
                    if self.taskbar:
                        self.taskbar.attach(hwnd)
                except Exception:
                    journal.log.exception("Barre de titre ou barre des taches indisponible")
            self.window.load_url(self._ui_url)
            return
        if self._page_ready.is_set() and self.window.get_current_url() != self._ui_url:
            self.window.load_url(self._ui_url)  # l'interface a ete quittee (bouton "retour") : on y revient
            return
        self._page_ready.set()
        self.emit("window_state", {"maximized": self.is_maximized()})
        self.schedule_jump_list_update(delay=1.0)
        if self._startup_action and self._startup_action != "quit":
            action, self._startup_action = self._startup_action, None
            threading.Timer(1.5, self.handle_action, args=(action,)).start()  # laisse l'interface demarrer

    def _on_window_state(self):
        self.emit("window_state", {"maximized": self.is_maximized()})

    def _initial_scan(self):
        self.library.scan(self.config.get("library_folder"))
        self.emit("library_changed")
        self.genres.start()
        self.covers.start()
        self.loudness.start()
        self.lyrics.start()
        engine.check_for_update(self.on_engine_update)
        journal.start_daily_backups(config.DB_PATH)
        self.updater.check_in_background()

    def on_engine_update(self):
        self.emit("engine", engine.status())

    def restart(self):
        """Relance Audora (nouveau moteur YouTube) : la file de telechargement est sauvegardee."""
        program, args = config.launcher()
        subprocess.Popen(f'"{program}" {args}--restarted', close_fds=True,
                         creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))
        self.quit()

    # --- Lancement ---

    def run(self):
        server = start_server(self, config.BRIDGE_PORT)
        if server is None:
            # Deja ouvert : on l'affiche (sauf au demarrage du PC, ou on reste discret).
            if not _RESTARTED and (_START_MINIMIZED or _post_to_running_instance("/focus")):
                return
            # Le port est sans doute encore tenu par l'Audora qui vient de se fermer
            # (redemarrage, mise a jour) : on lui laisse quelques secondes pour le liberer.
            for _ in range(20):
                time.sleep(0.5)
                server = start_server(self, config.BRIDGE_PORT)
                if server is not None:
                    break
            else:
                # Pris par autre chose : on demarre quand meme, sans le pont pour l'extension.
                server = start_server(self, 0)
        self.bridge_enabled = server.server_address[1] == config.BRIDGE_PORT
        port = server.server_address[1]

        self._ui_url = f"http://127.0.0.1:{port}/"
        self.mini = MiniPlayer(self, self.config, self._ui_url)
        self.window = webview.create_window(
            APP_TITLE, html=_BOOT_HTML, js_api=Api(self),
            width=1280, height=820, min_size=(960, 620), background_color=BG_COLOR,
            hidden=_START_MINIMIZED,  # au demarrage du PC : directement dans les icones cachees
        )
        self.window.events.closing += self._on_closing
        self.window.events.loaded += self._on_loaded
        self.window.events.maximized += self._on_window_state
        self.window.events.restored += self._on_window_state
        self._start_tray()
        threading.Thread(target=self._initial_scan, daemon=True).start()
        threading.Thread(target=startup.refresh_autostart_command, daemon=True).start()
        threading.Thread(target=self._ensure_shortcut, daemon=True).start()
        if self.config.get("phone_sync"):
            self.phone.start()
        webview.start(private_mode=False, storage_path=config.WEBVIEW_STORAGE, icon=config.ICON_PATH)
        if self._tray is not None:
            self._tray.stop()


def main():
    set_app_id(APP_ID)
    try:
        App(_STARTUP_ACTION).run()
    except Exception:
        # Lance sans console (pythonw / .exe) : on garde une trace et on previent.
        os.makedirs(config.DATA_DIR, exist_ok=True)
        with open(os.path.join(config.DATA_DIR, "erreur.log"), "a", encoding="utf-8") as f:
            f.write(traceback.format_exc() + "\n")
        journal.log.critical("Audora n'a pas pu demarrer", exc_info=True)
        if sys.platform == "win32":
            ctypes.windll.user32.MessageBoxW(
                0, f"Audora n'a pas pu démarrer. Le détail est dans {os.path.join(config.DATA_DIR, 'erreur.log')}.", APP_TITLE, 0x10)
        raise


if __name__ == "__main__":
    main()
