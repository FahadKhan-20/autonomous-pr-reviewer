import json
import logging
import sys
import time
from contextlib import contextmanager
from typing import Any, Dict, Generator


class JsonFormatter(logging.Formatter):
    """Custom formatter outputting logs as structured JSON."""

    def format(self, record: logging.LogRecord) -> str:
        log_record: Dict[str, Any] = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Include custom extra fields if provided
        if hasattr(record, "extra") and isinstance(record.extra, dict):
            log_record.update(record.extra)

        if record.exc_info:
            log_record["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_record)


def setup_logging(level_name: str = "INFO") -> logging.Logger:
    """Configures application-wide structured JSON logging."""
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, level_name.upper(), logging.INFO))

    # Remove existing handlers to avoid duplicates
    for handler in list(root_logger.handlers):
        root_logger.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root_logger.addHandler(handler)

    # Silence overly verbose third-party loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("asyncio").setLevel(logging.WARNING)

    return root_logger


logger = setup_logging()


def get_logger(name: str) -> logging.Logger:
    """Returns a named logger instance."""
    return logging.getLogger(name)


@contextmanager
def track_latency(agent_name: str) -> Generator[Dict[str, Any], None, None]:
    """Context manager to measure agent run latency and log execution time."""
    stats = {"agent": agent_name, "start_time": time.perf_counter(), "latency_ms": 0}
    try:
        yield stats
    finally:
        stats["latency_ms"] = int((time.perf_counter() - stats["start_time"]) * 1000)
        logger.info(
            f"Agent {agent_name} completed in {stats['latency_ms']}ms",
            extra={"agent": agent_name, "latency_ms": stats["latency_ms"]},
        )
