"""Paroles des chansons, synchronisees ligne par ligne quand c'est possible.

Source : LRCLIB (lrclib.net), base libre et gratuite. Les paroles sont gardees dans la base
d'Audora : une seule recherche par titre. Les paroles synchronisees ne sont gardees que si la
version trouvee a la meme duree que notre fichier (sinon les lignes seraient decalees) ;
a defaut, on affiche les paroles simples.
"""

import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from .genres import _key, _simple_title
from .titles import UNKNOWN_ARTIST, split_artists

log = logging.getLogger("audora")
API = "https://lrclib.net/api/search"
SYNC_TOLERANCE = 6  # secondes d'ecart de duree au-dela desquelles la synchro ne colle plus


def _search(params):
    request = urllib.request.Request(f"{API}?{urllib.parse.urlencode(params)}",
                                     headers={"User-Agent": "Audora (lecteur de musique personnel)"})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def fetch(artist, title, duration):
    """{"synced": texte LRC ou None, "plain": texte ou None}. Leve une exception si pas de reseau."""
    artist = split_artists(artist or "")[0] or artist or ""
    title = _simple_title(title or "")
    if not title or artist == UNKNOWN_ARTIST:
        return {"synced": None, "plain": None}
    wanted_artist, wanted_title = _key(artist), _key(title)
    results = _search({"track_name": title, "artist_name": artist}) or _search({"q": f"{artist} {title}"})
    candidates = []
    for r in results:
        name, got = _key(r.get("artistName")), _key(_simple_title(r.get("trackName") or ""))
        if not (name and (name == wanted_artist or name in wanted_artist or wanted_artist in name)):
            continue
        if not (got and (got == wanted_title or got in wanted_title or wanted_title in got)):
            continue
        candidates.append(r)
    if not candidates:
        return {"synced": None, "plain": None}
    gap = lambda r: abs((r.get("duration") or 0) - (duration or 0)) if duration else 0  # noqa: E731
    synced = [r for r in candidates if r.get("syncedLyrics") and gap(r) <= SYNC_TOLERANCE]
    plain = [r for r in candidates if r.get("plainLyrics")]
    best_synced = min(synced, key=gap) if synced else None
    best_plain = min(plain, key=gap) if plain else None
    return {
        "synced": best_synced["syncedLyrics"] if best_synced else None,
        "plain": (best_synced or best_plain or {}).get("plainLyrics"),
    }


def lyrics_for(library, track_id, refresh=False):
    """Paroles d'un titre (depuis la base, sinon recherchees maintenant)."""
    cached = library.get_lyrics(track_id)
    if cached and not refresh:
        return cached
    track = library.get_track(track_id)
    if not track:
        return {"synced": None, "plain": None}
    found = fetch(track["artist"], track["title"], track.get("duration"))
    library.set_lyrics(track_id, found["synced"], found["plain"])
    return library.get_lyrics(track_id)


class LyricsFinder:
    """Cherche en arriere-plan les paroles des titres du telephone (pour les avoir hors ligne)."""

    def __init__(self, library, on_update):
        self._library = library
        self._on_update = on_update
        self._lock = threading.Lock()
        self._running = False

    def start(self):
        with self._lock:
            if self._running:
                return
            self._running = True
        threading.Thread(target=self._run, daemon=True, name="paroles").start()

    def _run(self):
        try:
            found = 0
            for track_id in self._library.phone_tracks_without_lyrics():
                try:
                    lyrics_for(self._library, track_id)
                    found += 1
                except (urllib.error.URLError, OSError, ValueError) as exc:
                    log.warning("LRCLIB injoignable : %s", exc)
                    break  # on reessaiera plus tard
                time.sleep(0.5)  # service gratuit : on reste discret
            if found:
                self._on_update()
        finally:
            with self._lock:
                self._running = False
