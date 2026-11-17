"""Mise a jour d'Audora : detection d'une nouvelle version et verification de l'installateur.
GitHub est simule par un petit serveur local."""

import hashlib
import http.server
import threading

import pytest

from core import updater


@pytest.fixture
def fake_github(tmp_path, monkeypatch):
    payload = b"faux installateur"
    files = {"/Audora-Setup-9.0.0.exe": payload,
             "/Audora-Setup-9.0.0.exe.sha256": hashlib.sha256(payload).hexdigest().encode() + b"  Audora-Setup-9.0.0.exe\n"}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = files.get(self.path)
            self.send_response(200 if body else 404)
            self.end_headers()
            self.wfile.write(body or b"")

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    release = {"tag_name": "v9.0.0", "body": "Nouveautés", "assets": [
        {"name": "Audora-Setup-9.0.0.exe", "browser_download_url": base + "/Audora-Setup-9.0.0.exe"},
        {"name": "Audora-Setup-9.0.0.exe.sha256", "browser_download_url": base + "/Audora-Setup-9.0.0.exe.sha256"}]}
    monkeypatch.setattr(updater, "UPDATE_REPO", "test/audora")
    monkeypatch.setattr(updater, "_get_json", lambda url: release)
    monkeypatch.setattr(updater, "UPDATES_DIR", str(tmp_path))
    launched = []
    monkeypatch.setattr(updater.subprocess, "Popen", lambda args, **kw: launched.append(args))
    yield release, files, launched
    server.shutdown()


def test_nouvelle_version_detectee(fake_github):
    info = updater.latest()
    assert info["version"] == "9.0.0" and info["name"] == "Audora-Setup-9.0.0.exe"


def test_pas_de_mise_a_jour_vers_une_version_plus_ancienne(fake_github, monkeypatch):
    release, _, _ = fake_github
    release["tag_name"] = "v0.1.0"
    assert updater.latest() is None


def test_installateur_verifie_puis_lance(fake_github):
    _, _, launched = fake_github
    u = updater.Updater(lambda info: None)
    u.available = updater.latest()
    quit_called = []
    assert u.install(lambda: quit_called.append(True))
    assert launched and launched[0][1:] == ["/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART"]
    assert quit_called


def test_installateur_abime_refuse(fake_github):
    _, files, launched = fake_github
    files["/Audora-Setup-9.0.0.exe"] = b"fichier modifie en route"
    u = updater.Updater(lambda info: None)
    u.available = updater.latest()
    with pytest.raises(ValueError):
        u.install(lambda: None)
    assert not launched  # rien n'est lance
