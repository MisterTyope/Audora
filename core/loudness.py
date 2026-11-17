"""Volume egalise : chaque morceau est mesure une fois (norme EBU R128, en LUFS) puis joue
plus fort ou moins fort pour que tous sonnent pareil, sur le PC comme sur le telephone.

La mesure se fait en arriere-plan avec ffmpeg (~0,5 s par titre). Le gain est calcule a la
lecture : on vise TARGET_LUFS, sans jamais faire saturer (pic ramene sous -1 dB).
"""

import re
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor

from .trim import _NO_WINDOW, ffmpeg_path

TARGET_LUFS = -14.0      # niveau de reference (celui de YouTube et Spotify)
MAX_BOOST, MAX_CUT = 9.0, 15.0
LIMITER_DB = 6.0  # au plus 6 dB de pics adoucis par le limiteur quand on monte le son


def measure(path):
    """(volume integre en LUFS, pic en dBFS), ou (None, None) si illisible."""
    result = subprocess.run(
        [ffmpeg_path(), "-hide_banner", "-nostats", "-i", path, "-vn",
         "-af", "ebur128=peak=sample:framelog=quiet", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=_NO_WINDOW)
    summary = result.stderr.rsplit("Summary:", 1)[-1]
    integrated = re.search(r"I:\s+(-?[\d.]+|-inf) LUFS", summary)
    peak = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", summary)
    if not integrated or "inf" in integrated.group(1):
        return None, None
    return float(integrated.group(1)), (float(peak.group(1)) if peak and "inf" not in peak.group(1) else 0.0)


def gain_db(lufs, peak):
    """Correction a appliquer (en dB) pour un titre mesure ; None si pas encore mesure."""
    if lufs is None or lufs < -70:  # pas mesure, ou silence / fichier illisible
        return None
    gain = TARGET_LUFS - lufs
    if gain > 0 and peak is not None:
        # Monter le son : la lecture passe par un limiteur (PC et telephone), mais on ne lui
        # demande pas d'ecraser plus de LIMITER_DB de pics, pour garder la dynamique.
        gain = max(0.0, min(gain, -1.0 - peak + LIMITER_DB))
    return round(max(-MAX_CUT, min(MAX_BOOST, gain)), 1)


class LoudnessAnalyzer:
    """Mesure en arriere-plan les titres pas encore mesures."""

    def __init__(self, library, on_update):
        self._library = library
        self._on_update = on_update
        self._lock = threading.Lock()
        self._running = False

    def start(self):
        if not ffmpeg_path():
            return
        with self._lock:
            if self._running:
                return
            self._running = True
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            done = 0

            def work(track):
                nonlocal done
                try:
                    lufs, peak = measure(track["path"])
                except Exception:
                    lufs, peak = None, None
                # Illisible : on note -inf pour ne pas reessayer a chaque lancement.
                self._library.set_loudness(track["id"], lufs if lufs is not None else float("-inf"), peak)
                done += 1
                if done % 40 == 0:
                    self._on_update()

            todo = self._library.tracks_without_loudness()
            with ThreadPoolExecutor(max_workers=2) as pool:  # le PC reste fluide pendant la mesure
                list(pool.map(work, todo))
            if todo:
                self._on_update()
        finally:
            with self._lock:
                self._running = False
