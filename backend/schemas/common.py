"""Shared error type. Every 422 response uses the same {"errors": [{"field", "message"}]} shape."""


class ApiValidationError(Exception):
    def __init__(self, errors: dict[str, str]):
        super().__init__("; ".join(f"{field}: {message}" for field, message in errors.items()))
        self.errors = [{"field": field, "message": message} for field, message in errors.items()]
