# Audora

Ta musique, à la façon de YouTube Music, sur ton PC Windows et ton téléphone Android.

- **Télécharge** des musiques et des vidéos depuis YouTube (recherche intégrée, aperçu de 30 s).
- **Écoute** ta bibliothèque : artistes, albums, playlists, mix du jour, radio, paroles synchronisées,
  volume égalisé, fondu enchaîné, mode Spatial, mini-lecteur flottant.
- **« Seulement la musique »** : coupe les blancs et les passages parlés des clips.
- **Téléphone** : appli Android synchronisée par le Wi-Fi de la maison, pour écouter hors ligne.

## Installer

1. Télécharge **`Audora-Setup-x.y.z.exe`** dans les [Releases](../../releases/latest).
2. Lance-le. Windows affichera sans doute « Windows a protégé votre ordinateur » (Audora n'est pas
   signé numériquement) : clique sur **Informations complémentaires**, puis **Exécuter quand même**.
3. Laisse ffmpeg et Node.js cochés (ils sont décochés d'office s'ils sont déjà sur ton PC).

Configuration : Windows 10 ou 11 (64 bits), 4 Go de RAM, environ 400 Mo d'espace disque.
Audora se met ensuite à jour tout seul.

## Construire depuis les sources

`build.bat` (Python 3.12, pip, Inno Setup ; JDK et SDK Android pour l'appli téléphone).
Tests : `tests.bat`.

## Licences

Code d'Audora : licence MIT (voir `LICENSE`). L'installateur embarque des logiciels tiers :
[ffmpeg](https://ffmpeg.org) (GPL, source : https://www.gyan.dev/ffmpeg/builds/ et https://github.com/FFmpeg/FFmpeg),
[Node.js](https://nodejs.org) (MIT), [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense),
[pywebview](https://github.com/r0x0r/pywebview) (BSD). Paroles : [LRCLIB](https://lrclib.net) ;
genres, années et pochettes : Deezer ; passages parlés : [SponsorBlock](https://sponsor.ajay.app).

Utilise Audora dans le respect des conditions d'utilisation de YouTube et des droits des artistes.
