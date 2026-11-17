"""Genre musical de chaque artiste (Rock, Rap, Électro...), via l'API publique de Deezer.

Les fichiers venus de YouTube n'ont presque jamais de genre. On cherche donc un titre de
chaque artiste sur Deezer et on prend le genre de l'album, regroupe en grandes familles.
Une seule recherche par artiste, en arriere-plan et a petit rythme ; le resultat est garde
dans la bibliotheque (table artist_genres).
"""

import json
import re
import threading
import time
import urllib.parse
import urllib.request

from .titles import split_artists

# Familles affichees, dans l'ordre de priorite quand un album a plusieurs genres Deezer.
_FAMILIES = [
    ("Rap", ("rap", "hip hop")),
    ("Électro", ("electro", "dance", "techno", "house")),
    ("Rock", ("rock", "alternative", "metal", "punk")),
    ("R&B & Soul", ("r&b", "soul", "funk")),
    ("Latino", ("latino", "brésil", "bresil", "reggaeton")),
    ("Reggae", ("reggae",)),
    ("Chanson française", ("chanson", "variété")),
    ("Classique", ("classique", "classical")),
    ("Jazz & Blues", ("jazz", "blues")),
    ("Films & jeux vidéo", ("films", "jeux")),
    ("Country & Folk", ("country", "folk")),
    ("Pop", ("pop",)),
]
OTHER = "Autres"
FAMILY_ORDER = [name for name, _ in _FAMILIES] + [OTHER]
_PAUSE = 0.25  # Deezer accepte 50 requetes / 5 s ; on reste tres en dessous


def family(deezer_genres):
    names = [g.casefold() for g in deezer_genres]
    for fam, keywords in _FAMILIES:
        if any(k in n for n in names for k in keywords):
            return fam
    return OTHER if names else None


def _get(url):
    request = urllib.request.Request(url, headers={"Accept-Language": "fr", "User-Agent": "Audora"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def _key(text):
    return re.sub(r"[\W_]+", "", (text or "").casefold())


def _simple_title(title):
    """"Destination Calabria [Explicit Version] (feat. X)" -> "Destination Calabria" (recherche plus fiable)."""
    title = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", title or "")
    title = re.sub(r"\s(?:feat|ft)\.?\s.*$|\s(?:OST|Need for Speed.*)$", "", title, flags=re.I)
    return re.sub(r"\s{2,}", " ", title).strip()


def lookup(artist, title):
    """Famille de genre pour un artiste, a partir d'un de ses titres. None si introuvable.

    La recherche "avancee" de Deezer (artist:"...") est capricieuse : on utilise la recherche
    simple et on verifie que le resultat est bien de cet artiste.
    """
    # "Guitar Hero World Tour (#13) Beastie Boys" (nom de fichier) -> "Beastie Boys"
    artist = re.sub(r"^guitar hero[^)]*\)\s*", "", artist, flags=re.I).strip() or artist
    if "Ã" in artist:  # texte UTF-8 mal decode ("TÃ©lÃ©phone" -> "Téléphone")
        try:
            artist = artist.encode("latin-1").decode("utf-8")
        except UnicodeError:
            pass
    artist = split_artists(artist)[0] or artist  # "MIA BOYKA & T-killah" -> "MIA BOYKA"
    wanted = _key(artist)
    for query in (f"{artist} {_simple_title(title)}", artist):
        found = _get("https://api.deezer.com/search?limit=5&q=" + urllib.parse.quote(query)).get("data") or []
        time.sleep(_PAUSE)
        for track in found:
            name = _key(track.get("artist", {}).get("name"))
            if name and wanted and (name == wanted or name in wanted or wanted in name):
                album = _get(f"https://api.deezer.com/album/{track['album']['id']}")
                time.sleep(_PAUSE)
                return family([g["name"] for g in album.get("genres", {}).get("data", [])]) or OTHER
    return None


def find_cover(artist, title):
    """Adresse de la pochette (Deezer, 1000 x 1000) d'un titre, ou None. Artiste ET titre verifies."""
    wanted_artist = _key(split_artists(artist)[0] or artist)
    wanted_title = _key(_simple_title(title))
    if not wanted_artist or not wanted_title:
        return None
    query = urllib.parse.quote(f"{artist} {_simple_title(title)}")
    for track in _get(f"https://api.deezer.com/search?limit=8&q={query}").get("data") or []:
        name = _key(track.get("artist", {}).get("name"))
        got = _key(_simple_title(track.get("title") or ""))
        if (name and (name == wanted_artist or name in wanted_artist or wanted_artist in name)
                and got and (got == wanted_title or got in wanted_title or wanted_title in got)):
            album = track.get("album") or {}
            return album.get("cover_xl") or album.get("cover_big")
    return None


class CoverFinder:
    """Cherche en arriere-plan les pochettes manquantes (une seule tentative par titre)."""

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
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            found = 0
            for track in self._library.tracks_without_cover():
                try:
                    url = find_cover(track["artist"], track["title"])
                    time.sleep(_PAUSE)
                    data = None
                    if url:
                        request = urllib.request.Request(url, headers={"User-Agent": "Audora"})
                        with urllib.request.urlopen(request, timeout=15) as response:
                            data = response.read()
                except Exception:
                    break  # pas d'internet ou Deezer indisponible : on reessaiera au prochain lancement
                self._library.set_found_cover(track["id"], data)
                if data:
                    found += 1
                    if found % 10 == 0:
                        self._on_update()
            if found % 10:
                self._on_update()
        finally:
            with self._lock:
                self._running = False


class GenreFinder:
    """Complete en arriere-plan les genres manquants ; previent l'interface au fur et a mesure."""

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
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            found_since_update = 0
            for artist, title in self._library.artists_without_genre():
                try:
                    genre = lookup(artist, title)
                except Exception:
                    break  # pas d'internet ou Deezer indisponible : on reessaiera au prochain lancement
                self._library.set_artist_genre(artist, genre)
                found_since_update += 1
                if found_since_update >= 15:
                    self._on_update()
                    found_since_update = 0
            if found_since_update:
                self._on_update()
        finally:
            with self._lock:
                self._running = False
