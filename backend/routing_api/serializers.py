from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from .services.geo import haversine_mi

SPACING_CHOICES = (10, 25, 50)
# The US federal gross weight limit; no legal load on a tractor-trailer can weigh more.
MAX_CARGO_LB = 80_000
# Departures slightly in the past are allowed so a driver can plan a trip already under way.
DEPARTURE_GRACE = timedelta(hours=1)
# Weather forecasts are dependable for about a week; beyond that the plan would be guesswork.
DEPARTURE_HORIZON = timedelta(days=7)
MIN_TRIP_MI = 1.0


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


def check_departure(value):
    now = timezone.now()
    if value < now - DEPARTURE_GRACE:
        raise serializers.ValidationError("Departure cannot be more than 1 hour in the past.")
    if value > now + DEPARTURE_HORIZON:
        raise serializers.ValidationError(
            "Departure must be within the next 7 days (weather forecast range)."
        )
    return value


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
