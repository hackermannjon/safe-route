class UpstreamError(Exception):
    """An external service failed, timed out or returned something unusable (maps to 502)."""

    def __init__(self, message: str = "An external service is unavailable. Try again shortly."):
        super().__init__(message)
        self.message = message


class WeatherQuotaSpent(UpstreamError):
    """The server's own forecast allowance is spent (Open-Meteo meters it per IP address).

    `requests` are the forecast URLs the request still needs. A client on another connection has
    its own allowance: it can fetch them and send the answers back with the same request.
    """

    def __init__(self, message: str, requests: list[str] | None = None):
        super().__init__(message)
        self.requests = requests or []


class ValidationProblem(Exception):
    """The request is well-formed but cannot be served as asked (maps to 400)."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.message = message
        self.field = field
