from __future__ import annotations

import json
import uuid
from pathlib import Path


class PresetStore:
    def __init__(self, root_dir: Path) -> None:
        self.root_dir = root_dir
        self.root_dir.mkdir(parents=True, exist_ok=True)

    def list_presets(self) -> list[dict]:
        presets: list[dict] = []
        for path in sorted(self.root_dir.glob("*/preset.json")):
            presets.append(json.loads(path.read_text(encoding="utf-8")))
        return presets

    def get_preset(self, preset_id: str) -> dict:
        return json.loads((self.root_dir / preset_id / "preset.json").read_text(encoding="utf-8"))

    def save_preset(
        self,
        preset_name: str,
        subtitle_rule: dict,
        template_source: tuple[str, bytes],
        template_meta: dict,
        base_layer: int,
        preset_id: str | None = None,
    ) -> dict:
        normalized_id = preset_id or f"preset_{uuid.uuid4().hex[:8]}"
        preset_dir = self.root_dir / normalized_id
        preset_dir.mkdir(parents=True, exist_ok=True)

        template_name = f"template_{Path(template_source[0]).name}"
        template_path = preset_dir / template_name
        template_path.write_bytes(template_source[1])

        preset = {
            "preset_id": normalized_id,
            "preset_name": preset_name,
            "template_exo": str(template_path.relative_to(self.root_dir)),
            "subtitle_rule": subtitle_rule,
            "base_layer": base_layer,
            "template_meta": template_meta,
        }
        (preset_dir / "preset.json").write_text(
            json.dumps(preset, ensure_ascii=False, indent=2),
            encoding="utf-8",
            newline="\n",
        )
        return preset

    def resolve_preset_path(self, relative_path: str) -> Path:
        return self.root_dir / relative_path
