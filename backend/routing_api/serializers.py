from __future__ import annotations

import math
from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from .services.geo import haversine_mi

SPACING_CHOICES = (10, 25, 50)
# The US federal gross weight limit; no legal load on a tractor-trailer can weigh more.
MAX_CARGO_LB = 80_000
# Departures slightly in the past are allowed so a driver can plan a trip already under way.
DEPARTURE_GRACE = timedelta(hours=1)
# The weather map is asked for after the plan, often much later: a plan left on screen must not
# lose its map once its departure time passes. The forecast still serves recent hours.
HEATMAP_DEPARTURE_GRACE = timedelta(hours=12)
# Weather forecasts are dependable for about a week; beyond that the plan would be guesswork.
DEPARTURE_HORIZON = timedelta(days=7)
MIN_TRIP_MI = 1.0
# A plan has at most three routes, each simplified to about 1,500 points.
MAX_HEATMAP_ROUTES = 3
MAX_ROUTE_POINTS = 5_000
# A plan needs at most 350 forecast cells and a weather map 250, at 100 per lookup.
MAX_RELAYED_LOOKUPS = 8


class NumberField(serializers.FloatField):
    """FloatField that refuses booleans, which DRF would otherwise read as 0 and 1."""

    def to_internal_value(self, data):
        if isinstance(data, bool):
            self.fail("invalid")
        return super().to_internal_value(data)


def departure_field() -> serializers.DateTimeField:
    return serializers.DateTimeField(
        error_messages={
            "required": "Choose a departure date and time.",
            "null": "Choose a departure date and time.",
            "invalid": "Departure must be an ISO 8601 date and time.",
        }
    )


def cargo_field() -> NumberField:
    return NumberField(
        min_value=0,
        max_value=MAX_CARGO_LB,
        error_messages={
            "required": "Enter the cargo weight.",
            "null": "Enter the cargo weight.",
            "invalid": "Cargo weight must be a number.",
            "min_value": "Cargo weight cannot be negative.",
            "max_value": "Cargo weight cannot exceed 80,000 lb.",
        },
    )


def check_departure(value, grace: timedelta = DEPARTURE_GRACE):
    now = timezone.now()
    if value < now - grace:
        hours = round(grace.total_seconds() / 3600)
        unit = "hour" if hours == 1 else "hours"
        raise serializers.ValidationError(
            f"Departure cannot be more than {hours} {unit} in the past."
        )
    if value > now + DEPARTURE_HORIZON:
        raise serializers.ValidationError(
            "Departure must be within the next 7 days (weather forecast range)."
        )
    return value


def relayed_weather_field() -> serializers.ListField:
    """Forecasts the client fetched itself after a 502 listed `weather_requests`.

    Only the outer shape is checked here; `weather.relayed` reads each answer.
    """
    return serializers.ListField(
        child=serializers.DictField(),
        required=False,
        max_length=MAX_RELAYED_LOOKUPS,
        error_messages={"max_length": "Too many forecasts were sent with the request."},
    )


def whole_pounds(value: float) -> float:
    # Whole pounds read back as ints, so responses echo 42000 rather than 42000.0.
    return int(value) if value.is_integer() else value


class PlaceSerializer(serializers.Serializer):
    lat = NumberField(
        min_value=-90,
        max_value=90,
        error_messages={
            "min_value": "Latitude must be between -90 and 90.",
            "max_value": "Latitude must be between -90 and 90.",
            "invalid": "Latitude must be a number.",
            "null": "Latitude must be a number.",
        },
    )
    lon = NumberField(
        min_value=-180,
        max_value=180,
        error_messages={
            "min_value": "Longitude must be between -180 and 180.",
            "max_value": "Longitude must be between -180 and 180.",
            "invalid": "Longitude must be a number.",
            "null": "Longitude must be a number.",
        },
    )
    label = serializers.CharField(required=False, allow_blank=True, max_length=200, default="")


class PlanRequestSerializer(serializers.Serializer):
    origin = PlaceSerializer(
        error_messages={"required": "Choose an origin.", "null": "Choose an origin."}
    )
    destination = PlaceSerializer(
        error_messages={"required": "Choose a destination.", "null": "Choose a destination."}
    )
    departure = departure_field()
    cargo_lb = cargo_field()
    spacing_mi = serializers.ChoiceField(
        choices=SPACING_CHOICES,
        error_messages={
            "required": "Choose a checkpoint spacing.",
            "null": "Choose a checkpoint spacing.",
            "invalid_choice": "Checkpoint spacing must be 10, 25 or 50 miles.",
        },
    )
    weather = relayed_weather_field()

    def validate_departure(self, value):
        return check_departure(value)

    def validate_cargo_lb(self, value):
        return whole_pounds(value)

    def validate_spacing_mi(self, value):
        # ChoiceField matches "25" and 25 alike; hand the service a real int.
        return int(value)

    def validate(self, attrs):
        origin, destination = attrs["origin"], attrs["destination"]
        distance = haversine_mi(
            (origin["lat"], origin["lon"]), (destination["lat"], destination["lon"])
        )
        if distance <= MIN_TRIP_MI:
            raise serializers.ValidationError(
                {"destination": "Origin and destination must be more than 1 mile apart."}
            )
        return attrs


class RouteLinesField(serializers.Field):
    """The plan's route geometries: GeoJSON [lon, lat] pairs, converted to (lat, lon)."""

    default_error_messages = {
        "required": "Send the planned routes.",
        "null": "Send the planned routes.",
        "invalid": "Each route must be a list of at least 2 [longitude, latitude] points.",
        "count": f"Send between 1 and {MAX_HEATMAP_ROUTES} routes.",
        "size": f"A route can have at most {MAX_ROUTE_POINTS:,} points.",
        "range": "Route points must be valid longitudes and latitudes.",
    }

    def to_internal_value(self, data):
        # Thousands of points: checked in plain Python rather than one DRF field per number.
        if not isinstance(data, list) or not 1 <= len(data) <= MAX_HEATMAP_ROUTES:
            self.fail("count")
        lines = []
        for line in data:
            if not isinstance(line, list) or len(line) < 2:
                self.fail("invalid")
            if len(line) > MAX_ROUTE_POINTS:
                self.fail("size")
            points = []
            for point in line:
                if not (isinstance(point, list) and len(point) == 2 and all(map(_finite, point))):
                    self.fail("invalid")
                lon, lat = point
                if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                    self.fail("range")
                points.append((float(lat), float(lon)))
            lines.append(points)
        return lines


def _finite(value) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


class HeatmapRequestSerializer(serializers.Serializer):
    departure = departure_field()
    cargo_lb = cargo_field()
    routes = RouteLinesField()
    weather = relayed_weather_field()

    def validate_departure(self, value):
        return check_departure(value, HEATMAP_DEPARTURE_GRACE)

    def validate_cargo_lb(self, value):
        return whole_pounds(value)


class GeocodeQuerySerializer(serializers.Serializer):
    q = serializers.CharField(
        min_length=2,
        max_length=200,
        trim_whitespace=True,
        error_messages={
            "required": "Enter at least 2 characters to search.",
            "blank": "Enter at least 2 characters to search.",
            "min_length": "Enter at least 2 characters to search.",
            "max_length": "Search text is too long.",
        },
    )


def first_error(errors) -> tuple[str, str | None]:
    """Flatten DRF's nested error dict to one message and a dotted field path for the UI."""
    path: list[str] = []
    node = errors
    while True:
        if isinstance(node, dict):
            key, node = next(iter(node.items()))
            if key != "non_field_errors":
                path.append(str(key))
        elif isinstance(node, list) and node and not isinstance(node[0], str):
            node = node[0]
        else:
            break
    message = str(node[0]) if isinstance(node, list) and node else str(node)
    return message, ".".join(path) or None
