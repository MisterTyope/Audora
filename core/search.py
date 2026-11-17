"""Recherche YouTube et apercu d'un lien, sans telecharger."""

import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from yt_dlp import YoutubeDL

from . import genres
from .config import YTDLP_BASE_OPTS
from .titles import clean_title, primary_artist_and_title, split_artist_title

_BASE_OPTS = {**YTDLP_BASE_OPTS, "quiet": True, "no_warnings": True, "skip_download": True}


def _thumb_for(video_id):
    return f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"


def search(query, limit=24, known_artists=None):
    query = (query or "").strip()
    if not query:
        return []
    with YoutubeDL({**_BASE_OPTS, "extract_flat": True}) as ydl:
        info = ydl.extract_info(f"ytsearch{int(limit)}:{query}", download=False)

    results = []
    for entry in info.get("entries") or []:
        video_id = entry.get("id")
        if not video_id or entry.get("ie_key") not in (None, "Youtube"):
            continue
        channel = entry.get("channel") or entry.get("uploader")
        artist, title = primary_artist_and_title(*split_artist_title(entry.get("title") or "", uploader=channel, known_artists=known_artists))
        with _cache_lock:
            _names[video_id] = (artist, title)
        results.append({
            "id": video_id,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "title": title,
            "artist": artist,
            "raw_title": entry.get("title"),
            "duration": entry.get("duration"),
            "thumb": _thumb_for(video_id),
        })
    return results


def preview(url, as_playlist=False):
    if as_playlist or "/playlist" in url:
        match = re.search(r"[?&]list=([\w-]+)", url)
        playlist_url = f"https://www.youtube.com/playlist?list={match.group(1)}" if match else url
        with YoutubeDL({**_BASE_OPTS, "extract_flat": True}) as ydl:
            info = ydl.extract_info(playlist_url, download=False)
        entries = [e for e in (info.get("entries") or []) if e]
        thumb = None
        if entries and entries[0].get("id"):
            thumb = _thumb_for(entries[0]["id"])
        return {
            "kind": "playlist", "url": url,
            "title": info.get("title") or "Playlist",
            "artist": info.get("uploader") or info.get("channel") or "",
            "count": len(entries), "thumb": thumb,
        }

    with YoutubeDL({**_BASE_OPTS, "noplaylist": True}) as ydl:
        info = ydl.extract_info(url, download=False)
    artists = info.get("artists")
    artist, title = split_artist_title(
        info.get("title") or "",
        uploader=info.get("uploader") or info.get("channel"),
        artist=info.get("artist") or (", ".join(artists) if artists else None),
        track=info.get("track"),
    )
    return {
        "kind": "video", "url": url, "id": info.get("id"),
        "title": title, "artist": artist,
        "raw_title": clean_title(info.get("title")),
        "duration": info.get("duration"),
        "thumb": _thumb_for(info["id"]) if info.get("id") else info.get("thumbnail"),
        "has_list": "list=" in url,
    }


# --- Details (annee) et apercu ---

_details_cache = {}
_stream_cache = {}
_cache_lock = threading.Lock()
_names = {}        # video_id -> (artiste, titre), retenus lors de la recherche
_album_years = {}  # id d'album Deezer -> annee
STREAM_TTL = 3 * 3600  # les liens audio de YouTube expirent apres quelques heures


def _year(info):
    if info.get("release_year"):
        return int(info["release_year"])
    date = info.get("release_date") or info.get("upload_date") or ""
    return int(date[:4]) if len(date) >= 4 and date[:4].isdigit() else None


def _full_info(video_id):
    opts = {**_BASE_OPTS, "noplaylist": True, "format": "bestaudio[ext=m4a]/bestaudio/best"}
    with YoutubeDL(opts) as ydl:
        return ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)


def _remember(video_id, info):
    with _cache_lock:
        _details_cache[video_id] = {"year": _year(info)}
        if info.get("url"):
            _stream_cache[video_id] = (info["url"], time.time(), dict(info.get("http_headers") or {}))


def _deezer_year(artist, title):
    """Annee de sortie d'un titre, via Deezer : aucune requete vers YouTube.

    (Avant, on ouvrait chaque video YouTube pour lire sa date : une recherche = 24 requetes
    d'un coup, et YouTube finissait par bloquer les telechargements avec "not a bot".)
    """
    wanted_artist = genres._key(artist)
    wanted_title = genres._key(genres._simple_title(title))
    if not wanted_artist or not wanted_title:
        return None
    query = urllib.parse.quote(f"{artist} {genres._simple_title(title)}")
    found = genres._get(f"https://api.deezer.com/search?limit=8&q={query}").get("data") or []
    for track in found:
        name = genres._key(track.get("artist", {}).get("name"))
        got = genres._key(genres._simple_title(track.get("title") or ""))
        if not (name and (name == wanted_artist or name in wanted_artist or wanted_artist in name)):
            continue
        if not (got and (got == wanted_title or got in wanted_title or wanted_title in got)):
            continue
        album_id = track.get("album", {}).get("id")
        if album_id not in _album_years:
            date = genres._get(f"https://api.deezer.com/album/{album_id}").get("release_date") or ""
            _album_years[album_id] = int(date[:4]) if date[:4].isdigit() and date[:4] != "0000" else None
        return _album_years[album_id]
    return None


def details(video_ids):
    """{id: {"year": 2009}} pour des resultats de recherche (annees trouvees sur Deezer)."""
    ids = [v for v in dict.fromkeys(video_ids) if re.fullmatch(r"[\w-]{6,20}", str(v))][:30]
    missing = [v for v in ids if v not in _details_cache]

    def fetch(video_id):
        year = None
        names = _names.get(video_id)
        if names:
            try:
                year = _deezer_year(*names)
            except Exception:
                pass
        with _cache_lock:
            _details_cache[video_id] = {"year": year}

    if missing:
        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(fetch, missing))
    return {v: _details_cache.get(v, {"year": None}) for v in ids}


def _link_works(url, headers):
    """YouTube accepte-t-il vraiment ce lien ? (il refuse parfois, voir stream_source)"""
    request = urllib.request.Request(url, headers={**headers, "Range": "bytes=0-1"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status in (200, 206)
    except (urllib.error.URLError, OSError):
        return False


# Formats audio a essayer, du meilleur pour l'apercu au moins bon (m4a d'abord : lu partout).
_PREVIEW_ITAGS = ("140", "251", "250", "139", "249")


def stream_source(video_id, check=True):
    """(lien direct, en-tetes a envoyer) de l'audio d'une video, verifie aupres de YouTube.

    YouTube refuse parfois un lien que yt-dlp vient d'obtenir (format reserve a un client,
    ou trop de requetes depuis cette connexion) : on verifie chaque lien et on essaie les
    autres formats audio avant d'abandonner, avec un message clair.
    """
    if not re.fullmatch(r"[\w-]{6,20}", str(video_id)):
        raise ValueError("Video inconnue")
    with _cache_lock:
        cached = _stream_cache.get(video_id)
    if cached and time.time() - cached[1] < STREAM_TTL and (not check or _link_works(cached[0], cached[2])):
        return cached[0], cached[2]
    info = _full_info(video_id)
    _remember(video_id, info)
    formats = [f for f in info.get("formats") or [] if f.get("url") and f.get("protocol") in ("https", "http")
               and f.get("vcodec") in (None, "none") and f.get("acodec") not in (None, "none")]
    formats.sort(key=lambda f: _PREVIEW_ITAGS.index(f["format_id"]) if f["format_id"] in _PREVIEW_ITAGS else 99)
    if info.get("url"):
        formats.insert(0, {"url": info["url"], "http_headers": info.get("http_headers")})
    for f in formats[:6]:
        headers = dict(f.get("http_headers") or {})
        if _link_works(f["url"], headers):
            with _cache_lock:
                _stream_cache[video_id] = (f["url"], time.time(), headers)
            return f["url"], headers
    raise ValueError("YouTube refuse l'aperçu pour le moment (souvent après beaucoup de recherches "
                     "ou d'aperçus d'affilée) : réessaie dans quelques minutes. Le téléchargement, lui, reste possible.")


def stream_url(video_id):
    """Lien direct vers l'audio d'une video, pour l'ecouter en apercu sans la telecharger."""
    return stream_source(video_id)[0]
