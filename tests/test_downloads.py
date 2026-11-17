"""File de telechargement : sauvegarde, pause quand YouTube bloque, bouton Relancer.
Aucun vrai telechargement : `_run` est remplace par une fausse version."""

import json
import time

import pytest

from core import downloads


@pytest.fixture
def fake_run(monkeypatch):
    calls = []

    def run(self, job):
        calls.append(job["title"])
        blocked = len(calls) == 1  # le tout premier essai : YouTube bloque
        job.update(status="error" if blocked else "done",
                   error="Sign in to confirm you're not a bot" if blocked else None)
        self._publish(job, force=True)

    monkeypatch.setattr(downloads.DownloadManager, "_run", run)
    monkeypatch.setattr(downloads, "PACING", (0.01, 0.02))
    return calls


def wait(predicate, timeout=3):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if predicate():
                return True
        except (OSError, ValueError):
            pass  # fichier en train d'etre remplace : on reessaie
        time.sleep(0.02)
    return False


def test_blocage_youtube_pause_puis_relance(tmp_path, fake_run):
    state = tmp_path / "file.json"
    m = downloads.DownloadManager(None, lambda k: None, lambda *a: None, str(state))
    m.add("https://www.youtube.com/watch?v=aaaaaaaaaaa", title="A")
    m.add("https://www.youtube.com/watch?v=bbbbbbbbbbb", title="B")
    assert wait(lambda: "reprise automatique" in m.list()[0]["detail"])
    # Toute la file attend, rien n'est perdu : c'est ecrit dans le fichier.
    def saved():
        return json.loads(state.read_text(encoding="utf-8"))
    assert wait(lambda: saved()["blocked_until"] > time.time())
    assert [j["title"] for j in saved()["jobs"]] == ["A", "B"]

    # Audora redemarre : la file revient, toujours en pause.
    m2 = downloads.DownloadManager(None, lambda k: None, lambda *a: None, str(state))
    assert [j["status"] for j in m2.list()] == ["queued", "queued"]
    # "Relancer" : on n'attend plus.
    m2.retry(m2.list()[0]["id"])
    assert wait(lambda: all(j["status"] == "done" for j in m2.list()))
    assert len(m2.list()) == 2


def test_echec_garde_pour_plus_tard(tmp_path, monkeypatch):
    def run(self, job):
        job.update(status="error", error="Vidéo indisponible")
        self._publish(job, force=True)
    monkeypatch.setattr(downloads.DownloadManager, "_run", run)
    state = tmp_path / "file.json"
    m = downloads.DownloadManager(None, lambda k: None, lambda *a: None, str(state))
    m.add("https://www.youtube.com/watch?v=ccccccccccc", title="C")
    assert wait(lambda: m.list()[0]["status"] == "error")
    m2 = downloads.DownloadManager(None, lambda k: None, lambda *a: None, str(state))
    assert m2.list()[0]["status"] == "error"  # visible au redemarrage, avec le bouton Relancer


def test_lien_non_youtube_refuse(tmp_path):
    m = downloads.DownloadManager(None, lambda k: None, lambda *a: None, str(tmp_path / "f.json"))
    with pytest.raises(ValueError):
        m.add("https://exemple.com/video")
