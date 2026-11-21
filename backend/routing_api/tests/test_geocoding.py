import httpx
import pytest
import respx
from django.conf import settings
from django.core.cache import cache

from routing_api.services import geocoding
from routing_api.services.errors import UpstreamError

PHOTON = f"{settings.PHOTON_URL}/api/"


def feature(lon, lat, **props):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": props,
    }


CHICAGO_IL = feature(
    -87.6244212,
    41.8755616,
    name="Chicago",
    state="Illinois",
    country="United States",
    countrycode="US",
    osm_value="city",
)
CHICAGO_ROAD_UK = feature(
    -0.12,
    51.5,
    name="Chicago Road",
    city="London",
    country="United Kingdom",
    countrycode="GB",
)
CHICAGO_HEIGHTS = feature(
    -87.635,
    41.506,
    name="Chicago Heights",
    county="Cook County",
    state="Illinois",
    country="United States",
    countrycode="US",
)


@pytest.fixture(autouse=True)
def clear_cache():
    cache.clear()
    yield
    cache.clear()


@respx.mock
def test_search_builds_labels_and_prefers_north_america():
    route = respx.get(PHOTON).mock(
        return_value=httpx.Response(
            200, json={"features": [CHICAGO_ROAD_UK, CHICAGO_IL, CHICAGO_HEIGHTS]}
        )
    )

    results = geocoding.search("chicago")

    assert results == [
        {
            "label": "Chicago, Illinois, United States",
            "name": "Chicago",
            "lat": 41.87556,
            "lon": -87.62442,
        },
        {
            "label": "Chicago Heights, Illinois, United States",
            "name": "Chicago Heights",
            "lat": 41.506,
            "lon": -87.635,
        },
        {
            "label": "Chicago Road, London, United Kingdom",
            "name": "Chicago Road",
            "lat": 51.5,
            "lon": -0.12,
        },
    ]
    request = route.calls.last.request
    assert request.url.params["q"] == "chicago"
    assert request.url.params["lang"] == "en"
    assert int(request.url.params["limit"]) > 5  # over-fetch so re-ranking has room
    assert request.headers["user-agent"] == settings.HTTP_USER_AGENT


@respx.mock
def test_search_truncates_dedupes_and_skips_unusable_features():
    address = feature(
        -104.99,
        39.74,
        housenumber="1600",
        street="Broadway",
        city="Denver",
        state="Colorado",
        country="United States",
        countrycode="US",
    )
    broken = {"type": "Feature", "geometry": None, "properties": {"name": "Nowhere"}}
    nameless = feature(1.0, 1.0, countrycode="US")
    respx.get(PHOTON).mock(
        return_value=httpx.Response(
            200, json={"features": [broken, CHICAGO_IL, CHICAGO_IL, nameless, address]}
        )
    )

    results = geocoding.search("chi", limit=2)

    assert [r["label"] for r in results] == [
        "Chicago, Illinois, United States",
        "1600 Broadway, Denver, Colorado, United States",
    ]


@respx.mock
def test_search_is_cached_per_normalized_query():
    route = respx.get(PHOTON).mock(
        return_value=httpx.Response(200, json={"features": [CHICAGO_IL]})
    )

    first = geocoding.search("Chicago")
    second = geocoding.search("  chicago ")

    assert first == second
    assert route.call_count == 1


def test_blank_query_makes_no_request():
    with respx.mock(assert_all_called=False) as mock:
        route = mock.get(PHOTON)
        assert geocoding.search("   ") == []
        assert route.call_count == 0


@respx.mock
@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(503, text="busy"),
        httpx.Response(200, text="<html>not json</html>"),
        httpx.Response(200, json={"features": "nope"}),
        httpx.ConnectTimeout("timed out"),
    ],
)
def test_upstream_failures_raise_upstream_error(response):
    if isinstance(response, Exception):
        respx.get(PHOTON).mock(side_effect=response)
    else:
        respx.get(PHOTON).mock(return_value=response)

    with pytest.raises(UpstreamError):
        geocoding.search("denver")


@respx.mock
def test_failures_are_not_cached():
    route = respx.get(PHOTON).mock(
        side_effect=[
            httpx.Response(500),
            httpx.Response(200, json={"features": [CHICAGO_IL]}),
        ]
    )
    with pytest.raises(UpstreamError):
        geocoding.search("chicago")
    assert geocoding.search("chicago")[0]["name"] == "Chicago"
    assert route.call_count == 2
