"""Garde seulement la musique : coupe les passages parles (intro de clip, sketch, generique)
et les blancs.

- Passages parles : base communautaire SponsorBlock (categorie "Non-Music Section" des clips),
  seulement pour les titres venus de YouTube (on connait l'identifiant de la video).
- Blancs : detectes dans le son par ffmpeg (silencedetect).
"""

import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from mutagen import File as MutagenFile

log = logging.getLogger("audora")
SPONSORBLOCK_URL = "https://sponsor.ajay.app/api/skipSegments"
# Tout ce qui n'est pas de la musique dans un clip.
CATEGORIES = ["music_offtopic", "intro", "outro", "sponsor", "selfpromo", "interaction", "preview"]
LABELS = {
    "music_offtopic": "Passage sans musique", "intro": "Intro", "outro": "Générique de fin",
    "sponsor": "Sponsor", "selfpromo": "Autopromo", "interaction": "Rappel d'abonnement",
    "preview": "Aperçu", "silence_start": "Blanc au début", "silence_end": "Blanc à la fin",
    "silence": "Blanc",
}

SILENCE_DB = -50       # en dessous : considere comme du silence
EDGE_SILENCE = 2.0     # blanc au debut ou a la fin : coupe s'il dure au moins 2 s...
EDGE_KEEP = 0.3        # ...en gardant 0,3 s
MIDDLE_SILENCE = 4.0   # blanc au milieu (ex. avant un morceau cache) : au moins 4 s...
MIDDLE_KEEP = 0.75     # ...en gardant 0,75 s de chaque cote
MIN_CUT = 0.5          # on ne coupe pas les miettes
MIN_REMAINING = 30     # jamais moins de 30 s de musique a la fin
MAX_CUT_RATIO = 0.6    # ni plus de 60 % du titre (sinon quelque chose cloche)

_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0  # pas de console noire qui clignote


def ffmpeg_path():
    return shutil.which("ffmpeg")


def _duration(path):
    audio = MutagenFile(path)
    return float(audio.info.length) if audio and audio.info else 0.0


def sponsor_segments(video_id):
    """[(debut, fin, categorie)] des passages sans musique d'une video YouTube (vide si aucun)."""
    if not video_id or not re.fullmatch(r"[\w-]{6,20}", video_id):
        return []
    query = urllib.parse.urlencode({"videoID": video_id, "categories": json.dumps(CATEGORIES)})
    request = urllib.request.Request(f"{SPONSORBLOCK_URL}?{query}", headers={"User-Agent": "Audora"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:  # aucun passage signale pour cette video
            return []
        raise
    return [(float(s["segment"][0]), float(s["segment"][1]), s["category"])
            for s in data if s.get("actionType", "skip") == "skip" and s.get("segment")]


def silences(path):
    """[(debut, fin)] des blancs d'au moins EDGE_SILENCE secondes."""
    result = subprocess.run(
        [ffmpeg_path(), "-hide_banner", "-nostats", "-i", path, "-vn",
         "-af", f"silencedetect=noise={SILENCE_DB}dB:d={EDGE_SILENCE}", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=_NO_WINDOW)
    found, start = [], None
    for line in result.stderr.splitlines():
        m = re.search(r"silence_start: (-?[\d.]+)", line)
        if m:
            start = max(0.0, float(m.group(1)))
            continue
        m = re.search(r"silence_end: ([\d.]+)", line)
        if m and start is not None:
            found.append((start, float(m.group(1))))
            start = None
    if start is not None:  # blanc jusqu'a la fin du fichier
        found.append((start, float("inf")))
    return found


def plan_cuts(duration, segments, silent):
    """Passages a couper : [(debut, fin, categorie)], fusionnes et verifies."""
    cuts = [(max(0.0, a), min(duration, b), cat) for a, b, cat in segments if b > a]
    for a, b in silent:
        b = min(b, duration)
        if a <= 0.05:  # blanc au tout debut
            if b - a >= EDGE_SILENCE:
                cuts.append((0.0, b - EDGE_KEEP, "silence_start"))
        elif b >= duration - 0.05:  # blanc a la toute fin
            if b - a >= EDGE_SILENCE:
                cuts.append((a + EDGE_KEEP, duration, "silence_end"))
        elif b - a >= MIDDLE_SILENCE:
            cuts.append((a + MIDDLE_KEEP, b - MIDDLE_KEEP, "silence"))
    cuts = sorted(c for c in cuts if c[1] - c[0] >= MIN_CUT)

    merged = []
    for a, b, cat in cuts:
        if merged and a <= merged[-1][1] + 0.1:
            prev = merged[-1]
            # le passage parle l'emporte sur le blanc dans l'etiquette
            label = prev[2] if not prev[2].startswith("silence") else cat
            merged[-1] = (prev[0], max(prev[1], b), label)
        else:
            merged.append((a, b, cat))

    removed = sum(b - a for a, b, _ in merged)
    if not merged or duration - removed < MIN_REMAINING or removed > duration * MAX_CUT_RATIO:
        return []
    return [(round(a, 2), round(b, 2), cat) for a, b, cat in merged]


def analyze(path, video_id=None):
    """{"duration", "cuts": [{"start", "end", "kind", "label"}]} pour un fichier audio."""
    duration = _duration(path)
    segments = sponsor_segments(video_id) if video_id else []
    cuts = plan_cuts(duration, segments, silences(path)) if duration else []
    return {
        "duration": duration,
        "cuts": [{"start": a, "end": b, "kind": cat, "label": LABELS.get(cat, cat)} for a, b, cat in cuts],
    }


def apply_cuts(src, dest, cuts, duration):
    """Ecrit dans dest le son de src sans les passages coupes (tags et pochette conserves)."""
    keep, pos = [], 0.0
    for c in sorted(cuts, key=lambda c: c["start"]):
        if c["start"] > pos:
            keep.append((pos, c["start"]))
        pos = max(pos, c["end"])
    if pos < duration:
        keep.append((pos, duration))
    keep = [(a, b) for a, b in keep if b - a > 0.05]
    if not keep:
        raise ValueError("Il ne resterait rien du titre.")

    fade = 0.015  # micro-fondu aux raccords : pas de "clic"
    parts = []
    for i, (a, b) in enumerate(keep):
        length = b - a
        parts.append(f"[0:a]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS,"
                     f"afade=t=in:d={fade},afade=t=out:st={max(0, length - fade):.3f}:d={fade}[p{i}]")
    graph = ";".join(parts) + ";" + "".join(f"[p{i}]" for i in range(len(keep))) + f"concat=n={len(keep)}:v=0:a=1[out]"

    cmd = [ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-i", src,
           "-filter_complex", graph, "-map", "[out]", "-map", "0:v?", "-c:v", "copy",
           "-map_metadata", "0", "-id3v2_version", "3",
           "-c:a", "libmp3lame", "-q:a", "0", "-f", "mp3", dest]  # VBR qualite maximale
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                            creationflags=_NO_WINDOW)
    if result.returncode != 0 or not os.path.exists(dest):
        raise RuntimeError((result.stderr or "ffmpeg a échoué").strip().splitlines()[-1][:200])
    return _duration(dest)


class LibraryTrimmer:
    """Analyse toute la bibliotheque en arriere-plan, puis coupe les passages choisis.

    Les originaux partent dans la corbeille de Windows (recuperables)."""

    def __init__(self, library, emit, recycle):
        self._library = library
        self._emit = emit
        self._recycle = recycle
        self._lock = threading.Lock()
        self._last_emit = 0.0
        self.state = {"phase": "idle", "done": 0, "total": 0, "results": [], "errors": []}

    def snapshot(self):
        with self._lock:
            return json.loads(json.dumps(self.state))

    def _publish(self, force=False):
        now = time.monotonic()
        if force or now - self._last_emit > 0.3:
            self._last_emit = now
            self._emit("trim", self.snapshot())

    def scan(self):
        with self._lock:
            if self.state["phase"] in ("scanning", "applying"):
                return self.snapshot()
            items = self._library.tracks_to_trim()
            self.state = {"phase": "scanning", "done": 0, "total": len(items), "results": [], "errors": []}
        threading.Thread(target=self._scan, args=(items,), daemon=True).start()
        return self.snapshot()

    def _scan(self, items):
        def work(track):
            try:
                found = analyze(track["path"], track.get("source_id"))
            except Exception as exc:  # fichier illisible, pas de reseau... : retente au prochain passage
                with self._lock:
                    self.state["errors"].append({"id": track["id"], "title": track["title"], "error": str(exc)[:160]})
            else:
                if found["cuts"]:
                    with self._lock:
                        self.state["results"].append({
                            "id": track["id"], "title": track["title"], "artist": track["artist"],
                            "duration": found["duration"], "cuts": found["cuts"]})
                else:
                    self._library.set_trim_state(track["id"], "clean")
            with self._lock:
                self.state["done"] += 1
            self._publish()

        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(work, items))
        with self._lock:
            self.state["results"].sort(key=lambda r: ((r["artist"] or "").casefold(), (r["title"] or "").casefold()))
            self.state["phase"] = "ready"
        self._publish(force=True)

    def apply(self, selection):
        """selection = {track_id: [index des passages a couper]}."""
        with self._lock:
            if self.state["phase"] != "ready":
                raise ValueError("Lance d'abord l'analyse.")
            by_id = {r["id"]: r for r in self.state["results"]}
            todo = []
            for track_id, indexes in (selection or {}).items():
                result = by_id.get(int(track_id))
                cuts = [result["cuts"][i] for i in sorted(set(indexes)) if result and 0 <= i < len(result["cuts"])]
                if cuts:
                    todo.append((result, cuts))
            self.state.update(phase="applying", done=0, total=len(todo), errors=[])
        threading.Thread(target=self._apply, args=(todo,), daemon=True).start()
        return self.snapshot()

    def _apply(self, todo):
        applied = 0
        for result, cuts in todo:
            path = self._library.get_track_path(result["id"])
            tmp = (path or "")[:-4] + ".audora-coupe.mp3"
            try:
                if not path or not os.path.exists(path):
                    raise ValueError("Fichier introuvable")
                duration = apply_cuts(path, tmp, cuts, result["duration"])
                self._recycle(path)  # l'original part dans la corbeille
                os.replace(tmp, path)
                self._library.set_trim_state(result["id"], "trimmed", duration)
                applied += 1
            except Exception as exc:
                log.warning("Decoupe impossible pour %s : %s", path, exc)
                if os.path.exists(tmp):
                    os.remove(tmp)
                with self._lock:
                    self.state["errors"].append({"id": result["id"], "title": result["title"], "error": str(exc)[:160]})
            with self._lock:
                self.state["done"] += 1
            self._publish()
        with self._lock:
            done_ids = {r["id"] for r, _ in todo} - {e["id"] for e in self.state["errors"]}
            self.state["results"] = [r for r in self.state["results"] if r["id"] not in done_ids]
            self.state["phase"] = "done"
            self.state["applied"] = applied
        self._emit("library_changed", None)
        self._publish(force=True)
