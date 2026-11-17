"""Preparation des pochettes : retrait des bandes noires des miniatures YouTube, recadrage."""

import io

from PIL import Image

_DARK_THRESHOLD = 18


def _main_bright_span(values):
    """Plus long bloc continu de lignes non noires (un logo dans une bande noire ne compte pas)."""
    tolerance = max(2, len(values) // 100)  # une scene sombre peut avoir quelques lignes noires
    best, start, last_bright = (0, len(values)), None, None
    best_len = 0
    for i, v in enumerate(values):
        if v <= _DARK_THRESHOLD:
            continue
        if start is None or i - last_bright > tolerance:
            start = i
        last_bright = i
        if last_bright + 1 - start > best_len:
            best_len = last_bright + 1 - start
            best = (start, last_bright + 1)
    return best


def _trim_dark_bars(image):
    """Retire les bandes noires (letterbox / pillarbox) que YouTube ajoute aux miniatures."""
    gray = image.convert("L")
    width, height = image.size
    # Redimensionner a 1 pixel de large donne la luminosite moyenne de chaque ligne
    # (et inversement pour les colonnes) : insensible aux quelques pixels parasites.
    rows = gray.resize((1, height), Image.BOX).tobytes()
    cols = gray.resize((width, 1), Image.BOX).tobytes()
    top, bottom = _main_bright_span(rows)
    left, right = _main_bright_span(cols)
    # On ne garde le recadrage que s'il ressemble a des bandes (contenu encore large),
    # pour ne pas rogner une image simplement sombre.
    if (bottom - top) < height * 0.5:
        top, bottom = 0, height
    if (right - left) < width * 0.5:
        left, right = 0, width
    return image.crop((left, top, right, bottom))


def make_cover(data, square=True):
    """Retourne une pochette JPEG (bytes) : carree pour l'audio, 16:9 pour la video."""
    image = Image.open(io.BytesIO(data)).convert("RGB")
    image = _trim_dark_bars(image)
    if square:
        side = min(image.size)
        left = (image.width - side) // 2
        top = (image.height - side) // 2
        image = image.crop((left, top, left + side, top + side))
        image.thumbnail((640, 640))
    else:
        image.thumbnail((960, 540))
    out = io.BytesIO()
    image.save(out, "JPEG", quality=90)
    return out.getvalue()
