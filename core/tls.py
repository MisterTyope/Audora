"""Certificat du PC pour chiffrer la synchro avec le telephone (TLS).

Certificat auto-signe, cree une seule fois. Le telephone retient son empreinte SHA-256 a la
premiere connexion ("confiance au premier contact") et refuse ensuite tout autre certificat :
quelqu'un sur le Wi-Fi ne peut ni lire la synchro, ni se faire passer pour le PC.
"""

import datetime
import hashlib
import os
import ssl

from . import config

CERT_PATH = os.path.join(config.DATA_DIR, "synchro-certificat.pem")
KEY_PATH = os.path.join(config.DATA_DIR, "synchro-cle.pem")


def _create(common_name):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder()
            .subject_name(name).issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=365 * 30))
            .sign(key, hashes.SHA256()))
    os.makedirs(config.DATA_DIR, exist_ok=True)
    with open(KEY_PATH, "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                  serialization.NoEncryption()))
    with open(CERT_PATH, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))


def server_context(common_name="Audora"):
    """Contexte TLS du serveur de synchro (le certificat est cree au premier appel)."""
    if not (os.path.exists(CERT_PATH) and os.path.exists(KEY_PATH)):
        _create(common_name)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(CERT_PATH, KEY_PATH)
    return context


def fingerprint():
    """Empreinte SHA-256 du certificat (celle que le telephone retient)."""
    with open(CERT_PATH, encoding="ascii") as f:
        der = ssl.PEM_cert_to_DER_cert(f.read())
    return hashlib.sha256(der).hexdigest()
