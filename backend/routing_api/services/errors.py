class UpstreamError(Exception):
    """An external service failed, timed out or returned something unusable (maps to 502)."""

    def __init__(self, message: str = "An external service is unavailable. Try again shortly."):
        super().__init__(message)
        self.message = message


class ValidationProblem(Exception):
    """The request is well-formed but cannot be served as asked (maps to 400)."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.message = message
        self.field = field
