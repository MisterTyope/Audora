"""Integration a la barre des taches Windows.

- Liste de raccourcis (clic droit sur l'icone d'Audora) : titres les plus ecoutes,
  commandes de lecture et "Quitter". Chaque entree relance Audora avec `--action ...`,
  et ce 2e lancement transmet la commande a l'instance deja ouverte puis s'arrete.
- Boutons Precedent / Lecture / Suivant sous l'apercu de la fenetre (survol de l'icone).
- Progression des telechargements affichee sur l'icone.

Tout passe par un thread dedie qui possede les objets COM (ils doivent rester sur le
thread qui les a crees).
"""

import ctypes
import os
import queue
import sys
import threading
import time
import logging
import uuid
from ctypes import wintypes

from PIL import Image, ImageDraw

from . import config

ICONS_DIR = os.path.join(config.DATA_DIR, "icons")
GLYPH_COLOR = (255, 181, 71, 255)  # ambre d'Audora, lisible sur menu clair comme sombre

THBN_CLICKED = 0x1800
THUMB_BUTTONS = [  # (id, action, infobulle, icone)
    (1, "prev", "Précédent", "prev"),
    (2, "toggle", "Lecture", "play"),
    (3, "next", "Suivant", "next"),
]
THUMB_ACTIONS = {button_id: action for button_id, action, _, _ in THUMB_BUTTONS}

TASKS = [  # (action, titre, icone) ; None = separateur
    ("toggle", "Lecture / Pause", "play"),
    ("prev", "Titre précédent", "prev"),
    ("next", "Titre suivant", "next"),
    None,
    ("shuffle", "Aléatoire", "shuffle"),
    ("repeat", "Répéter", "repeat"),
    None,
    ("quit", "Quitter Audora", "quit"),
]


# ---------- Icones ----------

def _draw_glyph(name):
    s = 256  # dessin en grand puis reduction = bords lisses
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c, w = GLYPH_COLOR, 24
    if name == "play":
        d.polygon([(72, 48), (72, 208), (200, 128)], fill=c)
    elif name == "pause":
        d.rounded_rectangle([64, 48, 108, 208], 10, fill=c)
        d.rounded_rectangle([148, 48, 192, 208], 10, fill=c)
    elif name == "next":
        d.polygon([(52, 52), (52, 204), (168, 128)], fill=c)
        d.rounded_rectangle([172, 52, 204, 204], 8, fill=c)
    elif name == "prev":
        d.rounded_rectangle([52, 52, 84, 204], 8, fill=c)
        d.polygon([(204, 52), (204, 204), (88, 128)], fill=c)
    elif name == "shuffle":
        d.line([(36, 184), (100, 184), (156, 72), (200, 72)], fill=c, width=w, joint="curve")
        d.line([(36, 72), (100, 72), (156, 184), (200, 184)], fill=c, width=w, joint="curve")
        for y in (72, 184):
            d.polygon([(196, y - 34), (196, y + 34), (236, y)], fill=c)
    elif name == "repeat":
        d.rounded_rectangle([40, 76, 216, 196], 44, outline=c, width=w)
        d.rectangle([120, 60, 150, 100], fill=(0, 0, 0, 0))
        d.polygon([(118, 44), (118, 132), (168, 88)], fill=c)
    elif name == "quit":
        d.arc([44, 52, 212, 220], start=-50, end=230, fill=c, width=w)
        d.line([(128, 30), (128, 128)], fill=c, width=w)
    return img


def _save_ico(img, path):
    img.save(path, format="ICO", sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (48, 48)])


def ensure_glyph_icons():
    os.makedirs(ICONS_DIR, exist_ok=True)
    for name in ("play", "pause", "next", "prev", "shuffle", "repeat", "quit"):
        path = os.path.join(ICONS_DIR, f"{name}.ico")
        if not os.path.exists(path):
            _save_ico(_draw_glyph(name), path)


def glyph_path(name):
    return os.path.join(ICONS_DIR, f"{name}.ico")


def cover_icon(track_id, cover_path):
    """Petite icone .ico tiree de la pochette (affichee dans la liste de raccourcis)."""
    if not cover_path or not os.path.exists(cover_path):
        return None
    path = os.path.join(ICONS_DIR, f"track_{track_id}.ico")
    if not os.path.exists(path) or os.path.getmtime(path) < os.path.getmtime(cover_path):
        try:
            img = Image.open(cover_path).convert("RGBA")
            side = min(img.size)
            img = img.crop(((img.width - side) // 2, (img.height - side) // 2,
                            (img.width + side) // 2, (img.height + side) // 2)).resize((64, 64), Image.LANCZOS)
            _save_ico(img, path)
        except Exception:
            return None
    return path


# ---------- ITaskbarList3 (boutons sous l'apercu, progression) ----------

class _GUID(ctypes.Structure):
    _fields_ = [("Data1", ctypes.c_ulong), ("Data2", ctypes.c_ushort),
                ("Data3", ctypes.c_ushort), ("Data4", ctypes.c_ubyte * 8)]

    @classmethod
    def parse(cls, text):
        return cls.from_buffer_copy(uuid.UUID(text).bytes_le)


class THUMBBUTTON(ctypes.Structure):
    _fields_ = [("dwMask", wintypes.DWORD), ("iId", wintypes.UINT), ("iBitmap", wintypes.UINT),
                ("hIcon", wintypes.HICON), ("szTip", wintypes.WCHAR * 260), ("dwFlags", wintypes.DWORD)]


THB_ICON, THB_TOOLTIP, THB_FLAGS = 0x2, 0x4, 0x8
TBPF_NOPROGRESS, TBPF_NORMAL = 0x0, 0x2


class _TaskbarList3:
    """Appels directs a la table de fonctions de l'interface COM ITaskbarList3."""

    _CLSID = "{56FDF344-FD6D-11d0-958A-006097C9A090}"
    _IID = "{EA1AFB91-9E28-4B86-90E9-9E9F8A5EEFAF}"

    def __init__(self):
        self._ptr = ctypes.c_void_p()
        ctypes.oledll.ole32.CoCreateInstance(
            ctypes.byref(_GUID.parse(self._CLSID)), None, 1,
            ctypes.byref(_GUID.parse(self._IID)), ctypes.byref(self._ptr))
        self._vtbl = ctypes.cast(self._ptr, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]
        self._call(3)  # HrInit

    def _call(self, index, *args, argtypes=()):
        fn = ctypes.WINFUNCTYPE(ctypes.HRESULT, ctypes.c_void_p, *argtypes)(self._vtbl[index])
        return fn(self._ptr, *args)

    def set_progress_value(self, hwnd, done, total):
        self._call(9, hwnd, done, total, argtypes=(wintypes.HWND, ctypes.c_ulonglong, ctypes.c_ulonglong))

    def set_progress_state(self, hwnd, flags):
        self._call(10, hwnd, flags, argtypes=(wintypes.HWND, ctypes.c_int))

    def thumbbar_add(self, hwnd, buttons):
        self._call(15, hwnd, len(buttons), buttons, argtypes=(wintypes.HWND, wintypes.UINT, ctypes.POINTER(THUMBBUTTON)))

    def thumbbar_update(self, hwnd, buttons):
        self._call(16, hwnd, len(buttons), buttons, argtypes=(wintypes.HWND, wintypes.UINT, ctypes.POINTER(THUMBBUTTON)))

    def set_thumbnail_tooltip(self, hwnd, text):
        self._call(19, hwnd, text, argtypes=(wintypes.HWND, wintypes.LPCWSTR))


def _load_icon(path, size):
    user32 = ctypes.WinDLL("user32")  # copie privee : nos types d'arguments ne touchent pas le reste du programme
    user32.LoadImageW.restype = wintypes.HANDLE
    user32.LoadImageW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT, ctypes.c_int, ctypes.c_int, wintypes.UINT]
    return user32.LoadImageW(None, path, 1, size, size, 0x10)  # IMAGE_ICON, LR_LOADFROMFILE


# ---------- Liste de raccourcis (pywin32) ----------

def _build_jump_list(app_id, frequent):
    import pythoncom
    from win32com.propsys import propsys, pscon
    from win32com.shell import shell

    exe, base_args = config.launcher()

    def new_link():
        return pythoncom.CoCreateInstance(shell.CLSID_ShellLink, None, pythoncom.CLSCTX_INPROC_SERVER, shell.IID_IShellLink)

    def link(action, title, icon):
        item = new_link()
        item.SetPath(exe)
        item.SetArguments(f"{base_args}--action {action}")
        item.SetWorkingDirectory(config.APP_DIR)
        item.SetIconLocation(icon or config.ICON_PATH, 0)
        item.SetDescription(title)
        store = item.QueryInterface(propsys.IID_IPropertyStore)
        store.SetValue(pscon.PKEY_Title, propsys.PROPVARIANTType(title))
        store.Commit()
        return item

    def separator():
        item = new_link()
        store = item.QueryInterface(propsys.IID_IPropertyStore)
        store.SetValue(pscon.PKEY_AppUserModel_IsDestListSeparator, propsys.PROPVARIANTType(True))
        store.Commit()
        return item

    def collection(items):
        coll = pythoncom.CoCreateInstance(shell.CLSID_EnumerableObjectCollection, None,
                                          pythoncom.CLSCTX_INPROC_SERVER, shell.IID_IObjectCollection)
        for item in items:
            coll.AddObject(item)
        return coll.QueryInterface(shell.IID_IObjectArray)

    dest = pythoncom.CoCreateInstance(shell.CLSID_DestinationList, None,
                                      pythoncom.CLSCTX_INPROC_SERVER, shell.IID_ICustomDestinationList)
    dest.SetAppID(app_id)
    min_slots, _removed = dest.BeginList()
    if frequent:
        items = [link(f"play:{t['id']}", f"{t['title']} – {t['artist']}"[:200], cover_icon(t["id"], t.get("cover")))
                 for t in frequent[:max(4, min(8, min_slots))]]
        dest.AppendCategory("Écoutés souvent", collection(items))
    tasks = [separator() if task is None else link(task[0], task[1], glyph_path(task[2])) for task in TASKS]
    dest.AddUserTasks(collection(tasks))
    dest.CommitList()


# ---------- Controleur ----------

class Taskbar:
    def __init__(self, app_id):
        self._app_id = app_id
        self._queue = queue.Queue()
        self._hwnd = None
        self._list = None
        self._buttons_added = False
        self._playing = False
        self._icons = {}
        threading.Thread(target=self._run, daemon=True).start()

    # Appels publics (n'importe quel thread) : executes sur le thread COM.

    def attach(self, hwnd):
        self._queue.put(lambda: self._attach(hwnd))

    def taskbar_button_recreated(self):
        self._queue.put(self._recreated)

    def set_playing(self, playing, tooltip=None):
        self._queue.put(lambda: self._set_playing(playing, tooltip))

    def set_progress(self, fraction):
        self._queue.put(lambda: self._set_progress(fraction))

    def update_jump_list(self, frequent):
        self._queue.put(lambda: _build_jump_list(self._app_id, frequent))

    # Interne (thread COM)

    def _run(self):
        import pythoncom
        pythoncom.CoInitialize()
        try:
            ensure_glyph_icons()
            self._list = _TaskbarList3()
        except Exception:
            logging.getLogger("audora").exception("Barre des taches")
        while True:
            task = self._queue.get()
            try:
                task()
            except Exception:
                logging.getLogger("audora").exception("Barre des taches")

    def _icon(self, name):
        if name not in self._icons:
            size = ctypes.windll.user32.GetSystemMetrics(49)  # SM_CXSMICON
            self._icons[name] = _load_icon(glyph_path(name), size)
        return self._icons[name]

    def _thumb_buttons(self):
        buttons = (THUMBBUTTON * len(THUMB_BUTTONS))()
        for i, (button_id, action, tip, glyph) in enumerate(THUMB_BUTTONS):
            if action == "toggle":
                glyph, tip = ("pause", "Pause") if self._playing else ("play", "Lecture")
            buttons[i].dwMask = THB_ICON | THB_TOOLTIP | THB_FLAGS
            buttons[i].iId = button_id
            buttons[i].hIcon = self._icon(glyph)
            buttons[i].szTip = tip
            buttons[i].dwFlags = 0  # THBF_ENABLED
        return buttons

    def _attach(self, hwnd):
        self._hwnd = hwnd
        self._add_buttons()

    def _recreated(self):
        self._buttons_added = False
        self._add_buttons()

    def _add_buttons(self):
        if not self._list or not self._hwnd or self._buttons_added:
            return
        # Le bouton de la barre des taches peut ne pas exister tout de suite : on reessaie.
        for _ in range(10):
            try:
                self._list.thumbbar_add(self._hwnd, self._thumb_buttons())
                self._buttons_added = True
                return
            except OSError:
                time.sleep(0.5)
        print("Audora : impossible d'ajouter les boutons sous l'apercu de la barre des taches.", file=sys.stderr)

    def _set_playing(self, playing, tooltip):
        self._playing = playing
        if self._list and self._hwnd and self._buttons_added:
            self._list.thumbbar_update(self._hwnd, self._thumb_buttons())
        if self._list and self._hwnd and tooltip is not None:
            self._list.set_thumbnail_tooltip(self._hwnd, tooltip)

    def _set_progress(self, fraction):
        if not self._list or not self._hwnd:
            return
        if fraction is None:
            self._list.set_progress_state(self._hwnd, TBPF_NOPROGRESS)
        else:
            self._list.set_progress_state(self._hwnd, TBPF_NORMAL)
            self._list.set_progress_value(self._hwnd, int(max(0.0, min(1.0, fraction)) * 1000), 1000)
