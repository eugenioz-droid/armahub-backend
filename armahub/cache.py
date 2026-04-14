"""
cache.py
--------
Simple in-memory TTL cache for expensive endpoints.
Thread-safe via a lock. No external dependencies.
"""

import time
import threading

_store = {}
_lock = threading.Lock()

DEFAULT_TTL = 30  # seconds


def get(key):
    """Return cached value if still valid, else None."""
    with _lock:
        entry = _store.get(key)
        if entry and time.time() < entry[1]:
            return entry[0]
        if entry:
            del _store[key]
    return None


def put(key, value, ttl=DEFAULT_TTL):
    """Store a value with TTL in seconds."""
    with _lock:
        _store[key] = (value, time.time() + ttl)


def invalidate(*prefixes):
    """Remove all keys that start with any of the given prefixes."""
    with _lock:
        to_del = [k for k in _store if any(k.startswith(p) for p in prefixes)]
        for k in to_del:
            del _store[k]
