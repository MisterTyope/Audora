"""Remise en ordre de la bibliotheque : "Artiste/Titre.mp3", tags corriges, base mise a jour.

Deux etapes : `plan_reorganization` calcule tout sans rien toucher, `apply_reorganization`
applique le plan et ecrit un journal (pour pouvoir annuler).
"""

import collections
import json
import os
import time

from mutagen import File as MutagenFile

from . import config
from .library import AUDIO_EXT, INCOMING_DIR_NAME
from .tags import write_tags
from .titles import UNKNOWN_ARTIST, _key, names_from_tags, primary_artist_and_title, safe_filename, split_artist_title


def _read_names(path):
    try:
        m = MutagenFile(path, easy=True)
        tags = m.tags if m is not None and m.tags is not None else {}
    except Exception:
        tags = {}

    def first(key):
        try:
            values = tags.get(key)
        except Exception:
            values = None
        return str(values[0]).strip() if values else ""

    return first("title"), first("artist"), first("album")


def _audio_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != INCOMING_DIR_NAME and not d.startswith(".")]
        for filename in filenames:
            if os.path.splitext(filename)[1].lower() in AUDIO_EXT:
                yield os.path.normpath(os.path.join(dirpath, filename))


def _resolve(path, tag_title, tag_artist, known):
    if tag_title:
        artist, title = names_from_tags(tag_title, tag_artist, known)
    else:
        artist, title = split_artist_title(os.path.splitext(os.path.basename(path))[0], known_artists=known)
    return primary_artist_and_title(artist, title)


def plan_reorganization(root):
    entries = []
    for path in _audio_files(root):
        tag_title, tag_artist, album = _read_names(path)
        entries.append({"old": path, "old_title": tag_title, "old_artist": tag_artist, "album": album})

    # 1er passage sans a priori : les artistes qui reviennent au moins 2 fois sont "connus",
    # ce qui permet ensuite de reperer les titres inverses ("Basket Case" / "Green Day").
    counts = collections.Counter(
        _key(_resolve(e["old"], e["old_title"], e["old_artist"], set())[0]) for e in entries)
    known = {k for k, n in counts.items() if n >= 2}

    for e in entries:
        e["artist"], e["title"] = _resolve(e["old"], e["old_title"], e["old_artist"], known)

    # Une seule orthographe par artiste (la plus frequente) : "System Of A Down" / "System of a Down".
    spellings = collections.defaultdict(collections.Counter)
    for e in entries:
        spellings[_key(e["artist"])][e["artist"]] += 1
    for e in entries:
        e["artist"] = spellings[_key(e["artist"])].most_common(1)[0][0]

    for e in entries:
        e["_folder"] = os.path.join(root, safe_filename(e["artist"], UNKNOWN_ARTIST))
        e["_name"] = safe_filename(e["title"])
        e["_ext"] = os.path.splitext(e["old"])[1].lower()

    # Les fichiers deja bien nommes (y compris "Titre (2).mp3") gardent leur nom ; les autres
    # prennent le premier nom libre. Evite d'echanger inutilement deux doublons.
    taken = set()
    pending = []
    for e in entries:
        old_dir, old_file = os.path.split(e["old"])
        stem, ext = os.path.splitext(old_file)
        same_name = stem == e["_name"] or (stem.startswith(e["_name"] + " (") and stem.endswith(")"))
        if os.path.normcase(old_dir) == os.path.normcase(e["_folder"]) and same_name and ext.lower() == e["_ext"]:
            e["new"] = os.path.join(e["_folder"], old_file)  # casse du dossier eventuellement corrigee
            taken.add(e["new"].lower())
        else:
            pending.append(e)
    for e in sorted(pending, key=lambda e: e["old"].lower()):
        folder, name, ext = e["_folder"], e["_name"], e["_ext"]
        candidate, n = os.path.join(folder, name + ext), 2
        while candidate.lower() in taken:
            candidate, n = os.path.join(folder, f"{name} ({n}){ext}"), n + 1
        taken.add(candidate.lower())
        e["new"] = candidate
    for e in entries:
        e["moved"] = e["new"] != e["old"]
        e["retag"] = (e["title"], e["artist"]) != (e["old_title"], e["old_artist"])
    return entries


def apply_reorganization(root, entries, library=None):
    """Applique le plan. Retourne le chemin du journal (anciens chemins et tags, pour annuler)."""
    log = {"date": time.strftime("%Y-%m-%d %H:%M:%S"), "root": root, "files": []}
    errors = []

    # 1) Tags, tant que les fichiers sont a leur place d'origine.
    for e in entries:
        if e["retag"]:
            try:
                write_tags(e["old"], e["title"], e["artist"], e["album"])
            except Exception as exc:
                errors.append(f"tags {e['old']}: {exc}")

    # 2) Deplacements en deux temps (nom temporaire puis nom final) : evite les collisions
    #    quand un fichier doit prendre la place d'un autre.
    moving = [e for e in entries if e["moved"]]
    for e in moving:
        e["tmp"] = e["old"] + ".audora-tmp"
        os.replace(e["old"], e["tmp"])
    for e in moving:
        os.makedirs(os.path.dirname(e["new"]), exist_ok=True)
        os.replace(e["tmp"], e["new"])

    # 3) Dossiers d'artiste dont seule la casse differe ("System of a Down" -> "System Of A Down").
    for e in moving:
        folder = os.path.dirname(e["new"])
        parent, wanted = os.path.split(folder)
        actual = next((d for d in os.listdir(parent) if d.lower() == wanted.lower()), wanted)
        if actual != wanted:
            os.replace(os.path.join(parent, actual), os.path.join(parent, actual + ".audora-tmp"))
            os.replace(os.path.join(parent, actual + ".audora-tmp"), folder)

    # 4) Dossiers devenus vides.
    for dirpath, dirnames, filenames in os.walk(root, topdown=False):
        if os.path.normcase(dirpath) != os.path.normcase(root) and not os.listdir(dirpath):
            os.rmdir(dirpath)

    # 5) Base d'Audora : memes titres (ecoutes, playlists conservees), nouveaux chemins et noms.
    if library is not None:
        for e in entries:
            library.relocate_track(e["old"], e["new"], e["title"], e["artist"])

    for e in entries:
        log["files"].append({k: e[k] for k in ("old", "new", "old_title", "old_artist", "title", "artist")})
    log["errors"] = errors
    os.makedirs(config.DATA_DIR, exist_ok=True)
    log_path = os.path.join(config.DATA_DIR, f"reorganisation-{time.strftime('%Y%m%d-%H%M%S')}.json")
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(log, f, ensure_ascii=False, indent=2)
    return log_path
