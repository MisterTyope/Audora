"""Prepare les programmes embarques dans Audora pour Windows (dossier vendor\\bin, non versionne) :

- ffmpeg.exe et ffprobe.exe : conversion en MP3, decoupe des blancs, mesure du volume ;
- node.exe : moteur JavaScript dont YouTube a besoin pour donner tous ses formats.

Ainsi Audora fonctionne sur n'importe quel PC, meme sans ces programmes installes.
On prend ceux de ce PC (installes par Chocolatey, winget ou a la main), en evitant les
petits "raccourcis" (shims) de Chocolatey qui ne marchent pas une fois copies ailleurs.
Lance par build.bat avant PyInstaller.
"""

import glob
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "vendor", "bin")
MIN_SIZE = 5 * 1024 * 1024  # un vrai ffmpeg/node fait des dizaines de Mo ; un shim, quelques Ko


def _candidates(name):
    local = os.environ.get("LOCALAPPDATA", "")
    programs = os.environ.get("ProgramFiles", r"C:\Program Files")
    patterns = {
        "ffmpeg": [r"C:\ProgramData\chocolatey\lib\ffmpeg*\tools\*\bin\{exe}",
                   os.path.join(local, r"Microsoft\WinGet\Packages\Gyan.FFmpeg*\*\bin\{exe}"),
                   r"C:\ffmpeg\bin\{exe}"],
        "node": [os.path.join(programs, r"nodejs\{exe}")],
    }
    family = "ffmpeg" if name in ("ffmpeg", "ffprobe") else name
    found = []
    for pattern in patterns[family]:
        found += glob.glob(pattern.format(exe=name + ".exe"))
    on_path = shutil.which(name)
    if on_path:
        found.append(on_path)
    return [p for p in found if os.path.getsize(p) > MIN_SIZE]


def _license(binary, family):
    folder = os.path.dirname(binary)
    for path in (os.path.join(folder, "LICENSE"), os.path.join(folder, "LICENSE.txt"),
                 os.path.join(os.path.dirname(folder), "LICENSE"), os.path.join(os.path.dirname(folder), "LICENSE.txt")):
        if os.path.exists(path):
            shutil.copy2(path, os.path.join(OUT, f"LICENCE-{family}.txt"))
            return


def main():
    os.makedirs(OUT, exist_ok=True)
    missing = []
    for name, family in (("ffmpeg", "ffmpeg"), ("ffprobe", "ffmpeg"), ("node", "node")):
        found = _candidates(name)
        if not found:
            missing.append(name)
            continue
        dest = os.path.join(OUT, name + ".exe")
        if not (os.path.exists(dest) and os.path.getsize(dest) == os.path.getsize(found[0])):
            shutil.copy2(found[0], dest)
        _license(found[0], family)
        print(f"{name:8} {found[0]}")
    node_licence = os.path.join(OUT, "LICENCE-node.txt")
    if not os.path.exists(node_licence):
        with open(node_licence, "w", encoding="utf-8") as f:
            f.write("Node.js est distribue sous licence MIT (Copyright OpenJS Foundation et contributeurs).\n"
                    "Texte complet : https://github.com/nodejs/node/blob/main/LICENSE\n")
    if missing:
        print("Introuvable sur ce PC : " + ", ".join(missing) + " (Audora utilisera ceux du PC ou il tourne).")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
