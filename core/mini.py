"""Mini-lecteur flottant : petite fenetre toujours au premier plan, qui pilote le lecteur.

La musique joue dans la fenetre principale (meme cachee dans les icones cachees) : elle envoie
son etat ici (Api.mini_state), on le relaie au mini-lecteur, et ses boutons repartent vers la
fenetre principale par le meme chemin que les boutons de la barre des taches.
"""

import ctypes
import json
import logging
import sys
import threading

import webview

log = logging.getLogger("audora")

SIZES = {"bar": (390, 96), "square": (270, 350)}
MARGIN = 24


class MiniApi:
    """Fonctions appelables depuis la page du mini-lecteur (et seulement celles-ci)."""

    def __init__(self, mini):
        self._mini = mini

    def get_state(self):
        return {"mode": self._mini.mode, "state": self._mini.state}

    def command(self, action):
        if action in ("toggle", "next", "prev"):
            self._mini.app.handle_action(action)

    def seek(self, fraction):
        self._mini.app.emit("player_action", {"action": "seek", "fraction": max(0.0, min(1.0, float(fraction)))})

    def show_main(self):
        self._mini.app.show_window()

    def close(self):
        self._mini.close()

    def toggle_mode(self):
        self._mini.set_mode("square" if self._mini.mode == "bar" else "bar")


class MiniPlayer:
    def __init__(self, app, config, ui_url):
        self.app = app
        self._config = config
        self._ui_url = ui_url
        self.window = None
        self.state = None
        self._lock = threading.Lock()
        self._save_timer = None

    @property
    def mode(self):
        return "square" if self._config.get("mini_mode") == "square" else "bar"

    @property
    def is_open(self):
        return self.window is not None

    def toggle(self):
        if self.is_open:
            self.close()
        else:
            self.open()

    def _default_position(self, width, height):
        try:
            screen = webview.screens[0]
            return screen.width - width - MARGIN, screen.height - height - MARGIN - 48  # au-dessus de la barre des taches
        except Exception:
            return None, None

    @staticmethod
    def _visible(x, y, width, height):
        """La position retenue est-elle encore sur un ecran ? (ex. 2e ecran debranche depuis)"""
        try:
            for screen in webview.screens:
                sx, sy = getattr(screen, "x", 0), getattr(screen, "y", 0)
                if sx - width // 2 <= x <= sx + screen.width - width // 2 and sy <= y <= sy + screen.height - height // 2:
                    return True
        except Exception:
            return True
        return False

    def open(self):
        with self._lock:
            if self.window is not None:
                return
            width, height = SIZES[self.mode]
            pos = self._config.get("mini_pos") or []
            x, y = (pos[0], pos[1]) if len(pos) == 2 and self._visible(pos[0], pos[1], width, height)                 else self._default_position(width, height)
            self.window = webview.create_window(
                "Audora — mini-lecteur", url=self._ui_url + "mini.html", js_api=MiniApi(self),
                width=width, height=height, x=x, y=y, frameless=True, easy_drag=False, on_top=True,
                resizable=False, background_color="#17121F", focus=True)
            self.window.events.loaded += self._on_loaded
            self.window.events.closed += self._on_closed
            self.window.events.moved += self._on_moved
        self.app.emit("mini", {"open": True})

    def close(self):
        window = self.window
        if window is not None:
            threading.Thread(target=window.destroy, daemon=True).start()

    def set_mode(self, mode):
        self._config.set("mini_mode", mode)
        if self.window is None:
            return
        width, height = SIZES[self.mode]
        self.window.resize(width, height)
        self.window.evaluate_js(f"window.onMiniMode({json.dumps(self.mode)})")

    def push(self, state):
        """Etat du lecteur envoye par la fenetre principale."""
        self.state = state
        window = self.window
        if window is not None:
            try:
                window.evaluate_js(f"window.onMiniState && window.onMiniState({json.dumps(state)})")
            except Exception:
                pass  # fenetre en train de se fermer

    # --- Evenements de la fenetre ---

    def _on_loaded(self):
        if sys.platform != "win32":
            return
        try:
            hwnd = self.window.native.Handle.ToInt64()
            user32 = ctypes.windll.user32
            # Fenetre "outil" : pas de bouton dans la barre des taches, pas dans Alt+Tab.
            GWL_EXSTYLE, WS_EX_TOOLWINDOW, WS_EX_APPWINDOW = -20, 0x80, 0x40000
            style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            user32.ShowWindow(hwnd, 0)
            user32.SetWindowLongW(hwnd, GWL_EXSTYLE, (style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW)
            user32.ShowWindow(hwnd, 4)  # SW_SHOWNOACTIVATE
            # Coins arrondis (Windows 11 ; sans effet sur Windows 10).
            corner = ctypes.c_int(2)
            ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 33, ctypes.byref(corner), ctypes.sizeof(corner))
        except Exception:
            log.exception("Mini-lecteur : style de fenetre impossible")

    def _on_closed(self):
        with self._lock:
            self.window = None
        self.app.emit("mini", {"open": False})

    def _on_moved(self, x, y):
        # Position retenue (une fois le deplacement termine).
        if self._save_timer is not None:
            self._save_timer.cancel()
        self._save_timer = threading.Timer(0.6, lambda: self._config.set("mini_pos", [int(x), int(y)]))
        self._save_timer.daemon = True
        self._save_timer.start()
