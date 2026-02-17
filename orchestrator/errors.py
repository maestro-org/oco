"""Shared exception types."""


class OrchestratorError(Exception):
    """Base error for orchestrator operations."""


class ValidationError(OrchestratorError):
    """Raised when inventory or generated artifacts are invalid."""


class CommandError(OrchestratorError):
    """Raised when a subprocess command fails."""

    def __init__(self, command: str, code: int, stderr: str = "") -> None:
        detail = f"command failed ({code}): {command}"
        if stderr:
            detail = f"{detail}\n{stderr.strip()}"
        super().__init__(detail)
        self.command = command
        self.code = code
        self.stderr = stderr
