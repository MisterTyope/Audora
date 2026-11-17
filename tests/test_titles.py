"""Nettoyage des titres YouTube : seulement le titre, et l'artiste principal."""

import pytest

from core import titles


@pytest.mark.parametrize("raw, expected", [
    ("Skrillex & Young Miko - Bad Bunny (Official Music Video)", ("Skrillex", "Bad Bunny")),
    ("Eminem - Lose Yourself [HD]", ("Eminem", "Lose Yourself")),
    ("Stromae - Alors on danse (Clip officiel)", ("Stromae", "Alors on danse")),
    ("French Montana - Writing on the Wall ft. Post Malone, Cardi B, Rvssian", ("French Montana", "Writing on the Wall")),
    ("Queen – Bohemian Rhapsody (Official Video Remastered)", ("Queen", "Bohemian Rhapsody")),
    ("Daft Punk | One More Time", ("Daft Punk", "One More Time")),
    ('Linkin Park "Numb" (Official Video)', ("Linkin Park", "Numb")),
    ("Stromae « Papaoutai » (Clip officiel)", ("Stromae", "Papaoutai")),
    ("Need for Speed Most Wanted Soundtrack - Static-X - Skinnyman", ("Static-X", "Skinnyman")),
    ("Post Malone - Circles", ("Post Malone", "Circles")),
])
def test_artiste_et_titre(raw, expected):
    artist, title = titles.split_artist_title(raw, uploader="Une chaîne")
    assert titles.primary_artist_and_title(artist, title) == expected


def test_titre_a_l_envers_reconnu_grace_aux_artistes_connus():
    known = {titles._key("Green Day")}
    assert titles.split_artist_title("Basket Case - Green Day", known_artists=known) == ("Green Day", "Basket Case")


def test_youtube_music_donne_directement_artiste_et_morceau():
    assert titles.split_artist_title("n'importe quoi", artist="Nirvana", track="Lithium (Remastered)")[0] == "Nirvana"


def test_sans_separateur_on_prend_la_chaine():
    artist, title = titles.split_artist_title("Mon morceau", uploader="Queen Official")
    assert title == "Mon morceau"
    assert artist == "Queen"


@pytest.mark.parametrize("names, expected", [
    ("Skrillex & Young Miko", ("Skrillex", ["Young Miko"])),
    ("Earth, Wind & Fire", ("Earth, Wind & Fire", [])),  # groupe connu : pas coupe
])
def test_artistes_multiples(names, expected):
    assert titles.split_artists(names) == expected


def test_nom_de_fichier_sans_caracteres_interdits():
    assert titles.safe_filename('AC/DC: "Back" <In> Black?') == "ACDC Back In Black"
    assert titles.safe_filename("   ") == "Sans titre"
