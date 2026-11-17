"""Mini-lecteur : une position retenue hors des ecrans (2e ecran debranche) n'est pas reutilisee."""

from types import SimpleNamespace

from core import mini


def test_position_hors_ecran_ignoree(monkeypatch):
    screens = [SimpleNamespace(x=0, y=0, width=1920, height=1080),
               SimpleNamespace(x=1920, y=0, width=1080, height=1920)]  # 2e ecran en portrait
    monkeypatch.setattr(mini.webview, "screens", screens)
    assert mini.MiniPlayer._visible(1500, 900, 390, 96)       # ecran principal
    assert mini.MiniPlayer._visible(2381, 1547, 390, 96)      # ecran en portrait, a droite
    assert not mini.MiniPlayer._visible(-1500, 300, 390, 96)  # ecran de gauche debranche
    assert not mini.MiniPlayer._visible(500, 5000, 390, 96)   # bien trop bas
