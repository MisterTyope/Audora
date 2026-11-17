"""Nettoyage des titres YouTube, separation "Artiste - Titre" et artiste principal."""

import re
import unicodedata

# Mots "parasites" qu'on retrouve entre parentheses ou en fin de titre :
# "(Official Music Video)", "[Clip Officiel]", "(Remastered 2011)", "[HD UPGRADE]", "| Lyrics"...
_NOISE_WORD = (
    r"official|officiel(?:le)?|clip|music|musique|video|vid[ée]o|lyrics?|paroles|audio|"
    r"visuali[sz]er|animated|hd|hq|4k|mv|explicit|upgrade|"
    r"remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?"
)
_BRACKETED = re.compile(rf"\s*[\(\[【]\s*(?:(?:{_NOISE_WORD})[\s/&+\-]*)+[\)\]】]", re.IGNORECASE)
_TRAILING = re.compile(rf"\s*[|｜\-–—]\s*((?:(?:{_NOISE_WORD})[\s/&+]*)+)$", re.IGNORECASE)
# En fin de titre, on n'enleve un suffixe que s'il est clairement "officiel" :
# evite de couper une chanson qui s'appelle vraiment "Video" ou "Audio".
_TRAILING_REQUIRED = re.compile(r"official|officiel|clip|lyrics?|paroles|visuali|remaster|animated", re.IGNORECASE)
_OFFICIAL_SEGMENT = re.compile(r"\s+[-|]\s+official(?=\s+[-|]\s+|$)", re.IGNORECASE)  # "Titre - Official - 1984"
_TRAILING_YEAR = re.compile(r"\s+[-|]\s+(?:19|20)\d{2}$")
_TRAILING_QUALITY = re.compile(r"\s+(?:HQ|HD|4K)$")
_QUOTES = "\"'“”«»＂"

_SEPARATORS = (" - ", " – ", " — ", " | ", " ｜ ")
_CHANNEL_SUFFIXES = re.compile(r"\s*(?:-\s*topic|vevo|official|officiel)\s*$", re.IGNORECASE)
_FORBIDDEN_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED_NAMES = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}

UNKNOWN_ARTIST = "Artiste inconnu"

# Groupes dont le nom contient "&", "," ou "and" : on ne les coupe pas en plusieurs artistes.
KNOWN_GROUPS = [
    "Earth, Wind & Fire", "Simon & Garfunkel", "Hall & Oates", "Daryl Hall & John Oates",
    "Crosby, Stills, Nash & Young", "Crosby, Stills & Nash", "Peter, Paul and Mary",
    "Mumford & Sons", "Kool & The Gang", "Brooks & Dunn", "Big & Rich", "Sam & Dave",
    "Ike & Tina Turner", "Chase & Status", "Above & Beyond", "Years & Years", "Belle & Sebastian",
    "Iron & Wine", "Matt & Kim", "Nico & Vinz", "Macklemore & Ryan Lewis", "Axwell & Ingrosso",
    "Dimitri Vegas & Like Mike", "Florence + The Machine", "Coheed and Cambria",
    "Of Monsters and Men", "Tyler, The Creator", "Hootie & The Blowfish", "Sly & The Family Stone",
    "Bob Marley & The Wailers", "Tom Petty & The Heartbreakers", "Huey Lewis & The News",
    "Marina & The Diamonds", "Echo & The Bunnymen", "Martha & The Vandellas", "Katrina & The Waves",
    "Salt-N-Pepa", "Lost Frequencies", "Twenty One Pilots",
]
# Separateurs entre plusieurs artistes : "A & B", "A, B", "A x B", "A feat. B", "A ft B", "A vs B"...
_ARTISTS_SPLIT = re.compile(
    r"\s*(?:,|;|\s&\s|\s(?-i:x)\s|\s/\s|\s(?:feat\.?|ft\.?|featuring|vs\.?|with)\s)\s*", re.IGNORECASE)
_HAS_FEATURING = re.compile(r"\b(?:feat|ft|featuring)\b\.?", re.IGNORECASE)


def _key(text):
    """Forme de comparaison : minuscules, sans accents ni ponctuation ("Earth, Wind & Fire" -> "earthwindfire")."""
    text = unicodedata.normalize("NFKD", text or "")
    return re.sub(r"[^0-9a-z]", "", "".join(c for c in text if not unicodedata.combining(c)).casefold())


def _group_pattern(group):
    words = re.findall(r"[A-Za-z0-9']+", group)
    return re.compile(r"\b" + r"\W*".join(re.escape(w) for w in words) + r"\b", re.IGNORECASE)


_GROUP_PATTERNS = [(group, _group_pattern(group)) for group in KNOWN_GROUPS]


def clean_title(title):
    if not title:
        return ""
    t = _BRACKETED.sub("", title)
    match = _TRAILING.search(t)
    if match and _TRAILING_REQUIRED.search(match.group(1)):
        t = t[:match.start()]
    t = _OFFICIAL_SEGMENT.sub("", t)
    t = _TRAILING_YEAR.sub("", t)
    t = _TRAILING_QUALITY.sub("", t)
    t = re.sub(r"\s{2,}", " ", t).strip(" -|｜–—\t")
    if len(t) > 2 and t[0] in _QUOTES and t[-1] in _QUOTES:
        t = t[1:-1].strip()
    return t


def clean_channel(name):
    if not name:
        return ""
    return _CHANNEL_SUFFIXES.sub("", name).strip()


def same_artist(part, channel):
    """Vrai si `part` designe l'artiste de la chaine `channel` ("Queen" / "Queen Official", "NF" / "NFrealmusic")."""
    a = _key(part)
    c = re.sub(r"(?:official|officiel|vevo|music|musique|tv|channel|topic)+$", "", _key(clean_channel(channel)))
    if not a or not c:
        return False
    if a == c:
        return True
    if len(a) >= 4 and (a in c or c in a):
        return True
    return c.startswith(a)


def split_artists(name):
    """"Skrillex & Young Miko" -> ("Skrillex", ["Young Miko"]). Les groupes connus restent entiers."""
    name = (name or "").strip()
    if not name:
        return "", []
    protected, groups = name, []
    for group, pattern in _GROUP_PATTERNS:
        if pattern.search(protected):
            protected = pattern.sub(f"\x00{len(groups)}\x00", protected, count=1)
            groups.append(group)
    protected = re.sub(r"\s&\s(?=the\s)", " \x01 ", protected, flags=re.IGNORECASE)  # "Bob & The Band"
    parts = []
    for part in _ARTISTS_SPLIT.split(protected):
        part = re.sub(r"\x00(\d+)\x00", lambda m: groups[int(m.group(1))], part).replace("\x01", "&").strip(" ,")
        if part and _key(part) not in {_key(p) for p in parts}:
            parts.append(part)
    if not parts:
        return name, []
    return parts[0], parts[1:]


# --- "Titre seul" : sans invites, ni mention de clip, de version, de jeu video... ---

_FEAT_PAREN = re.compile(r"\s*[\(\[]\s*(?:feat|ft|featuring|avec|with|prod)\b\.?[^\)\]]*[\)\]]", re.IGNORECASE)
_FEAT_TAIL = re.compile(r"\s+(?:feat|ft|featuring)\b\.?\s.*$", re.IGNORECASE)
_EXTRA_WORDS = (
    r"official|officiel|oficial|clip|vid[eé]o|v[ií]deo|audio|lyrics?|paroles|letra|visuali[sz]er|hd|hq|4k|upgrade|"
    r"remaster\w*|explicit|soundtrack|ost|bande originale|version|remix|mix|live|unplugged|acoustic|acoustique|"
    r"instrumental|mashup|edit|extended|sped up|slowed|reverb|nightcore|performance|festival|vod|premi[eè]re|"
    r"премьера|клип|трек|mood video|static|karaoke|tiktok|fifa|need for speed|vs\.?|from|by"
)
_EXTRA_PAREN = re.compile(rf"\s*\((?=[^)]*\b(?:{_EXTRA_WORDS})\b)[^)]*\)", re.IGNORECASE)
_SQUARE = re.compile(r"\s*\[[^\]]*\]")
_TAIL_NOISE = re.compile(
    r"\s*[-–]?\s*(?:need for speed[^()]*?ost|fifa \d+ soundtrack|(?:clip|video|vid[eé]o) officiel(?:le)?\b.*|"
    r"official (?:music )?video\b.*|премьера\b.*|\bost)\s*$", re.IGNORECASE)
_QUOTED = re.compile(r'[«"“]\s*([^"”»]{2,}?)\s*[»"”]')
_GUITAR_HERO = re.compile(r"^guitar hero[^)]*\)\s*", re.IGNORECASE)


def title_only(title):
    """"#2Маши "Мама, я танцую" ПРЕМЬЕРА" -> "Мама, я танцую" ; "Bizarre (feat. Vald)" -> "Bizarre" ;
    "Levántate Need for Speed Heat OST" -> "Levántate". Les sous-titres qui font partie du nom
    ("You Spin Me Round (Like a Record)") sont gardes."""
    original = clean_title(title) or (title or "").strip()
    t = _GUITAR_HERO.sub("", original)
    quoted = _QUOTED.search(t)
    if quoted and len(quoted.group(1)) >= 2:
        t = quoted.group(1)
    t = re.split(r"\s*(?:\|{1,3}|｜)\s*", t)[0]  # "LA MORT ||| Chant militaire" -> "LA MORT"
    for _ in range(3):  # plusieurs passes : "Titre (Vidéo Oficial) (feat. X)"
        t = _FEAT_PAREN.sub("", t)
        t = _SQUARE.sub("", t)
        t = _EXTRA_PAREN.sub("", t)
        t = _FEAT_TAIL.sub("", t)
        t = _TAIL_NOISE.sub("", t)
    t = re.sub(r"\s{2,}", " ", t).strip(" -–—|:\"")
    return t or original


def primary_artist(artist):
    """"NGHTMRE & A$AP Ferg" -> "NGHTMRE" ; "Guitar Hero World Tour (#13) Beastie Boys" -> "Beastie Boys"."""
    artist = _GUITAR_HERO.sub("", (artist or "").strip()) or (artist or "").strip()
    return split_artists(artist)[0] or UNKNOWN_ARTIST


def primary_artist_and_title(artist, title):
    """Artiste principal seul, titre seul (sans "feat." ni mentions de clip/version)."""
    return primary_artist(artist), title_only(title)


def _split_on_separator(title):
    for sep in _SEPARATORS:
        if sep in title:
            left, right = title.split(sep, 1)
            left, right = left.strip(), clean_title(right)
            if left and right:
                return left, right
    return None


def _split_by(title):
    """"Sh-Boom by The Chords" -> ("The Chords", "Sh-Boom"). Seulement si l'artiste fait 2 mots ou plus,
    pour ne pas couper "Stand by Me"."""
    match = re.match(r"^(.+?)\s+by\s+((?:the\s+)?\S+(?:\s+\S+)+)$", title, re.IGNORECASE)
    if match and len(match.group(2).split()) <= 5:
        return match.group(2).strip(), match.group(1).strip()
    return None


def split_artist_title(raw_title, uploader=None, artist=None, track=None, known_artists=None):
    """Retourne (artiste, titre) a partir des infos YouTube disponibles.

    `known_artists` : cles (_key) des artistes deja dans la bibliotheque, pour reperer les
    videos titrees a l'envers ("Basket Case - Green Day").
    """
    # Les videos "auto-generees" de YouTube Music donnent directement artiste + morceau.
    if artist and track:
        return artist.strip(), clean_title(track) or track.strip()

    title = clean_title(raw_title)
    pair = _split_on_separator(title)
    if pair:
        left, right = pair
        known = known_artists or set()
        right_is_artist = (same_artist(right, uploader) and not same_artist(left, uploader)) or (
            _key(right) in known and _key(left) not in known)
        return (right, left) if right_is_artist else (left, right)

    pair = _split_by(title)
    if pair:
        return pair
    return clean_channel(uploader) or UNKNOWN_ARTIST, title or (raw_title or "").strip()


def names_from_tags(tag_title, tag_artist, known_artists=None):
    """(artiste, titre) pour un fichier existant, a partir de ses tags.

    Gere les anciens telechargements : tag artiste = nom de la chaine ("Queen Official",
    "msvogue23") et tag titre = titre YouTube brut ("Queen - Radio Ga Ga (Official Video)").
    """
    known = known_artists or set()
    title = clean_title(tag_title) or (tag_title or "").strip()
    artist = (tag_artist or "").strip()

    pair = _split_on_separator(title)
    if pair:
        left, right = pair
        if artist and same_artist(left, artist):
            return left, right
        if artist and same_artist(right, artist):
            return right, left
        if artist and _key(artist) in known:
            return artist, title  # vrai artiste ("Sum 41") : le " | " fait partie du titre
        return split_artist_title(title, uploader=artist, known_artists=known)

    if not artist:
        pair = _split_by(title)
        return pair if pair else (UNKNOWN_ARTIST, title)

    # Titre et artiste inverses ? ("Basket Case" / "Green Day", "Somewhere I Belong [4K UPGRADE]" / "Linkin Park")
    artist_has_noise = clean_title(artist) != artist
    if artist_has_noise or (_key(title) in known and _key(artist) not in known):
        return clean_channel(title) or title, clean_title(artist) or artist
    pair = _split_by(title)
    if pair and not same_artist(pair[1], artist):
        return pair
    return clean_channel(artist) or artist, title


def safe_filename(name, fallback="Sans titre"):
    name = _FORBIDDEN_CHARS.sub("", name or "")
    name = re.sub(r"\s{2,}", " ", name).strip(" .")
    name = name[:120].strip(" .")
    if not name:
        name = fallback
    if name.upper() in _RESERVED_NAMES:
        name = "_" + name
    return name
