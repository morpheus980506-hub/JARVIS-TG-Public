"""Serialize conversation updates across API routers in this server process."""
import asyncio
from weakref import WeakKeyDictionary, WeakValueDictionary


_loops = WeakKeyDictionary()


def conversation_lock(conversation_id: str) -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    locks = _loops.setdefault(loop, WeakValueDictionary())
    lock = locks.get(conversation_id)
    if lock is None:
        lock = asyncio.Lock()
        locks[conversation_id] = lock
    return lock
