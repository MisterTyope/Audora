"""File de telechargements yt-dlp : un telechargement a la fois, progression en direct."""

import glob
import json
import os
import queue
import random
import re
import shutil
import threading
import time
import urllib.parse
import uuid

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadCancelled, download_range_func

from .config import YTDLP_BASE_OPTS
from . import trim
from .covers import make_cover
from .library import INCOMING_DIR_NAME
from .tags import embed_cover, write_tags
from .titles import clean_title, primary_artist_and_title, safe_filename, split_artist_title

# YouTube nous prend pour un robot : pauses de plus en plus longues (secondes), sans jamais abandonner.
BOT_PAUSES = (5 * 60, 10 * 60, 20 * 60, 30 * 60)
PACING = (4, 9)  # petite pause entre deux telechargements, pour ne pas enchainer les requetes
_SAVED_FIELDS = ("id", "url", "format", "quality", "playlist", "start", "end", "title", "thumb",
                 "for_phone", "status", "error", "created")
QUALITY_HEIGHTS = {"1080p": 1080, "720p": 720, "480p": 480, "360p": 360}
VIDEOS_FOLDER_NAME = "Vidéos"
_FINISHED = ("done", "error", "cancelled")


def is_youtube_url(url):
    return bool(re.match(r"^https?://([\w-]+\.)?(youtube\.com|youtu\.be)/\S+$", (url or "").strip()))


def is_bare_playlist(url):
    """.../playlist?list=... : yt-dlp telecharge toujours la playlist entiere."""
    return urllib.parse.urlparse(url).path.rstrip("/").endswith("/playlist")


def _video_format(quality):
    height = QUALITY_HEIGHTS.get(quality)
    if height:
        return (f"bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/"
                f"best[height<={height}][ext=mp4]/best[height<={height}]")
    return "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"


def _short_error(message):
    line = (message or "").strip().splitlines()[0] if message else "Erreur inconnue"
    line = re.sub(r"^ERROR:\s*", "", line)
    line = re.sub(r"^\[[\w:]+\]\s*[\w-]+:\s*", "", line)
    return line[:200]


def _is_bot_error(message):
    message = (message or "").lower()
    return "not a bot" in message or "sign in to confirm" in message or "429" in message


def _unique_path(folder, name, ext):
    candidate = os.path.join(folder, name + ext)
    n = 2
    while os.path.exists(candidate):
        candidate = os.path.join(folder, f"{name} ({n}){ext}")
        n += 1
    return candidate


class _CollectingLogger:
    def __init__(self):
        self.errors = []

    def debug(self, msg):
        pass

    def info(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
        self.errors.append(msg)


class DownloadManager:
    def __init__(self, library, get_config, emit, state_path=None):
        self._state_path = state_path  # la file est sauvegardee : rien n'est perdu en quittant
        self._blocked_until = 0.0
        self._block_count = 0
        self._library = library
        self._get_config = get_config
        self._emit = emit
        self._jobs = {}
        self._order = []
        self._cancel_events = {}
        self._last_emit = {}
        self._queue = queue.Queue()
        self._lock = threading.Lock()
        self._save_lock = threading.Lock()
        self._load()
        threading.Thread(target=self._worker, daemon=True).start()

    # --- API publique ---

    def add(self, url, format="mp3", quality="best", playlist=False, start=None, end=None, title=None, thumb=None,
            for_phone=False):
        url = (url or "").strip()
        if not is_youtube_url(url):
            raise ValueError("Ce lien n'est pas un lien YouTube.")
        if is_bare_playlist(url):
            playlist = True
        if start is not None and end is not None and float(end) <= float(start):
            raise ValueError("La fin de l'extrait doit être après le début.")

        job_id = uuid.uuid4().hex[:10]
        job = {
            "id": job_id, "url": url,
            "format": format if format in ("mp3", "mp4") else "mp3",
            "quality": quality, "playlist": bool(playlist),
            "start": start, "end": end,
            "title": title or url, "thumb": thumb,
            "status": "queued", "progress": 0.0, "detail": "En attente",
            "error": None, "created": time.time(), "for_phone": bool(for_phone),
        }
        with self._lock:
            self._jobs[job_id] = job
            self._order.append(job_id)
            self._cancel_events[job_id] = threading.Event()
        self._queue.put(job_id)
        self._publish(job, force=True)
        return dict(job)

    def list(self):
        with self._lock:
            return [dict(self._jobs[i]) for i in self._order]

    def active_count(self):
        with self._lock:
            return sum(1 for j in self._jobs.values() if j["status"] not in _FINISHED)

    def cancel(self, job_id):
        with self._lock:
            job = self._jobs.get(job_id)
            event = self._cancel_events.get(job_id)
        if not job or job["status"] in _FINISHED:
            return
        event.set()
        if job["status"] == "queued":
            job.update(status="cancelled", detail="Annulé")
            self._publish(job, force=True)
        else:
            job["detail"] = "Annulation…"
            self._publish(job, force=True)

    def retry(self, job_id):
        """Relance un telechargement (echoue, annule, bloque ou en pause) depuis le debut."""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise ValueError("Téléchargement introuvable")
            if job["status"] == "done":
                return dict(job)
            old = self._cancel_events.get(job_id)
            new_id = uuid.uuid4().hex[:10]
        self._blocked_until = 0.0  # "Relancer" = essayer tout de suite, meme pendant une pause
        if old:
            old.set()  # arrete l'essai en cours ou la pause, s'il y en a un
        if job["status"] in ("queued", "downloading", "processing"):
            job.update(status="cancelled", detail="Relancé")
        with self._lock:
            # nouvelle tache a la meme place dans la liste, l'ancienne disparait
            fresh = {k: job[k] for k in ("url", "format", "quality", "playlist", "start", "end", "title", "thumb", "for_phone")}
            fresh.update(id=new_id, status="queued", progress=0.0, detail="En attente", error=None, created=time.time())
            self._jobs[new_id] = fresh
            self._order[self._order.index(job_id)] = new_id
            del self._jobs[job_id]
            self._last_emit.pop(job_id, None)
            self._cancel_events[new_id] = threading.Event()
        self._emit("download_removed", job_id)
        self._queue.put(new_id)
        self._publish(fresh, force=True)
        return dict(fresh)

    def clear_finished(self):
        with self._lock:
            self._order = [i for i in self._order if self._jobs[i]["status"] not in _FINISHED]
            for job_id in list(self._jobs):
                if job_id not in self._order:
                    del self._jobs[job_id]
                    self._cancel_events.pop(job_id, None)
        self._save()
        return self.list()

    # --- Interne ---

    def _publish(self, job, force=False):
        if job["id"] not in self._jobs:
            return  # tache remplacee par "Relancer" : l'ancien essai se termine en silence
        now = time.monotonic()
        if not force and now - self._last_emit.get(job["id"], 0) < 0.25:
            return
        self._last_emit[job["id"]] = now
        self._emit("download", dict(job))
        if force:
            self._save()

    # --- Sauvegarde de la file ---

    def _save(self):
        if not self._state_path:
            return
        with self._lock:
            jobs = [{k: self._jobs[i].get(k) for k in _SAVED_FIELDS} for i in self._order
                    if self._jobs[i]["status"] not in ("done", "cancelled")]
        data = {"blocked_until": self._blocked_until, "block_count": self._block_count, "jobs": jobs}
        with self._save_lock:
            try:
                tmp = self._state_path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False)
                os.replace(tmp, self._state_path)
            except OSError:
                pass

    def _load(self):
        if not self._state_path or not os.path.exists(self._state_path):
            return
        try:
            with open(self._state_path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return
        self._blocked_until = float(data.get("blocked_until") or 0)
        self._block_count = int(data.get("block_count") or 0)
        for saved in data.get("jobs") or []:
            if not saved.get("id") or not is_youtube_url(saved.get("url")):
                continue
            job = {k: saved.get(k) for k in _SAVED_FIELDS}
            job.update(progress=0.0, created=job.get("created") or time.time())
            if job["status"] == "error":
                job["detail"] = "Échec"
            else:
                job.update(status="queued", error=None, detail="En attente (repris au démarrage)")
            self._jobs[job["id"]] = job
            self._order.append(job["id"])
            self._cancel_events[job["id"]] = threading.Event()
            if job["status"] == "queued":
                self._queue.put(job["id"])

    def _worker(self):
        while True:
            job_id = self._queue.get()
            with self._lock:
                job = self._jobs.get(job_id)
            if not job or job["status"] == "cancelled":
                continue
            try:
                while self._wait_if_blocked(job):
                    self._run(job)
                    if job["status"] == "error" and _is_bot_error(job.get("error")):
                        # YouTube nous prend pour un robot (trop de requetes) : toute la file
                        # patiente, de plus en plus longtemps, puis reprend toute seule.
                        self._block_count += 1
                        pause = BOT_PAUSES[min(self._block_count, len(BOT_PAUSES)) - 1]
                        self._blocked_until = time.time() + pause
                        job.update(status="queued", error=None, progress=0.0)
                        continue
                    if job["status"] == "done":
                        self._block_count = 0
                        if not self._queue.empty():
                            time.sleep(random.uniform(*PACING))
                    break
            except Exception as exc:  # filet de securite : le worker ne doit jamais mourir
                job.update(status="error", error=_short_error(str(exc)), detail="Échec")
                self._publish(job, force=True)

    def _wait_if_blocked(self, job):
        """Attend la fin d'une pause YouTube. False si la tache a ete annulee ou relancee entre-temps."""
        cancel = self._cancel_events[job["id"]]
        while time.time() < self._blocked_until and not cancel.is_set():
            resume = time.strftime("%H:%M", time.localtime(self._blocked_until))
            job["detail"] = f"YouTube demande une pause : reprise automatique vers {resume}"
            self._publish(job, force=True)
            cancel.wait(max(0.1, min(60, self._blocked_until - time.time())))
        if cancel.is_set():
            if job["status"] == "queued":
                job.update(status="cancelled", detail="Annulé")
                self._publish(job, force=True)
            return False
        return True

    def _run(self, job):
        root = self._get_config("library_folder")
        incoming = os.path.join(root, INCOMING_DIR_NAME, job["id"])
        os.makedirs(incoming, exist_ok=True)
        cancel = self._cancel_events[job["id"]]
        logger = _CollectingLogger()

        job.update(status="downloading", detail="Préparation…")
        self._publish(job, force=True)

        def progress_hook(d):
            if cancel.is_set():
                raise DownloadCancelled("Annule par l'utilisateur")
            info = d.get("info_dict") or {}
            if not job["playlist"] and info.get("title") and job["title"] == job["url"]:
                job["title"] = clean_title(info["title"])
            index = info.get("playlist_index") or 1
            count = info.get("n_entries") or 1
            prefix = f"Titre {index} sur {count}, " if job["playlist"] and count > 1 else ""

            if d["status"] == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate")
                fraction = (d.get("downloaded_bytes") or 0) / total if total else 0
                overall = ((index - 1) + fraction) / count if job["playlist"] else fraction
                job["status"] = "downloading"
                job["progress"] = min(overall, 0.99)
                speed = (d.get("_speed_str") or "").strip()
                job["detail"] = f"{prefix}{fraction * 100:.0f} %" + (f"  {speed}" if speed else "")
                self._publish(job)
            elif d["status"] == "finished":
                job["detail"] = f"{prefix}conversion…"
                self._publish(job, force=True)

        def postprocessor_hook(d):
            if d.get("status") == "started":
                job["status"] = "processing"
                self._publish(job)

        opts = {
            **YTDLP_BASE_OPTS,
            "outtmpl": os.path.join(incoming, "%(id)s.%(ext)s"),
            "progress_hooks": [progress_hook],
            "postprocessor_hooks": [postprocessor_hook],
            "noplaylist": not job["playlist"],
            "quiet": True, "no_warnings": True, "noprogress": True,
            "logger": logger,
        }
        if job["playlist"]:
            opts["ignoreerrors"] = True  # une video privee ne doit pas bloquer le reste
            # On espace les titres d'une playlist, sinon YouTube bloque au bout de quelques-uns.
            opts.update(sleep_interval=PACING[0], max_sleep_interval=PACING[1], sleep_interval_requests=0.75)
        if job["format"] == "mp3":
            # Meilleure piste audio de YouTube (Opus ~160 kbps en general), sans passer par la video.
            opts["format"] = "bestaudio[acodec=opus]/bestaudio/best"
            opts["postprocessors"] = [
                # "0" = MP3 VBR qualite maximale (~245 kbps) : la conversion ne perd plus rien d'audible.
                {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "0"},
            ]
        else:
            opts["format"] = _video_format(job["quality"])
            opts["merge_output_format"] = "mp4"
        if job["start"] is not None or job["end"] is not None:
            start = float(job["start"] or 0)
            end = float(job["end"]) if job["end"] is not None else float("inf")
            opts["download_ranges"] = download_range_func(None, [(start, end)])
            opts["force_keyframes_at_cuts"] = True

        try:
            with YoutubeDL(opts) as ydl:
                info = ydl.extract_info(job["url"], download=True)
                if info is None:
                    raise RuntimeError(logger.errors[0] if logger.errors else "Vidéo indisponible.")

                is_playlist_result = info.get("_type") == "playlist"
                items = [e for e in (info.get("entries") or []) if e] if is_playlist_result else [info]
                added_ids = []
                for entry in items:
                    path = self._final_path(entry, incoming)
                    if path:
                        added_ids.append(self._finalize(ydl, entry, path, job, root))

            if is_playlist_result and added_ids:
                self._library.create_playlist(info.get("title") or "Playlist YouTube", added_ids)
            if job["for_phone"] and added_ids:
                self._library.phone_add("track", added_ids)  # demande depuis le telephone : on l'y envoie

            if not added_ids:
                raise RuntimeError(logger.errors[0] if logger.errors else "Aucun fichier n'a été téléchargé.")

            skipped = len(set(logger.errors))
            if is_playlist_result:
                job["title"] = info.get("title") or job["title"]
                detail = f"{len(added_ids)} titres ajoutés, playlist créée"
                if skipped:
                    detail += f" ({skipped} indisponibles)"
            else:
                detail = "Ajouté à ta bibliothèque"
            if job.get("trimmed"):
                detail += f", {job['trimmed']} s de blancs ou paroles coupés"
            job.update(status="done", progress=1.0, detail=detail)
            self._publish(job, force=True)
            self._emit("library_changed", None)

        except DownloadCancelled:
            job.update(status="cancelled", detail="Annulé", progress=0.0)
            self._publish(job, force=True)
        except Exception as exc:
            job.update(status="error", error=_short_error(str(exc)), detail="Échec")
            self._publish(job, force=True)
        finally:
            shutil.rmtree(incoming, ignore_errors=True)
            try:
                os.rmdir(os.path.dirname(incoming))  # retire _incoming s'il est vide
            except OSError:
                pass

    @staticmethod
    def _final_path(entry, incoming):
        for download in entry.get("requested_downloads") or []:
            path = download.get("filepath")
            if path and os.path.exists(path):
                return path
        path = entry.get("filepath")
        if path and os.path.exists(path):
            return path
        # Repli : le fichier final porte l'ID de la video.
        candidates = [p for p in glob.glob(os.path.join(incoming, glob.escape(entry.get("id") or "?") + ".*"))
                      if not p.endswith((".part", ".ytdl", ".webp", ".jpg", ".png"))]
        return candidates[0] if candidates else None

    def _finalize(self, ydl, entry, path, job, root):
        """Deplace le fichier dans la bibliotheque, ecrit les tags et la pochette."""
        artists = entry.get("artists")
        artist_field = entry.get("artist") or (", ".join(artists) if artists else None)
        artist, title = split_artist_title(
            entry.get("title") or "",
            uploader=entry.get("uploader") or entry.get("channel"),
            artist=artist_field, track=entry.get("track"),
            known_artists=self._library.known_artist_keys(),
        )
        # Dossier = premier artiste ("Skrillex & Young Miko" -> "Skrillex"), les autres en "feat." dans le titre.
        artist, title = primary_artist_and_title(artist, title)
        artist = self._library.canonical_artist(artist)
        album = entry.get("album") or ""
        is_audio = job["format"] == "mp3"
        ext = os.path.splitext(path)[1]

        if is_audio:
            if self._get_config("organize_by_artist"):
                folder = os.path.join(root, safe_filename(artist, "Artiste inconnu"))
                name = safe_filename(title)
            else:
                folder, name = root, safe_filename(f"{artist} - {title}")
        else:
            folder = os.path.join(root, VIDEOS_FOLDER_NAME)
            name = safe_filename(clean_title(entry.get("title")) or title)

        # Seulement la musique : passages parles du clip et blancs coupes avant le rangement.
        duration = entry.get("duration")
        trim_state = None
        if (is_audio and ext.lower() == ".mp3" and self._get_config("trim_audio")
                and job["start"] is None and job["end"] is None and trim.ffmpeg_path()):
            try:
                found = trim.analyze(path, entry.get("id"))
                trim_state = "clean"
                if found["cuts"]:
                    cut_path = path + ".coupe.mp3"
                    duration = trim.apply_cuts(path, cut_path, found["cuts"], found["duration"])
                    os.replace(cut_path, path)
                    trim_state = "trimmed"
                    removed = round(sum(c["end"] - c["start"] for c in found["cuts"]))
                    job["trimmed"] = job.get("trimmed", 0) + removed
            except Exception:
                trim_state = None  # en cas de souci on garde le fichier entier, il sera propose plus tard

        os.makedirs(folder, exist_ok=True)
        dest = _unique_path(folder, name, ext)
        shutil.move(path, dest)

        cover = self._fetch_cover(ydl, entry, square=is_audio)
        try:
            write_tags(dest, title, artist, album)
            if cover:
                embed_cover(dest, cover)
        except Exception:
            pass

        track_id = self._library.import_file(
            dest,
            meta={
                "title": title, "artist": artist, "album": album,
                "duration": duration,
                "source_id": entry.get("id"),
                "source_url": entry.get("webpage_url"),
            },
            cover=(cover, "image/jpeg") if cover else None,
        )
        if trim_state and track_id:
            self._library.set_trim_state(track_id, trim_state)
        return track_id

    @staticmethod
    def _fetch_cover(ydl, entry, square):
        """Recupere la miniature ; en audio, recadree en carre comme une pochette d'album."""
        url = entry.get("thumbnail")
        if not url and entry.get("thumbnails"):
            url = entry["thumbnails"][-1].get("url")
        if not url:
            return None
        try:
            return make_cover(ydl.urlopen(url).read(), square=square)
        except Exception:
            return None
