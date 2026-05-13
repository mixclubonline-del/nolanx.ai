"""Persistent local checkpoint/store backends for NolanX runtime."""

from __future__ import annotations

import pickle
import threading
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from langgraph.checkpoint.base import Checkpoint, CheckpointMetadata, ChannelVersions, RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.base import Op, Result
from langgraph.store.memory import InMemoryStore


def _atomic_pickle_dump(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("wb") as handle:
        pickle.dump(payload, handle, protocol=pickle.HIGHEST_PROTOCOL)
    tmp_path.replace(path)


class PersistentCheckpointSaver(InMemorySaver):
    """File-backed wrapper around LangGraph's in-memory saver."""

    def __init__(self, path: Path) -> None:
        super().__init__()
        self._path = path
        self._lock = threading.RLock()
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            return
        with self._path.open("rb") as handle:
            payload = pickle.load(handle)

        storage = defaultdict(lambda: defaultdict(dict))
        for thread_id, namespaces in dict(payload.get("storage") or {}).items():
            storage[thread_id] = defaultdict(dict)
            for checkpoint_ns, checkpoints in dict(namespaces or {}).items():
                storage[thread_id][checkpoint_ns] = dict(checkpoints or {})
        self.storage = storage
        self.writes = defaultdict(dict, dict(payload.get("writes") or {}))
        self.blobs = dict(payload.get("blobs") or {})

    def _flush(self) -> None:
        payload = {
            "storage": {
                thread_id: {checkpoint_ns: dict(checkpoints) for checkpoint_ns, checkpoints in namespaces.items()}
                for thread_id, namespaces in self.storage.items()
            },
            "writes": dict(self.writes),
            "blobs": dict(self.blobs),
        }
        _atomic_pickle_dump(self._path, payload)

    def put(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        with self._lock:
            saved = super().put(config, checkpoint, metadata, new_versions)
            self._flush()
            return saved

    def put_writes(
        self,
        config: RunnableConfig,
        writes: list[tuple[str, Any]] | tuple[tuple[str, Any], ...],
        task_id: str,
        task_path: str = "",
    ) -> None:
        with self._lock:
            super().put_writes(config, writes, task_id, task_path)
            self._flush()

    def delete_thread(self, thread_id: str) -> None:
        with self._lock:
            super().delete_thread(thread_id)
            self._flush()


class PersistentStore(InMemoryStore):
    """File-backed wrapper around LangGraph's in-memory store."""

    def __init__(self, path: Path) -> None:
        super().__init__()
        self._path = path
        self._lock = threading.RLock()
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            return
        with self._path.open("rb") as handle:
            payload = pickle.load(handle)

        self._data = defaultdict(dict, {tuple(namespace): dict(items) for namespace, items in dict(payload.get("data") or {}).items()})
        self._vectors = defaultdict(
            lambda: defaultdict(dict),
            {
                tuple(namespace): defaultdict(dict, {key: dict(value) for key, value in dict(items).items()})
                for namespace, items in dict(payload.get("vectors") or {}).items()
            },
        )

    def _flush(self) -> None:
        payload = {
            "data": {tuple(namespace): dict(items) for namespace, items in self._data.items()},
            "vectors": {
                tuple(namespace): {key: dict(value) for key, value in items.items()}
                for namespace, items in self._vectors.items()
            },
        }
        _atomic_pickle_dump(self._path, payload)

    def batch(self, ops: Iterable[Op]) -> list[Result]:
        with self._lock:
            results = super().batch(ops)
            self._flush()
            return results

    async def abatch(self, ops: Iterable[Op]) -> list[Result]:
        with self._lock:
            results = await super().abatch(ops)
            self._flush()
            return results
