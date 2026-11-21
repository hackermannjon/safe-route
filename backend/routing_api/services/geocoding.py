"""Place search backed by Photon (OpenStreetMap data)."""

from __future__ import annotations

import hashlib

import httpx
from django.conf import settings
from django.core.cache import cache

from .errors import UpstreamError

CACHE_TTL_S = 24 * 60 * 60
PREFERRED_COUNTRIES = ("US", "CA", "MX")
TIMEOUT = httpx.Timeout(20.0, connect=5.0)
# Ask for extra candidates so North American hits survive re-ranking and de-duplication.
OVERFETCH = 5


def search(query: str, limit: int = 5) -> list[dict]:
    normalized = " ".join(query.split())
    if not normalized:
        return []
    digest = hashlib.sha1(normalized.lower().encode()).hexdigest()
    key = f"geocode:v1:{digest}:{limit}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    results = _rank(_fetch(normalized, limit + OVERFETCH), limit)
    cache.set(key, results, CACHE_TTL_S)
    return results


def _fetch(query: str, limit: int) -> list[dict]:
    try:
        response = httpx.get(
            f"{settings.PHOTON_URL.rstrip('/')}/api/",
            params={"q": query, "limit": limit, "lang": "en"},
            headers={"User-Agent": settings.HTTP_USER_AGENT},
            timeout=TIMEOUT,
        )
        response.raise_for_status()
        features = response.json().get("features", [])
    except (httpx.HTTPError, ValueError, AttributeError) as exc:
        raise UpstreamError("Place search is unavailable right now. Try again shortly.") from exc
    if not isinstance(features, list):
        raise UpstreamError("Place search returned an unexpected response.")
    return features


def _rank(features: list[dict], limit: int) -> list[dict]:
    preferred: list[dict] = []
    others: list[dict] = []
    seen: set[str] = set()
    for feature in features:
        place = _to_place(feature)
        if place is None or place["label"] in seen:
            continue
        seen.add(place["label"])
        country = (feature.get("properties") or {}).get("countrycode", "").upper()
        (preferred if country in PREFERRED_COUNTRIES else others).append(place)
    # Stable partition keeps Photon's relevance order within each group.
    return (preferred + others)[:limit]


def _to_place(feature: dict) -> dict | None:
    props = feature.get("properties") or {}
    try:
        lon, lat = feature["geometry"]["coordinates"][:2]
        lat, lon = float(lat), float(lon)
    except (KeyError, TypeError, ValueError):
        return None

    street = " ".join(p for p in (props.get("housenumber"), props.get("street")) if p)
    name = props.get("name") or street or props.get("city") or props.get("county")
    if not name:
        return None

    parts = [name]
    for part in (props.get("city"), props.get("state"), props.get("country")):
        if part and part not in parts:
            parts.append(part)
    return {"label": ", ".join(parts), "name": name, "lat": round(lat, 5), "lon": round(lon, 5)}
