import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]


def settings_value(expression: str, **env: str) -> subprocess.CompletedProcess:
    """Import the settings in a fresh interpreter, as a deploy would, with only `env` set."""
    clean = {k: v for k, v in os.environ.items() if not k.startswith(("DJANGO_", "RENDER_"))}
    return subprocess.run(
        [sys.executable, "-c", f"from config import settings; print({expression})"],
        cwd=BACKEND,
        env={**clean, **env},
        capture_output=True,
        text=True,
        check=False,
    )


def test_production_refuses_to_start_without_a_secret_key():
    result = settings_value("settings.DEBUG", DJANGO_DEBUG="0")
    assert result.returncode != 0
    assert "DJANGO_SECRET_KEY must be set" in result.stderr


def test_production_reads_hosts_and_trusts_the_proxy_for_https():
    result = settings_value(
        "settings.DEBUG, settings.ALLOWED_HOSTS, settings.SECURE_SSL_REDIRECT",
        DJANGO_DEBUG="0",
        DJANGO_SECRET_KEY="x" * 50,
        DJANGO_ALLOWED_HOSTS="api.example.com",
        RENDER_EXTERNAL_HOSTNAME="safe-route-api.onrender.com",
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == (
        "False ['api.example.com', 'safe-route-api.onrender.com'] True"
    )


def test_development_needs_no_environment():
    result = settings_value("settings.DEBUG, bool(settings.SECRET_KEY)")
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "True True"
