"""Reglages communs des tests : tout se passe dans un dossier temporaire, jamais dans les
vraies donnees d'Audora (%LOCALAPPDATA%\\Audora) ni dans la vraie bibliotheque."""

import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    from core import config
    monkeypatch.setattr(config, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(config, "COVERS_DIR", str(tmp_path / "covers"))
    monkeypatch.setattr(config, "CONFIG_PATH", str(tmp_path / "config.json"))
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "library.db"))
    return tmp_path


@pytest.fixture
def library(data_dir):
    from core.library import Library
    return Library(str(data_dir / "library.db"))


class FakeConfig(dict):
    """Remplace core.config.Config : un simple dictionnaire."""

    def get(self, key, default=None):
        return dict.get(self, key, default)

    def set(self, key, value):
        self[key] = value


@pytest.fixture
def fake_config():
    return FakeConfig()


def add_track(library, folder, name, artist="Artiste", title=None, kind="audio"):
    """Ajoute un faux fichier a la bibliotheque (le contenu importe peu pour la plupart des tests)."""
    path = os.path.join(str(folder), name)
    with open(path, "wb") as f:
        f.write(b"\0" * 2048)
    return library.import_file(path, meta={"title": title or os.path.splitext(name)[0], "artist": artist,
                                           "album": "", "duration": 180})
