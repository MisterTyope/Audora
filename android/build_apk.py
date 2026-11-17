"""Construit dist/Audora.apk sans Android Studio ni Gradle.

Etapes : ressources (aapt2) -> Java (javac) -> bytecode Android (d8) -> alignement
(zipalign) -> signature (apksigner). Outils attendus dans %LOCALAPPDATA%\\Audora-build
(JDK 17 + SDK Android en ligne de commande), ou via JAVA_HOME / ANDROID_SDK_ROOT.

La cle de signature (android/audora.keystore) est creee au premier lancement : il faut la
garder, Android refuse de mettre a jour une appli signee avec une autre cle.
"""

import glob
import json
import os
import shutil
import subprocess
import sys
import time
import zipfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BUILD = os.path.join(HERE, "build")
OUT = os.path.join(ROOT, "dist", "Audora.apk")
TOOLS = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Audora-build")
JDK = os.environ.get("JAVA_HOME") or os.path.join(TOOLS, "jdk")
SDK = os.environ.get("ANDROID_SDK_ROOT") or os.path.join(TOOLS, "android-sdk")
BUILD_TOOLS = sorted(glob.glob(os.path.join(SDK, "build-tools", "*")))[-1]
ANDROID_JAR = sorted(glob.glob(os.path.join(SDK, "platforms", "android-*", "android.jar")))[-1]
KEYSTORE = os.path.join(HERE, "audora.keystore")
KEY_ALIAS, KEY_PASS = "audora", "audora-local"
MIN_SDK, TARGET_SDK = 26, 34
VERSION_NAME = "1.3"

ICON_SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def run(*cmd):
    env = dict(os.environ, JAVA_HOME=JDK, PATH=os.path.join(JDK, "bin") + os.pathsep + os.environ.get("PATH", ""))
    result = subprocess.run([str(c) for c in cmd], env=env, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout, result.stderr, sep="\n")
        sys.exit(f"Echec : {os.path.basename(str(cmd[0]))}")
    return result.stdout


def tool(name):
    for ext in ("", ".exe", ".bat"):
        path = os.path.join(BUILD_TOOLS, name + ext)
        if os.path.exists(path):
            return path
    sys.exit(f"Outil introuvable : {name}")


def generate_icons(res_dir):
    """Icones du lanceur a partir de l'icone d'Audora (icon.ico)."""
    icon = Image.open(os.path.join(ROOT, "icon.ico"))
    icon.size = max(icon.info["sizes"])
    icon = icon.convert("RGBA")
    for density, size in ICON_SIZES.items():
        folder = os.path.join(res_dir, f"mipmap-{density}")
        os.makedirs(folder, exist_ok=True)
        icon.resize((size, size), Image.LANCZOS).save(os.path.join(folder, "ic_launcher.png"))


def main():
    shutil.rmtree(BUILD, ignore_errors=True)
    gen_res, gen_java = os.path.join(BUILD, "res-gen"), os.path.join(BUILD, "gen")
    classes, dex = os.path.join(BUILD, "classes"), os.path.join(BUILD, "dex")
    for d in (gen_res, gen_java, classes, dex, os.path.dirname(OUT)):
        os.makedirs(d, exist_ok=True)

    # Assets = android/assets + le code partage avec le PC (web/shared), copie dans www/shared.
    assets = os.path.join(BUILD, "assets")
    shutil.rmtree(assets, ignore_errors=True)
    shutil.copytree(os.path.join(HERE, "assets"), assets)
    shutil.copytree(os.path.join(ROOT, "web", "shared"), os.path.join(assets, "www", "shared"))

    print("Ressources…")
    generate_icons(gen_res)
    run(tool("aapt2"), "compile", "--dir", os.path.join(HERE, "res"), "-o", os.path.join(BUILD, "res.zip"))
    run(tool("aapt2"), "compile", "--dir", gen_res, "-o", os.path.join(BUILD, "res-gen.zip"))
    base_apk = os.path.join(BUILD, "base.apk")
    version_code = int(time.time() // 60)  # toujours croissant : chaque version s'installe par-dessus la precedente
    run(tool("aapt2"), "link", "-o", base_apk, "-I", ANDROID_JAR,
        "--manifest", os.path.join(HERE, "AndroidManifest.xml"), "-A", assets,
        "--java", gen_java, "--min-sdk-version", MIN_SDK, "--target-sdk-version", TARGET_SDK,
        "--version-code", version_code, "--version-name", VERSION_NAME, "--auto-add-overlay",
        os.path.join(BUILD, "res.zip"), os.path.join(BUILD, "res-gen.zip"))

    print("Compilation Java…")
    sources = glob.glob(os.path.join(HERE, "src", "**", "*.java"), recursive=True)
    sources += glob.glob(os.path.join(gen_java, "**", "*.java"), recursive=True)
    run(os.path.join(JDK, "bin", "javac"), "-encoding", "UTF-8", "-source", "11", "-target", "11",
        "-Xlint:-options", "-cp", ANDROID_JAR, "-d", classes, *sources)

    print("Conversion pour Android (d8)…")
    class_files = glob.glob(os.path.join(classes, "**", "*.class"), recursive=True)
    run(tool("d8"), "--release", "--min-api", MIN_SDK, "--lib", ANDROID_JAR, "--output", dex, *class_files)

    print("Assemblage…")
    unsigned = os.path.join(BUILD, "unsigned.apk")
    shutil.copy(base_apk, unsigned)
    with zipfile.ZipFile(unsigned, "a", zipfile.ZIP_DEFLATED) as apk:
        apk.write(os.path.join(dex, "classes.dex"), "classes.dex")
    aligned = os.path.join(BUILD, "aligned.apk")
    run(tool("zipalign"), "-f", "-p", "4", unsigned, aligned)

    print("Signature…")
    if not os.path.exists(KEYSTORE):
        run(os.path.join(JDK, "bin", "keytool"), "-genkeypair", "-keystore", KEYSTORE, "-alias", KEY_ALIAS,
            "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-storepass", KEY_PASS,
            "-keypass", KEY_PASS, "-dname", "CN=Audora")
    run(tool("apksigner"), "sign", "--ks", KEYSTORE, "--ks-key-alias", KEY_ALIAS,
        "--ks-pass", f"pass:{KEY_PASS}", "--key-pass", f"pass:{KEY_PASS}", "--out", OUT, aligned)
    run(tool("apksigner"), "verify", OUT)
    with open(os.path.splitext(OUT)[0] + ".json", "w", encoding="utf-8") as f:
        json.dump({"version_code": version_code, "version_name": VERSION_NAME}, f)  # lu par le PC (mises a jour)
    print(f"OK : {OUT} ({os.path.getsize(OUT) // 1024} Ko, version {version_code})")


if __name__ == "__main__":
    main()
