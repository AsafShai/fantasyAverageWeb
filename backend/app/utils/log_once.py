import logging

_seen: dict[str, int] = {}


def warn_on_change(logger: logging.Logger, key: str, items: list[str], message: str) -> None:
    """Warn once per distinct set of items under `key`; identical repeats
    (same unmatched players on every request) drop to DEBUG."""
    signature = hash(tuple(sorted(items)))
    if _seen.get(key) == signature:
        logger.debug(message)
        return
    _seen[key] = signature
    logger.warning(message)


def reset() -> None:
    _seen.clear()
