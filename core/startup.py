"""Lancement au demarrage de Windows et raccourci sur le Bureau."""

import ctypes
import os
import sys

from . import config

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
# Le Gestionnaire des taches (onglet Demarrage) desactive une entree ici, sans la supprimer.
APPROVED_KEY = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
VALUE_NAME = "Audora"
STARTUP_FLAG = "--startup"  # Audora demarre alors reduit dans la barre des taches


def _startup_command():
    exe, base_args = config.launcher()
    return f'"{exe}" {base_args}{STARTUP_FLAG}'


def is_autostart_enabled():
    if sys.platform != "win32":
        return False
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            winreg.QueryValueEx(key, VALUE_NAME)
    except OSError:
        return False
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, APPROVED_KEY) as key:
            state, _ = winreg.QueryValueEx(key, VALUE_NAME)
            if state and state[0] & 1:  # 03 = desactive dans le Gestionnaire des taches
                return False
    except OSError:
        pass
    return True


def set_autostart(enabled):
    import winreg

    if enabled:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            winreg.SetValueEx(key, VALUE_NAME, 0, winreg.REG_SZ, _startup_command())
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, APPROVED_KEY) as key:
            winreg.SetValueEx(key, VALUE_NAME, 0, winreg.REG_BINARY, b"\x02" + b"\x00" * 11)
    else:
        for path in (RUN_KEY, APPROVED_KEY):
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path, 0, winreg.KEY_SET_VALUE) as key:
                    winreg.DeleteValue(key, VALUE_NAME)
            except OSError:
                pass
    return is_autostart_enabled()


def refresh_autostart_command():
    """Si le demarrage auto est actif, pointe vers l'Audora en cours (le .exe a pu etre deplace)."""
    if is_autostart_enabled():
        set_autostart(True)


def desktop_folder():
    from win32com.shell import shell, shellcon

    return shell.SHGetFolderPath(0, shellcon.CSIDL_DESKTOPDIRECTORY, None, 0)  # suit OneDrive si redirige


START_MENU = os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs")


def _shortcut_target(path):
    """Programme vise par un raccourci .lnk (None s'il est illisible)."""
    try:
        import pythoncom
        from win32com.shell import shell
        link = pythoncom.CoCreateInstance(shell.CLSID_ShellLink, None, pythoncom.CLSCTX_INPROC_SERVER, shell.IID_IShellLink)
        link.QueryInterface(pythoncom.IID_IPersistFile).Load(path)
        return link.GetPath(0)[0]
    except Exception:
        return None


def ensure_start_menu_shortcut(app_id):
    """Raccourci du menu Demarrer vers l'Audora en cours, avec son identifiant.

    Windows prend l'icone du bouton de la barre des taches dans le raccourci qui porte
    l'identifiant d'Audora : sans lui, ou s'il vise un Audora supprime (ancienne
    installation), le bouton affiche une page blanche au lieu du vinyle.
    """
    if not config.IS_FROZEN or sys.platform != "win32":
        return None
    target = os.path.normcase(os.path.abspath(sys.executable))
    for existing in (os.path.join(START_MENU, "Audora", "Audora.lnk"), os.path.join(START_MENU, "Audora.lnk")):
        aim = _shortcut_target(existing) if os.path.exists(existing) else None
        if aim and os.path.normcase(os.path.abspath(aim)) == target:
            return existing  # deja bon (installateur, ou lancement precedent)
    path = create_desktop_shortcut(app_id=app_id, path=os.path.join(START_MENU, "Audora.lnk"))
    try:
        ctypes.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)  # SHCNE_ASSOCCHANGED : icones rafraichies
    except Exception:
        pass
    return path


def create_desktop_shortcut(target=None, arguments="", app_id=None, path=None):
    """Cree (ou remplace) "Audora.lnk" sur le Bureau (ou a `path`). Par defaut : l'Audora en cours."""
    import pythoncom
    from win32com.propsys import propsys, pscon
    from win32com.shell import shell

    if target is None:
        target, arguments = config.launcher()
        arguments = arguments.strip()
    working_dir = os.path.dirname(target) if config.IS_FROZEN or target.lower().endswith("audora.exe") else config.APP_DIR
    # Le .exe contient deja l'icone ; en lancement depuis les sources, on prend icon.ico.
    icon = target if target.lower().endswith("audora.exe") else config.ICON_PATH

    link = pythoncom.CoCreateInstance(shell.CLSID_ShellLink, None, pythoncom.CLSCTX_INPROC_SERVER, shell.IID_IShellLink)
    link.SetPath(target)
    link.SetArguments(arguments)
    link.SetWorkingDirectory(working_dir)
    link.SetIconLocation(icon, 0)
    link.SetDescription("Audora - ta musique, tes téléchargements YouTube")
    if app_id:
        # Meme identifiant que la fenetre : l'icone epinglee et la liste du clic droit vont ensemble.
        store = link.QueryInterface(propsys.IID_IPropertyStore)
        store.SetValue(pscon.PKEY_AppUserModel_ID, propsys.PROPVARIANTType(app_id))
        store.Commit()
    path = path or os.path.join(desktop_folder(), "Audora.lnk")
    link.QueryInterface(pythoncom.IID_IPersistFile).Save(path, 0)
    return path
