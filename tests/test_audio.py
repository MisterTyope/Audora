"""« Seulement la musique » (decoupe) et volume egalise : les calculs, sans fichier audio."""

import math

from core import loudness, trim

INF = float("inf")


def test_blancs_au_debut_et_a_la_fin_coupes_en_gardant_un_peu():
    cuts = trim.plan_cuts(200, [], [(0.0, 3.0), (195.0, INF)])
    assert cuts == [(0.0, 2.7, "silence_start"), (195.3, 200, "silence_end")]


def test_petits_blancs_gardes():
    assert trim.plan_cuts(200, [], [(0.0, 1.0), (199.0, INF)]) == []  # moins de 2 s : naturel


def test_blanc_au_milieu_seulement_s_il_est_long():
    assert trim.plan_cuts(200, [], [(100.0, 102.0)]) == []
    assert trim.plan_cuts(200, [], [(100.0, 110.0)]) == [(100.75, 109.25, "silence")]


def test_passage_parle_fusionne_avec_le_blanc_qui_le_suit():
    # Intro parlee 0-40 s, puis 2 s de blanc avant la musique : tout part, sauf 0,3 s.
    cuts = trim.plan_cuts(300, [(0.0, 40.0, "music_offtopic")], [(39.0, 42.0)])
    assert cuts == [(0.0, 41.7, "music_offtopic")]
    # Pareil a la fin : generique coupe, le blanc juste avant aussi.
    cuts = trim.plan_cuts(300, [(270.0, 300.0, "outro")], [(267.0, 270.5)])
    assert cuts == [(267.3, 300, "outro")]


def test_jamais_trop_couper():
    # 70 % du titre : quelque chose cloche (mauvais signalement) -> on ne touche a rien.
    assert trim.plan_cuts(100, [(0.0, 70.0, "music_offtopic")], []) == []
    # Il resterait moins de 30 s.
    assert trim.plan_cuts(50, [(0.0, 25.0, "intro")], []) == []


def test_gain_volume_egalise():
    assert loudness.gain_db(None, None) is None
    assert loudness.gain_db(-80, 0) is None  # silence ou fichier illisible
    assert loudness.gain_db(-8.0, 1.5) == -6.0  # trop fort : baisse
    assert loudness.gain_db(-20.0, -10.0) == 6.0  # trop faible, de la marge : monte
    # Trop faible mais pics deja hauts : on monte, sans demander plus de 6 dB au limiteur.
    assert loudness.gain_db(-20.0, -0.5) == 5.5
    assert loudness.gain_db(-40.0, -30.0) == loudness.MAX_BOOST


def test_gain_jamais_negatif_pour_un_titre_trop_faible():
    gain = loudness.gain_db(-16.0, 6.0)  # pics tres hauts (fichier sature)
    assert gain >= 0 and not math.isnan(gain)
