from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class V2Store:
    def __init__(self, root_dir: Path) -> None:
        self.root_dir = root_dir
        self.projects_dir = self.root_dir / "projects"
        self.presets_dir = self.root_dir / "presets"
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self.presets_dir.mkdir(parents=True, exist_ok=True)

    def list_projects(self) -> list[dict]:
        items: list[dict] = []
        for path in sorted(self.projects_dir.glob("*/project.json")):
            data = self._read_json(path)
            items.append(
                {
                    "project_id": data["project_id"],
                    "name": data["project"]["name"],
                    "speaker_count": len(data.get("speakers", [])),
                    "updated_at": data.get("updated_at", ""),
                }
            )
        return items

    def get_project(self, project_id: str) -> dict:
        return self._read_json(self.projects_dir / project_id / "project.json")

    def save_project(self, payload: dict, project_id: str | None = None) -> dict:
        normalized_id = project_id or payload.get("project_id") or f"v2prj_{uuid.uuid4().hex[:8]}"
        project_dir = self.projects_dir / normalized_id
        project_dir.mkdir(parents=True, exist_ok=True)
        current = {}
        project_json = project_dir / "project.json"
        if project_json.exists():
            current = self._read_json(project_json)

        data = {
            "schema_version": "0.2-local-project",
            "project_id": normalized_id,
            "project": payload["project"],
            "speakers": payload.get("speakers", []),
            "created_at": current.get("created_at") or _utc_now(),
            "updated_at": _utc_now(),
        }
        self._write_json(project_json, data)
        return data

    def list_presets(self) -> list[dict]:
        items: list[dict] = []
        for path in sorted(self.presets_dir.glob("*/preset.json")):
            data = self._read_json(path)
            items.append(data)
        return items

    def get_preset(self, preset_id: str) -> dict:
        return self._read_json(self.presets_dir / preset_id / "preset.json")

    def save_preset(self, payload: dict, preset_id: str | None = None) -> dict:
        normalized_id = preset_id or payload.get("preset_id") or f"v2preset_{uuid.uuid4().hex[:8]}"
        preset_dir = self.presets_dir / normalized_id
        preset_dir.mkdir(parents=True, exist_ok=True)
        current = {}
        preset_json = preset_dir / "preset.json"
        if preset_json.exists():
            current = self._read_json(preset_json)

        data = {
            "schema_version": "0.2-local-preset",
            "preset_id": normalized_id,
            "name": payload["name"],
            "subtitle_rule": payload["subtitle_rule"],
            "base_layer": payload["base_layer"],
            "template_exo": payload["template_exo"],
            "template_preview_meta": payload.get("template_preview_meta", {}),
            "created_at": current.get("created_at") or _utc_now(),
            "updated_at": _utc_now(),
        }
        self._write_json(preset_json, data)
        return data

    @staticmethod
    def _read_json(path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def _write_json(path: Path, data: dict) -> None:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
