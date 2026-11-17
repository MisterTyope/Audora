"""Journal des erreurs (%LOCALAPPDATA%\\Audora\\journal.log) et sauvegarde quotidienne de la bibliotheque.

Journal : toutes les erreurs qui etaient ignorees en silence y laissent une trace (3 fichiers
de 1 Mo au plus), pour comprendre un souci apres coup. Rien n'est envoye nulle part.

Sauvegarde : une copie de la base (titres, playlists, ecoutes, genres) et des reglages par
jour, dans %LOCALAPPDATA%\\Audora\\sauvegardes ; les 7 plus recentes sont gardees.
"""

import glob
import logging
import logging.handlers
import os
import shutil
import sqlite3
import sys
import threading
import time

from . import config

LOG_PATH = os.path.join(config.DATA_DIR, "journal.log")
BACKUP_DIR = os.path.join(config.DATA_DIR, "sauvegardes")
KEEP_BACKUPS = 7

log = logging.getLogger("audora")


def setup():
    os.makedirs(config.DATA_DIR, exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(LOG_PATH, maxBytes=1_000_000, backupCount=2, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S"))
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    log.propagate = False

    # Une erreur imprevue dans une tache de fond (synchro, mesure du volume...) arretait ce fil
    # sans rien dire : on la note.
    def thread_hook(args):
        if args.exc_type is not SystemExit:
            log.error("Erreur dans la tache %s", getattr(args.thread, "name", "?"),
                      exc_info=(args.exc_type, args.exc_value, args.exc_traceback))
    threading.excepthook = thread_hook

    def main_hook(exc_type, exc_value, exc_traceback):
        log.critical("Erreur fatale", exc_info=(exc_type, exc_value, exc_traceback))
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
    sys.excepthook = main_hook
    log.info("Audora demarre (%s) | ffmpeg : %s | node : %s", "exe" if config.IS_FROZEN else "sources",
             config.FFMPEG or "absent", config.NODE or "absent")


def backup_library(db_path=None, force=False):
    """Copie du jour de la base et des reglages (rien si deja faite aujourd'hui). Chemin, ou None."""
    db_path = db_path or config.DB_PATH
    if not os.path.exists(db_path):
        return None
    os.makedirs(BACKUP_DIR, exist_ok=True)
    day = time.strftime("%Y-%m-%d")
    dest = os.path.join(BACKUP_DIR, f"bibliotheque-{day}.db")
    if os.path.exists(dest) and not force:
        return None
    tmp = dest + ".tmp"
    source = sqlite3.connect(db_path)
    try:
        target = sqlite3.connect(tmp)
        with target:
            source.backup(target)  # copie coherente meme pendant qu'Audora ecrit dans la base
        target.close()
    finally:
        source.close()
    os.replace(tmp, dest)
    if os.path.exists(config.CONFIG_PATH):
        shutil.copy2(config.CONFIG_PATH, os.path.join(BACKUP_DIR, f"reglages-{day}.json"))
    for pattern in ("bibliotheque-*.db", "reglages-*.json"):
        for old in sorted(glob.glob(os.path.join(BACKUP_DIR, pattern)))[:-KEEP_BACKUPS]:
            try:
                os.remove(old)
            except OSError:
                pass
    log.info("Bibliotheque sauvegardee : %s", dest)
    return dest


def backups():
    """Sauvegardes disponibles, de la plus recente a la plus ancienne."""
    return [{"file": os.path.basename(p), "date": os.path.getmtime(p), "size": os.path.getsize(p)}
            for p in sorted(glob.glob(os.path.join(BACKUP_DIR, "bibliotheque-*.db")), reverse=True)]


def start_daily_backups(db_path=None):
    """Sauvegarde au lancement puis toutes les 6 heures (une seule par jour)."""
    def loop():
        while True:
            try:
                backup_library(db_path)
            except Exception:
                log.exception("Sauvegarde de la bibliotheque impossible")
            time.sleep(6 * 3600)
    threading.Thread(target=loop, daemon=True, name="sauvegarde").start()
