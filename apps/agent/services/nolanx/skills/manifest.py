"""Typed skill manifests for NolanX capability routing."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class SkillManifest:
    name: str
    path: str
    provider: str = "local"
    source: str = "workspace"
    source_rank: int = 0
    description: str = ""
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    instructions: str = ""

    def summary(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "path": self.path,
            "provider": self.provider,
            "source": self.source,
            "source_rank": self.source_rank,
            "description": self.description,
            "tags": list(self.tags),
            "metadata": dict(self.metadata),
        }
