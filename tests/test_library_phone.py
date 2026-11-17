"""Bibliotheque (base de donnees) et synchro avec le telephone, dans un dossier temporaire."""

import json
import socket
import sqlite3
import ssl
import time
import urllib.error
import urllib.request

import pytest

from conftest import add_track


def test_ancienne_base_mise_a_jour_sans_perte(data_dir):
    """Une base d'une ancienne version (sans les nouvelles colonnes) s'ouvre et garde ses titres."""
    path = data_dir / "library.db"
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE tracks (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE NOT NULL, title TEXT,
            artist TEXT, album TEXT, duration REAL, kind TEXT, cover TEXT, source_id TEXT, source_url TEXT,
            added_at REAL, play_count INTEGER DEFAULT 0, last_played REAL);
        INSERT INTO tracks (path, title, artist, kind, play_count) VALUES ('C:/x.mp3', 'Ancien', 'Moi', 'audio', 7);
    """)
    db.commit()
    db.close()
    from core.library import Library
    lib = Library(str(path))
    columns = {r[1] for r in lib._db.execute("PRAGMA table_info(tracks)")}
    assert {"genre_override", "trim_state", "cover_checked", "loudness", "sample_peak"} <= columns
    track = lib._one("SELECT title, play_count FROM tracks")
    assert (track["title"], track["play_count"]) == ("Ancien", 7)


def test_paroles_et_volume_dans_le_manifeste(library, data_dir):
    track_id = add_track(library, data_dir, "a.mp3", artist="Queen", title="Bohemian Rhapsody")
    library.phone_add("track", [track_id])
    library.set_loudness(track_id, -8.0, 1.0)
    library.set_lyrics(track_id, "[00:01.00] Is this the real life?", "Is this the real life?")
    track = library.phone_manifest()["tracks"][0]
    assert track["gain"] == -6.0
    assert track["lyrics"] > 0
    assert library.get_lyrics(track_id)["synced"].startswith("[00:01.00]")
    # Fichier recoupe : le volume sera remesure.
    library.set_trim_state(track_id, "trimmed", 170)
    assert library.list_tracks()[0]["gain"] is None


@pytest.fixture
def sync(library, data_dir, fake_config, monkeypatch):
    from core import phone, tls
    monkeypatch.setattr(tls, "CERT_PATH", str(data_dir / "cert.pem"))
    monkeypatch.setattr(tls, "KEY_PATH", str(data_dir / "key.pem"))
    with socket.socket() as s:  # port libre pour le test
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    monkeypatch.setattr(phone, "SYNC_PORT", port)
    ps = phone.PhoneSync(library, fake_config, lambda *a: None)
    ps.set_enabled(True)
    time.sleep(0.2)
    yield ps, port
    ps.stop()


def _call(port, path, scheme="https", data=None, token=None):
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    request = urllib.request.Request(f"{scheme}://127.0.0.1:{port}{path}",
                                     data=json.dumps(data).encode() if data is not None else None,
                                     headers={"Authorization": f"Bearer {token}"} if token else {})
    try:
        with urllib.request.urlopen(request, context=context if scheme == "https" else None, timeout=5) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, None


def test_synchro_chiffree_et_association(sync):
    ps, port = sync
    status, hello = _call(port, "/sync/hello", scheme="http")
    assert status == 200 and hello["tls"] is True
    code = ps.start_pairing()["pairing"]["code"]
    assert _call(port, "/sync/pair", data={"code": "000000" if code != "000000" else "111111"})[0] == 403
    status, paired = _call(port, "/sync/pair", data={"code": code, "name": "Test"})
    assert status == 200
    token = paired["token"]
    assert _call(port, "/sync/manifest", token=token)[0] == 200
    # Ce telephone a chiffre une fois : en clair, c'est refuse.
    assert _call(port, "/sync/manifest", scheme="http", token=token)[0] == 401
    assert _call(port, "/sync/manifest", token="mauvais-jeton")[0] == 401


def test_toutes_les_playlists_automatiquement(sync, library, data_dir):
    ps, _ = sync
    t1 = add_track(library, data_dir, "1.mp3")
    t2 = add_track(library, data_dir, "2.mp3")
    p1 = library.create_playlist("Rock", [t1])
    ps.set_all_playlists(True)
    p2 = library.create_playlist("Nouvelle", [t2])
    manifest = ps.manifest()  # la nouvelle playlist part aussi
    assert {p["id"] for p in manifest["playlists"]} == {p1, p2}
    assert {t["id"] for t in manifest["tracks"]} == {t1, t2}
    # Retiree a la main : elle ne revient pas toute seule.
    library.phone_remove("playlist", [p2])
    ps.note_playlists([p2], sent=False)
    assert {p["id"] for p in ps.manifest()["playlists"]} == {p1}


def test_playlist_creee_sur_le_telephone(sync, library, data_dir):
    ps, _ = sync
    t1 = add_track(library, data_dir, "1.mp3")
    ps._apply_playlist_ops([{"op": "create", "temp_id": -5, "name": "Du tel", "track_ids": [t1]},
                            {"op": "update", "id": -5, "name": "Du tel 2"}])
    playlists = library.list_playlists()
    assert [(p["name"], p["track_ids"]) for p in playlists] == [("Du tel 2", [t1])]
