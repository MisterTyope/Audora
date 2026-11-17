"""Barre de titre sur mesure (Windows).

Plutot qu'une fenetre sans bordure (qui perd le redimensionnement, l'aimantation aux
bords de l'ecran et cache la barre des taches une fois agrandie), on garde une vraie
fenetre Windows et on retire seulement sa barre de titre : en reponse a WM_NCCALCSIZE,
la zone "client" (la page web) s'etend jusqu'en haut. Les bords gauche/droit/bas restent
des bords Windows invisibles, donc redimensionnables. La page dessine sa propre barre,
marquee en CSS `app-region: drag` pour que WebView2 la traite comme une barre de titre.
"""

import ctypes
import sys
from ctypes import wintypes

_IS_WINDOWS = sys.platform == "win32"

WM_NCCALCSIZE = 0x0083
WM_COMMAND = 0x0111
THBN_CLICKED = 0x1800
GWLP_WNDPROC = -4
SM_CXSIZEFRAME, SM_CYSIZEFRAME, SM_CXPADDEDBORDER = 32, 33, 92
SWP_FRAMECHANGED = 0x0020
SWP_FLAGS = 0x0001 | 0x0002 | 0x0004 | 0x0010 | SWP_FRAMECHANGED  # NOSIZE|NOMOVE|NOZORDER|NOACTIVATE

if _IS_WINDOWS:
    # Copie privee de user32 : les types d'arguments declares ici ne doivent pas s'appliquer
    # au reste du programme (pywebview appelle SetWindowPos autrement pour deplacer ses fenetres).
    _user32 = ctypes.WinDLL("user32")
    _LRESULT = ctypes.c_ssize_t
    _WNDPROC = ctypes.WINFUNCTYPE(_LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    _user32.CallWindowProcW.argtypes = [ctypes.c_void_p, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    _user32.CallWindowProcW.restype = _LRESULT
    _user32.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_void_p]
    _user32.SetWindowLongPtrW.restype = ctypes.c_void_p
    _user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]

    class _NCCALCSIZE_PARAMS(ctypes.Structure):
        _fields_ = [("rgrc", wintypes.RECT * 3), ("lppos", ctypes.c_void_p)]


def set_app_id(app_id):
    """Regroupe la fenetre sous notre icone dans la barre des taches (et non celle de Python)."""
    if _IS_WINDOWS:
        try:
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(app_id)
        except Exception:
            pass


class CustomTitleBar:
    def __init__(self, hwnd, on_thumb_button=None, on_taskbar_button_created=None):
        self.hwnd = hwnd
        self._on_thumb_button = on_thumb_button
        self._on_taskbar_button_created = on_taskbar_button_created
        # Message envoye par Windows quand le bouton de la barre des taches est (re)cree,
        # par exemple apres un redemarrage de l'explorateur : il faut remettre nos boutons.
        self._taskbar_created_msg = _user32.RegisterWindowMessageW("TaskbarButtonCreated")
        self._proc = _WNDPROC(self._wndproc)  # garder une reference, sinon le callback est libere
        self._old_proc = _user32.SetWindowLongPtrW(hwnd, GWLP_WNDPROC, ctypes.cast(self._proc, ctypes.c_void_p))
        _user32.SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_FLAGS)  # recalcule le cadre tout de suite

    def is_maximized(self):
        return bool(_user32.IsZoomed(self.hwnd))

    def _frame_size(self):
        dpi = _user32.GetDpiForWindow(self.hwnd) or 96
        padding = _user32.GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi)
        return (_user32.GetSystemMetricsForDpi(SM_CXSIZEFRAME, dpi) + padding,
                _user32.GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi) + padding)

    def _wndproc(self, hwnd, msg, wparam, lparam):
        try:
            if msg == WM_NCCALCSIZE and wparam:
                rect = _NCCALCSIZE_PARAMS.from_address(lparam).rgrc[0]
                fx, fy = self._frame_size()
                rect.left += fx
                rect.right -= fx
                rect.bottom -= fy
                if self.is_maximized():
                    # Agrandie, la fenetre deborde de l'ecran de l'epaisseur du cadre.
                    rect.top += fy
                return 0
            if msg == WM_COMMAND and (wparam >> 16) & 0xFFFF == THBN_CLICKED and self._on_thumb_button:
                self._on_thumb_button(wparam & 0xFFFF)
                return 0
            if msg == self._taskbar_created_msg and self._on_taskbar_button_created:
                self._on_taskbar_button_created()
        except Exception:
            pass
        return _user32.CallWindowProcW(self._old_proc, hwnd, msg, wparam, lparam)


def enable_drag_regions(window):
    """Active `app-region: drag` dans WebView2 (zone qui se comporte comme une barre de titre)."""
    from System import Action  # pythonnet, disponible avec le moteur WinForms de pywebview

    def apply():
        core = window.native.browser.webview.CoreWebView2
        core.Settings.IsNonClientRegionSupportEnabled = True

    window.native.Invoke(Action(apply))
