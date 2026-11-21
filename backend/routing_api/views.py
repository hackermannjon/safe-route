from functools import wraps

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.exceptions import ParseError
from rest_framework.response import Response

from .serializers import (
    GeocodeQuerySerializer,
    HeatmapRequestSerializer,
    PlanRequestSerializer,
    first_error,
)
from .services import geocoding, planner
from .services.errors import UpstreamError, ValidationProblem
from .services.heatmap import corridor_heatmap
from .services.types import Place


def _error(message: str, field: str | None, code: int) -> Response:
    body = {"error": message}
    if field:
        body["field"] = field
    return Response(body, status=code)


def _invalid(serializer) -> Response:
    message, field = first_error(serializer.errors)
    return _error(message, field, status.HTTP_400_BAD_REQUEST)


def api_errors(view):
    """Map service failures onto the API's single error shape."""

    @wraps(view)
    def wrapper(request, *args, **kwargs):
        try:
            return view(request, *args, **kwargs)
        except ParseError:
            return _error("Request body must be valid JSON.", None, status.HTTP_400_BAD_REQUEST)
        except ValidationProblem as exc:
            return _error(exc.message, exc.field, status.HTTP_400_BAD_REQUEST)
        except UpstreamError as exc:
            return _error(exc.message, None, status.HTTP_502_BAD_GATEWAY)

    return wrapper


@api_view(["GET"])
def health(request):
    return Response({"status": "ok"})


@api_view(["GET"])
@api_errors
def geocode(request):
    query = GeocodeQuerySerializer(data=request.query_params)
    if not query.is_valid():
        return _invalid(query)
    return Response({"results": geocoding.search(query.validated_data["q"])})


@api_view(["POST"])
@api_errors
def plan(request):
    payload = PlanRequestSerializer(data=request.data)
    if not payload.is_valid():
        return _invalid(payload)
    data = payload.validated_data
    result = planner.plan_trip(
        origin=Place(**data["origin"]),
        destination=Place(**data["destination"]),
        departure=data["departure"],
        spacing_mi=data["spacing_mi"],
        cargo_lb=data["cargo_lb"],
    )
    return Response(result)


@api_view(["POST"])
@api_errors
def heatmap(request):
    payload = HeatmapRequestSerializer(data=request.data)
    if not payload.is_valid():
        return _invalid(payload)
    data = payload.validated_data
    result = corridor_heatmap(
        routes=data["routes"], departure=data["departure"], cargo_lb=data["cargo_lb"]
    )
    return Response(result)
