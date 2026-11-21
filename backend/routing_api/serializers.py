from __future__ import annotations

from rest_framework import serializers

from .services.geo import haversine_mi

MIN_TRIP_MI = 1.0


class NumberField(serializers.FloatField):
    """FloatField that refuses booleans, which DRF would otherwise read as 0 and 1."""

    def to_internal_value(self, data):
        if isinstance(data, bool):
            self.fail("invalid")
        return super().to_internal_value(data)


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
