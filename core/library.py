"""Bibliotheque musicale : base SQLite des titres, pochettes et playlists."""

import ctypes
import hashlib
import os
import re
import sqlite3
import sys
import threading
import time
import unicodedata

from . import config
from .covers import make_cover
from .loudness import gain_db
from .tags import embed_cover, read_tags, write_tags
from .titles import UNKNOWN_ARTIST, _key, clean_title, names_from_tags, primary_artist_and_title, split_artist_title, split_artists

AUDIO_EXT = {".mp3", ".m4a", ".aac", ".opus", ".ogg", ".flac", ".wav"}
VIDEO_EXT = {".mp4", ".mkv", ".webm", ".mov"}
INCOMING_DIR_NAME = "_incoming"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    title TEXT,
    artist TEXT,
    album TEXT,
    duration REAL,
    kind TEXT,
    cover TEXT,
    source_id TEXT,
    source_url TEXT,
    added_at REAL,
    play_count INTEGER DEFAULT 0,
    last_played REAL
);
CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at REAL
);
CREATE TABLE IF NOT EXISTS artist_genres (
    artist TEXT PRIMARY KEY,
    genre TEXT,
    checked_at REAL
);
CREATE TABLE IF NOT EXISTS phone_items (
    kind TEXT NOT NULL,
    ref_id INTEGER NOT NULL,
    added_at REAL,
    PRIMARY KEY (kind, ref_id)
);
CREATE TABLE IF NOT EXISTS playlist_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL,
    track_id INTEGER NOT NULL,
    position REAL NOT NULL
);
"""

_COVER_EXT = {"image/png": ".png", "image/webp": ".webp"}


def _move_to_recycle_bin(path):
    """Met un fichier a la corbeille Windows (recuperable), plutot que de le supprimer."""
    if sys.platform != "win32":
        os.remove(path)
        return
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND), ("wFunc", wintypes.UINT),
            ("pFrom", wintypes.LPCWSTR), ("pTo", wintypes.LPCWSTR),
            ("fFlags", ctypes.c_uint16), ("fAnyOperationsAborted", wintypes.BOOL),
            ("hNameMappings", ctypes.c_void_p), ("lpszProgressTitle", wintypes.LPCWSTR),
        ]

    fo_delete = 3
    flags = 0x0040 | 0x0010 | 0x0004 | 0x0400  # ALLOWUNDO | NOCONFIRMATION | SILENT | NOERRORUI
    op = SHFILEOPSTRUCTW(None, fo_delete, os.path.abspath(path) + "\0", None, flags, False, None, None)
    result = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
    if result != 0 or os.path.exists(path):
        raise OSError("Le fichier n'a pas pu être mis à la corbeille (il est peut-être en cours d'utilisation).")


_audio_key_cache = {}


def _audio_key(path, stat):
    """Empreinte de la partie audio d'un fichier, qui ne change pas quand on modifie seulement
    ses tags (titre, artiste, pochette) : le telephone ne retelecharge alors pas le fichier."""
    cached = _audio_key_cache.get(path)
    if cached and cached[0] == stat.st_mtime:
        return cached[1]
    size = stat.st_size
    try:
        with open(path, "rb") as f:
            head = f.read(10)
            if head[:3] == b"ID3" and len(head) == 10:  # tag ID3v2 au debut : taille codee sur 4 octets de 7 bits
                tag = ((head[6] & 0x7F) << 21) | ((head[7] & 0x7F) << 14) | ((head[8] & 0x7F) << 7) | (head[9] & 0x7F)
                size -= tag + 10 + (10 if head[5] & 0x10 else 0)
            f.seek(-128, os.SEEK_END)
            if f.read(3) == b"TAG":  # tag ID3v1 a la fin
                size -= 128
    except OSError:
        pass
    key = f"a{size}"
    _audio_key_cache[path] = (stat.st_mtime, key)
    return key


class Library:
    def __init__(self, db_path=config.DB_PATH):
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        os.makedirs(config.COVERS_DIR, exist_ok=True)
        self._lock = threading.RLock()
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(_SCHEMA)
        # Ancienne base : colonne du genre choisi a la main pour un titre.
        columns = {r[1] for r in self._db.execute("PRAGMA table_info(tracks)")}
        if "genre_override" not in columns:
            self._db.execute("ALTER TABLE tracks ADD COLUMN genre_override TEXT")
            self._db.commit()
        # Nettoyage de l'audio : NULL = pas encore analyse, "clean" = rien a couper, "trimmed" = coupe.
        if "trim_state" not in columns:
            self._db.execute("ALTER TABLE tracks ADD COLUMN trim_state TEXT")
            self._db.commit()
        # Pochette cherchee sur internet (trouvee ou non) : on ne la recherche pas a chaque lancement.
        if "cover_checked" not in columns:
            self._db.execute("ALTER TABLE tracks ADD COLUMN cover_checked REAL")
            self._db.commit()
        # Volume egalise : volume mesure (LUFS) et pic (dBFS) de chaque titre, voir loudness.py.
        if "loudness" not in columns:
            self._db.execute("ALTER TABLE tracks ADD COLUMN loudness REAL")
            self._db.execute("ALTER TABLE tracks ADD COLUMN sample_peak REAL")
            self._db.commit()

    # --- Acces base ---

    def _all(self, sql, args=()):
        with self._lock:
            return [dict(r) for r in self._db.execute(sql, args).fetchall()]

    def _one(self, sql, args=()):
        with self._lock:
            row = self._db.execute(sql, args).fetchone()
            return dict(row) if row else None

    def _exec(self, sql, args=()):
        with self._lock:
            cur = self._db.execute(sql, args)
            self._db.commit()
            return cur

    # --- Titres ---

    def scan(self, root):
        """Ajoute les fichiers audio/video du dossier, retire ceux qui n'existent plus."""
        known = {r["path"]: r["id"] for r in self._all("SELECT id, path FROM tracks")}
        added = 0
        if root and os.path.isdir(root):
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = [d for d in dirnames if d != INCOMING_DIR_NAME and not d.startswith(".")]
                for filename in filenames:
                    if os.path.splitext(filename)[1].lower() not in AUDIO_EXT | VIDEO_EXT:
                        continue
                    path = os.path.normpath(os.path.join(dirpath, filename))
                    if path not in known:
                        try:
                            self.import_file(path)
                            added += 1
                        except Exception:
                            pass

        removed = 0
        for path, track_id in known.items():
            if not os.path.exists(path):
                self._delete_row(track_id)
                removed += 1
        return {"added": added, "removed": removed}

    def import_file(self, path, meta=None, cover=None):
        """Ajoute (ou met a jour) un fichier. `meta` prime sur les tags, `cover` = (bytes, mime)."""
        path = os.path.normpath(os.path.abspath(path))
        meta = meta or {}
        tags = read_tags(path)
        ext = os.path.splitext(path)[1].lower()
        kind = "video" if ext in VIDEO_EXT else "audio"

        title = meta.get("title")
        artist = meta.get("artist")
        if not title and tags.get("title"):
            artist, title = names_from_tags(tags.get("title"), artist or tags.get("artist"), self.known_artist_keys())
            artist, title = primary_artist_and_title(artist, title)
        if not title:
            guessed_artist, title = split_artist_title(os.path.splitext(os.path.basename(path))[0])
            if not artist and guessed_artist != UNKNOWN_ARTIST:
                artist = guessed_artist
        if not artist and kind == "audio":
            # Fichiers ranges en "<Artiste>/<Titre>.mp3" : le dossier donne l'artiste.
            parent = os.path.basename(os.path.dirname(path))
            artist = parent if parent and parent.lower() not in ("youtube", "music", "musique") else None

        cover_path = self._save_cover(path, cover or tags.get("cover"), square=kind == "audio")
        duration = tags.get("duration") or meta.get("duration")

        self._exec(
            """
            INSERT INTO tracks (path, title, artist, album, duration, kind, cover, source_id, source_url, added_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                title = excluded.title, artist = excluded.artist, album = excluded.album,
                duration = excluded.duration, kind = excluded.kind,
                cover = COALESCE(excluded.cover, tracks.cover),
                source_id = COALESCE(excluded.source_id, tracks.source_id),
                source_url = COALESCE(excluded.source_url, tracks.source_url)
            """,
            (
                path, title, artist or UNKNOWN_ARTIST, meta.get("album") or tags.get("album") or "",
                duration, kind, cover_path, meta.get("source_id"), meta.get("source_url"),
                time.time(),
            ),
        )
        return self._one("SELECT id FROM tracks WHERE path = ?", (path,))["id"]

    def relocate_track(self, old_path, new_path, title, artist):
        """Fichier deplace/renomme : on garde la meme ligne (ecoutes, playlists, pochette)."""
        old_path, new_path = os.path.normpath(old_path), os.path.normpath(os.path.abspath(new_path))
        row = self._one("SELECT id FROM tracks WHERE lower(path) = lower(?)", (old_path,))
        if row:
            self._exec("UPDATE tracks SET path = ?, title = ?, artist = ? WHERE id = ?",
                       (new_path, title, artist, row["id"]))
        else:
            self.import_file(new_path)

    # --- Genres (trouves par artiste, voir core/genres.py) ---

    def artists_without_genre(self, retry_after_days=30):
        """(artiste, un de ses titres) pour les artistes jamais cherches, ou introuvables depuis longtemps."""
        limit = time.time() - retry_after_days * 86400
        return [(r["artist"], r["title"]) for r in self._all(
            """
            SELECT t.artist, MIN(t.title) AS title FROM tracks t
            LEFT JOIN artist_genres g ON g.artist = t.artist
            WHERE t.kind = 'audio' AND t.artist != ? AND (g.artist IS NULL OR (g.genre = '' AND g.checked_at < ?))
            GROUP BY t.artist
            """, (UNKNOWN_ARTIST, limit))]

    def set_track_genre(self, track_id, genre, whole_artist=False):
        """Genre choisi a la main. Pour tout l'artiste : remplace le genre trouve automatiquement
        (et n'est plus jamais recherche) ; les choix faits titre par titre pour cet artiste sont oublies."""
        genre = (genre or "").strip()[:40]
        row = self._one("SELECT artist FROM tracks WHERE id = ?", (track_id,))
        if not row:
            raise ValueError("Ce titre n'existe plus.")
        if whole_artist:
            self.set_artist_genre(row["artist"], genre)
            self._exec("UPDATE tracks SET genre_override = NULL WHERE artist = ?", (row["artist"],))
        else:
            self._exec("UPDATE tracks SET genre_override = ? WHERE id = ?", (genre or None, track_id))

    def set_artist_genre(self, artist, genre):
        self._exec("INSERT OR REPLACE INTO artist_genres (artist, genre, checked_at) VALUES (?, ?, ?)",
                   (artist, genre or "", time.time()))

    def known_artist_keys(self):
        """Artistes deja presents (forme de comparaison), pour reperer les titres YouTube a l'envers."""
        return {_key(r["artist"]) for r in self._all("SELECT DISTINCT artist FROM tracks WHERE kind = 'audio'")
                if r["artist"] and r["artist"] != UNKNOWN_ARTIST}

    def canonical_artist(self, artist):
        """Reprend l'orthographe deja utilisee ("System of a Down" -> "System Of A Down") pour ne pas
        creer deux artistes (et deux dossiers) qui ne different que par les majuscules."""
        rows = self._all(
            "SELECT artist, COUNT(*) AS n FROM tracks WHERE kind = 'audio' GROUP BY artist ORDER BY n DESC")
        for row in rows:
            if row["artist"] and _key(row["artist"]) == _key(artist):
                return row["artist"]
        return artist

    def _save_cover(self, track_path, cover, square=True):
        if not cover:
            return None
        data, mime = cover
        try:
            data, mime = make_cover(data, square=square), "image/jpeg"
        except Exception:
            pass  # image illisible par Pillow : on la garde telle quelle
        name = hashlib.sha1(track_path.lower().encode("utf-8")).hexdigest()[:20] + _COVER_EXT.get(mime, ".jpg")
        cover_path = os.path.join(config.COVERS_DIR, name)
        try:
            with open(cover_path, "wb") as f:
                f.write(data)
        except OSError:
            return None
        return cover_path

    def list_tracks(self):
        rows = self._all(
            "SELECT t.id, t.title, t.artist, t.album, t.duration, t.kind, t.cover, t.source_id, t.added_at, "
            "t.play_count, t.last_played, COALESCE(NULLIF(t.genre_override, ''), NULLIF(g.genre, '')) AS genre, "
            "t.loudness, t.sample_peak "
            "FROM tracks t LEFT JOIN artist_genres g ON g.artist = t.artist ORDER BY t.added_at DESC"
        )
        for row in rows:
            cover = row.pop("cover")
            row["cover"] = bool(cover and os.path.exists(cover))
            row["gain"] = gain_db(row.pop("loudness"), row.pop("sample_peak"))
        return rows

    def frequent_tracks(self, limit=8):
        """Titres les plus ecoutes (meme ordre que la section "Tes plus ecoutes" de l'interface)."""
        return self._all(
            "SELECT id, title, artist, cover FROM tracks WHERE play_count > 0 AND kind = 'audio' "
            "ORDER BY play_count DESC, last_played DESC LIMIT ?", (limit,))

    # --- Nettoyage de l'audio (blancs, passages parles) ---

    def tracks_to_trim(self):
        """MP3 pas encore analyses (ou dont l'analyse a trouve des choses a couper, non appliquees)."""
        return self._all(
            "SELECT id, title, artist, path, source_id, duration FROM tracks "
            "WHERE kind = 'audio' AND lower(path) LIKE '%.mp3' AND trim_state IS NULL ORDER BY artist, title")

    def set_trim_state(self, track_id, state, duration=None):
        if duration:
            # Fichier recoupe : son volume sera remesure.
            self._exec("UPDATE tracks SET trim_state = ?, duration = ?, loudness = NULL WHERE id = ?",
                       (state, duration, track_id))
        else:
            self._exec("UPDATE tracks SET trim_state = ? WHERE id = ?", (state, track_id))

    # --- Volume egalise ---

    def tracks_without_loudness(self):
        return self._all("SELECT id, path FROM tracks WHERE kind = 'audio' AND loudness IS NULL ORDER BY added_at DESC")

    def set_loudness(self, track_id, lufs, peak):
        self._exec("UPDATE tracks SET loudness = ?, sample_peak = ? WHERE id = ?", (lufs, peak, track_id))

    # --- Pochettes manquantes ---

    def tracks_without_cover(self):
        """Titres audio sans pochette, jamais cherches, dont on connait l'artiste."""
        return self._all(
            "SELECT id, title, artist, path FROM tracks WHERE kind = 'audio' AND (cover IS NULL OR cover = '') "
            "AND cover_checked IS NULL AND artist != ? ORDER BY added_at DESC", (UNKNOWN_ARTIST,))

    def set_found_cover(self, track_id, data):
        """Enregistre une pochette trouvee (aussi dans le fichier), ou note qu'il n'y en a pas."""
        path = self.get_track_path(track_id)
        cover_path = self._save_cover(path, (data, "image/jpeg")) if data and path else None
        if cover_path:
            try:
                with open(cover_path, "rb") as f:
                    embed_cover(path, f.read())
            except Exception:
                pass  # fichier en lecture ou protege : la pochette reste au moins dans l'appli
        self._exec("UPDATE tracks SET cover = COALESCE(?, cover), cover_checked = ? WHERE id = ?",
                   (cover_path, time.time(), track_id))

    def get_track_path(self, track_id):
        row = self._one("SELECT path FROM tracks WHERE id = ?", (track_id,))
        return row["path"] if row else None

    def get_cover_path(self, track_id):
        row = self._one("SELECT cover FROM tracks WHERE id = ?", (track_id,))
        return row["cover"] if row else None

    def update_track(self, track_id, title, artist, album):
        path = self.get_track_path(track_id)
        if not path:
            raise ValueError("Ce titre n'existe plus dans la bibliothèque.")
        title = (title or "").strip() or "Sans titre"
        artist = (artist or "").strip() or UNKNOWN_ARTIST
        album = (album or "").strip()
        warning = None
        try:
            write_tags(path, title, artist, album)
        except Exception as exc:
            warning = f"Infos enregistrées dans l'appli, mais pas dans le fichier : {exc}"
        self._exec("UPDATE tracks SET title = ?, artist = ?, album = ? WHERE id = ?", (title, artist, album, track_id))
        return {"ok": True, "warning": warning}

    def delete_track(self, track_id, library_root=None):
        """Supprime le .mp3 du dossier (corbeille de Windows), sa pochette, et le retire partout
        (bibliotheque, playlists, telephone). Le dossier de l'artiste disparait s'il devient vide."""
        row = self._one("SELECT path, cover FROM tracks WHERE id = ?", (track_id,))
        if not row:
            return
        if os.path.exists(row["path"]):
            _move_to_recycle_bin(row["path"])
        self._delete_row(track_id)
        self._remove_empty_folder(os.path.dirname(row["path"]), library_root)

    @staticmethod
    def _remove_empty_folder(folder, library_root):
        """Retire le dossier (ex. "Queen") s'il est vide, sans jamais toucher au dossier de la bibliotheque."""
        if not library_root or not folder:
            return
        root = os.path.normcase(os.path.abspath(library_root))
        folder = os.path.abspath(folder)
        if os.path.normcase(folder) == root or not os.path.normcase(folder).startswith(root + os.sep):
            return
        try:
            if os.path.isdir(folder) and not os.listdir(folder):
                os.rmdir(folder)
        except OSError:
            pass

    def find_duplicates(self, library_root=None):
        """Groupes de titres qui sont la meme chanson (meme artiste principal + meme titre, ou meme video YouTube).

        Dans chaque groupe, "keep" est l'exemplaire conseille : le plus ecoute, sinon celui qui est
        range dans le dossier de l'artiste, qui a une pochette et vient de YouTube, sinon le plus recent."""
        def ukey(text):
            text = "".join(c for c in unicodedata.normalize("NFKD", text or "") if not unicodedata.combining(c))
            return re.sub(r"[\W_]+", "", text.casefold())

        def song_key(t):
            title = re.sub(r"\((?:feat|ft)\.?[^)]*\)|\s(?:feat|ft)\.?\s.*$", "", clean_title(t["title"] or ""), flags=re.I)
            return ukey(split_artists(t["artist"])[0] or t["artist"]) + "|" + ukey(title)

        tracks = [t for t in self.list_tracks() if t["kind"] == "audio"]
        paths = {r["id"]: r["path"] for r in self._all("SELECT id, path FROM tracks")}
        groups, by_source = {}, {}
        for t in tracks:
            key = song_key(t)
            if t.get("source_id"):
                key = by_source.setdefault(t["source_id"], key)  # meme video = meme chanson
            groups.setdefault(key, []).append(t)

        result = []
        for items in groups.values():
            if len(items) < 2:
                continue
            for t in items:
                path = paths.get(t["id"]) or ""
                t["file"] = os.path.basename(path)
                t["folder"] = os.path.basename(os.path.dirname(path))
                t["size"] = os.path.getsize(path) if os.path.exists(path) else 0
            root_name = os.path.basename(os.path.normpath(library_root)) if library_root else None
            keep = max(items, key=lambda t: (t["play_count"] or 0, t["folder"] != root_name,
                                             bool(t["cover"]), bool(t.get("source_id")), t["added_at"] or 0))
            result.append({"tracks": items, "keep": keep["id"]})
        result.sort(key=lambda g: (g["tracks"][0]["artist"].casefold(), g["tracks"][0]["title"].casefold()))
        return result

    def _delete_row(self, track_id):
        row = self._one("SELECT cover FROM tracks WHERE id = ?", (track_id,))
        if row and row["cover"] and os.path.exists(row["cover"]):
            try:
                os.remove(row["cover"])
            except OSError:
                pass
        self._exec("DELETE FROM playlist_tracks WHERE track_id = ?", (track_id,))
        self._exec("DELETE FROM phone_items WHERE kind = 'track' AND ref_id = ?", (track_id,))
        self._exec("DELETE FROM tracks WHERE id = ?", (track_id,))

    def record_play(self, track_id):
        self._exec(
            "UPDATE tracks SET play_count = play_count + 1, last_played = ? WHERE id = ?",
            (time.time(), track_id),
        )

    def add_plays(self, track_id, count):
        """Ecoutes faites sur le telephone, renvoyees lors de la synchro."""
        self._exec("UPDATE tracks SET play_count = play_count + ?, last_played = ? WHERE id = ?",
                   (count, time.time(), track_id))

    # --- Telephone ---

    def phone_add(self, kind, ids):
        with self._lock:
            for ref_id in ids:
                self._db.execute("INSERT OR IGNORE INTO phone_items (kind, ref_id, added_at) VALUES (?, ?, ?)",
                                 (kind, int(ref_id), time.time()))
            self._db.commit()

    def phone_remove(self, kind, ids):
        with self._lock:
            for ref_id in ids:
                self._db.execute("DELETE FROM phone_items WHERE kind = ? AND ref_id = ?", (kind, int(ref_id)))
            self._db.commit()

    def phone_items(self):
        """{"tracks": titres envoyes un par un, "playlists": playlists envoyees, "all": tous les titres du telephone}."""
        rows = self._all("SELECT kind, ref_id FROM phone_items")
        return {
            "tracks": [r["ref_id"] for r in rows if r["kind"] == "track"],
            "playlists": [r["ref_id"] for r in rows if r["kind"] == "playlist"],
            "all": sorted(self.phone_track_ids()),
        }

    def phone_track_ids(self):
        rows = self._all(
            """
            SELECT t.id FROM tracks t
            WHERE t.kind = 'audio' AND (
                t.id IN (SELECT ref_id FROM phone_items WHERE kind = 'track')
                OR t.id IN (SELECT pt.track_id FROM playlist_tracks pt
                            JOIN phone_items pi ON pi.kind = 'playlist' AND pi.ref_id = pt.playlist_id)
            )
            """)
        return {r["id"] for r in rows}

    def phone_manifest(self):
        """Ce que le telephone doit avoir : titres (avec taille/date pour reperer les changements) et playlists."""
        ids = self.phone_track_ids()
        direct = {r["ref_id"] for r in self._all("SELECT ref_id FROM phone_items WHERE kind = 'track'")}
        tracks = []
        genres = {r["artist"]: r["genre"] for r in self._all("SELECT artist, genre FROM artist_genres WHERE genre != ''")}
        for row in self._all("SELECT id, path, title, artist, album, duration, cover, added_at, source_id, genre_override, "
                             "loudness, sample_peak FROM tracks"):
            if row["id"] not in ids or not os.path.exists(row["path"]):
                continue
            stat = os.stat(row["path"])
            cover_mtime = int(os.path.getmtime(row["cover"])) if row["cover"] and os.path.exists(row["cover"]) else 0
            tracks.append({
                "id": row["id"], "title": row["title"], "artist": row["artist"], "album": row["album"] or "",
                "duration": row["duration"], "size": stat.st_size, "mtime": int(stat.st_mtime),
                "ext": os.path.splitext(row["path"])[1].lower() or ".mp3",
                "cover": bool(row["cover"] and os.path.exists(row["cover"])),
                "added_at": row["added_at"], "direct": row["id"] in direct, "source_id": row["source_id"],
                "genre": row["genre_override"] or genres.get(row["artist"]), "audio_key": _audio_key(row["path"], stat), "cover_mtime": cover_mtime,
                "gain": gain_db(row["loudness"], row["sample_peak"]),
            })
        phone_playlists = {r["ref_id"] for r in self._all("SELECT ref_id FROM phone_items WHERE kind = 'playlist'")}
        playlists = [
            {"id": p["id"], "name": p["name"], "track_ids": [t for t in p["track_ids"] if t in ids]}
            for p in self.list_playlists() if p["id"] in phone_playlists
        ]
        return {"tracks": tracks, "playlists": playlists}

    # --- Playlists ---

    def list_playlists(self):
        playlists = self._all("SELECT id, name, created_at FROM playlists ORDER BY created_at DESC")
        links = self._all("SELECT playlist_id, track_id FROM playlist_tracks ORDER BY position, id")
        by_playlist = {}
        for link in links:
            by_playlist.setdefault(link["playlist_id"], []).append(link["track_id"])
        for playlist in playlists:
            playlist["track_ids"] = by_playlist.get(playlist["id"], [])
        return playlists

    def create_playlist(self, name, track_ids=None):
        name = (name or "").strip() or "Nouvelle playlist"
        cur = self._exec("INSERT INTO playlists (name, created_at) VALUES (?, ?)", (name, time.time()))
        playlist_id = cur.lastrowid
        if track_ids:
            self.add_to_playlist(playlist_id, track_ids)
        return playlist_id

    def rename_playlist(self, playlist_id, name):
        name = (name or "").strip()
        if name:
            self._exec("UPDATE playlists SET name = ? WHERE id = ?", (name, playlist_id))

    def delete_playlist(self, playlist_id):
        self._exec("DELETE FROM phone_items WHERE kind = 'playlist' AND ref_id = ?", (playlist_id,))
        self._exec("DELETE FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))
        self._exec("DELETE FROM playlists WHERE id = ?", (playlist_id,))

    def add_to_playlist(self, playlist_id, track_ids):
        row = self._one("SELECT COALESCE(MAX(position), 0) AS p FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))
        position = row["p"]
        with self._lock:
            for track_id in track_ids:
                position += 1
                self._db.execute(
                    "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)",
                    (playlist_id, int(track_id), position),
                )
            self._db.commit()

    def set_playlist_tracks(self, playlist_id, track_ids):
        known = {r["id"] for r in self._all("SELECT id FROM tracks")}
        with self._lock:
            self._db.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))
            for position, track_id in enumerate(t for t in track_ids if int(t) in known):
                self._db.execute("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)",
                                 (playlist_id, int(track_id), position + 1))
            self._db.commit()

    def remove_from_playlist(self, playlist_id, index):
        links = self._all(
            "SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position, id", (playlist_id,)
        )
        if 0 <= index < len(links):
            self._exec("DELETE FROM playlist_tracks WHERE id = ?", (links[index]["id"],))
