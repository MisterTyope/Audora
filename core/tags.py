"""Lecture / ecriture des tags (titre, artiste, album, pochette) avec mutagen."""

from mutagen import File as MutagenFile


def read_tags(path):
    """Retourne {title, artist, album, duration, cover: (bytes, mime) | None}."""
    out = {"cover": None}
    try:
        easy = MutagenFile(path, easy=True)
    except Exception:
        easy = None

    if easy is not None:
        if easy.info is not None:
            out["duration"] = getattr(easy.info, "length", None)
        tags = easy.tags
        if tags is not None:
            for key in ("title", "artist", "album"):
                try:
                    value = tags.get(key)
                except Exception:
                    value = None
                if value:
                    out[key] = str(value[0]).strip()

    try:
        out["cover"] = _extract_cover(MutagenFile(path))
    except Exception:
        pass
    return out


def _extract_cover(m):
    if m is None:
        return None
    tags = m.tags
    if tags is not None:
        if hasattr(tags, "getall"):  # MP3 (ID3)
            pictures = tags.getall("APIC")
            if pictures:
                return pictures[0].data, pictures[0].mime or "image/jpeg"
        covr = tags.get("covr") if hasattr(tags, "get") else None  # MP4 / M4A
        if covr:
            cover = covr[0]
            mime = "image/png" if getattr(cover, "imageformat", None) == 14 else "image/jpeg"
            return bytes(cover), mime
    pictures = getattr(m, "pictures", None)  # FLAC
    if pictures:
        return pictures[0].data, pictures[0].mime or "image/jpeg"
    return None


def write_tags(path, title, artist, album):
    m = MutagenFile(path, easy=True)
    if m is None:
        raise ValueError("Ce format de fichier ne permet pas de modifier les infos.")
    if m.tags is None:
        m.add_tags()
    m["title"] = [title]
    m["artist"] = [artist]
    if album:
        m["album"] = [album]
    elif "album" in m:
        del m["album"]
    m.save()


def embed_cover(path, jpeg_bytes):
    lower = path.lower()
    if lower.endswith(".mp3"):
        from mutagen.id3 import APIC, ID3, ID3NoHeaderError

        try:
            tags = ID3(path)
        except ID3NoHeaderError:
            tags = ID3()
        tags.delall("APIC")
        tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=jpeg_bytes))
        tags.save(path)
    elif lower.endswith((".mp4", ".m4a")):
        from mutagen.mp4 import MP4, MP4Cover

        m = MP4(path)
        m["covr"] = [MP4Cover(jpeg_bytes, imageformat=MP4Cover.FORMAT_JPEG)]
        m.save()
