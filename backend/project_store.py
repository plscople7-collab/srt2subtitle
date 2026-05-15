from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path


class ProjectStore:
    def __init__(self, root_dir: Path) -> None:
        self.root_dir = root_dir
        self.root_dir.mkdir(parents=True, exist_ok=True)

    def create_project(self, project_payload: dict) -> dict:
        project_id = f"prj_{uuid.uuid4().hex[:8]}"
        project_dir = self.root_dir / project_id
        project_dir.mkdir(parents=True, exist_ok=False)
        (project_dir / "uploads").mkdir()
        (project_dir / "exports").mkdir()

        data = {
            "schema_version": "0.1",
            "project_id": project_id,
            "project": project_payload,
            "speakers": [],
            "segments": [],
        }
        self._write_json(project_dir / "project.json", data)
        return data

    def list_projects(self) -> list[dict]:
        projects: list[dict] = []
        for path in sorted(self.root_dir.glob("*/project.json")):
            data = self._read_json(path)
            projects.append(
                {
                    "project_id": data["project_id"],
                    "name": data["project"]["name"],
                    "output_name": data["project"].get("output_name", "output"),
                    "asr_model": data["project"].get("asr_model", "base"),
                    "speaker_count": len(data.get("speakers", [])),
                }
            )
        return projects

    def get_project(self, project_id: str) -> dict:
        return self._read_json(self.root_dir / project_id / "project.json")

    def save_project(self, project: dict) -> None:
        project_dir = self.root_dir / project["project_id"]
        self._write_json(project_dir / "project.json", project)

    def add_speaker(
        self,
        project_id: str,
        speaker_payload: dict,
        audio_sources: list[tuple[str, bytes]],
        template_source: tuple[str, bytes],
        transcript_source: tuple[str, bytes] | None,
        template_meta: dict,
    ) -> dict:
        project = self.get_project(project_id)
        speaker_id = f"spk_{len(project['speakers']) + 1:03d}"
        project_dir = self.root_dir / project_id
        upload_dir = project_dir / "uploads" / speaker_id
        upload_dir.mkdir(parents=True, exist_ok=True)

        saved_audio_files: list[str] = []
        for index, (filename, content) in enumerate(audio_sources, start=1):
            safe_name = f"audio_{index:03d}_{Path(filename).name}"
            file_path = upload_dir / safe_name
            file_path.write_bytes(content)
            saved_audio_files.append(str(file_path.relative_to(project_dir)))

        template_name = f"template_{Path(template_source[0]).name}"
        template_path = upload_dir / template_name
        template_path.write_bytes(template_source[1])

        transcript_relative = ""
        if transcript_source is not None:
            transcript_name = f"transcript_{Path(transcript_source[0]).name}"
            transcript_path = upload_dir / transcript_name
            transcript_path.write_bytes(transcript_source[1])
            transcript_relative = str(transcript_path.relative_to(project_dir))

        speaker = {
            "speaker_id": speaker_id,
            "display_name": speaker_payload["display_name"],
            "audio_files": saved_audio_files,
            "template_exo": str(template_path.relative_to(project_dir)),
            "transcript_json": transcript_relative,
            "preset_id": speaker_payload.get("preset_id", ""),
            "base_layer": speaker_payload.get("base_layer"),
            "subtitle_rule": speaker_payload["subtitle_rule"],
            "template_meta": template_meta,
        }
        project["speakers"].append(speaker)
        self.save_project(project)
        return speaker

    def update_project_snapshot(self, project_id: str, project_payload: dict, segments: list[dict] | None) -> dict:
        project = self.get_project(project_id)
        project["project"].update(project_payload)
        if segments is not None:
            project["segments"] = segments
        self.save_project(project)
        return project

    def save_segments(self, project_id: str, segments: list[dict]) -> None:
        project = self.get_project(project_id)
        project["segments"] = segments
        self.save_project(project)

    def write_export_files(self, project_id: str, output_name: str, exo_bytes: bytes, srt_text: str, json_text: str) -> dict:
        project_dir = self.root_dir / project_id
        export_dir = project_dir / "exports"
        files = {
            "exo": export_dir / f"{output_name}.exo",
            "srt": export_dir / f"{output_name}.srt",
            "json": export_dir / f"{output_name}.json",
        }
        files["exo"].write_bytes(exo_bytes)
        files["srt"].write_text(srt_text, encoding="utf-8", newline="\n")
        files["json"].write_text(json_text, encoding="utf-8", newline="\n")
        return {kind: str(path) for kind, path in files.items()}

    def resolve_project_path(self, project_id: str, relative_path: str) -> Path:
        return self.root_dir / project_id / relative_path

    def write_transcript_cache(self, project_id: str, relative_audio_path: str, model_name: str, segments: list[dict]) -> str:
        project_dir = self.root_dir / project_id
        audio_path = project_dir / relative_audio_path
        cache_path = audio_path.parent / f"{audio_path.stem}.whisper.{model_name}.json"
        cache_path.write_text(json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
        return str(cache_path.relative_to(project_dir))

    def reset_project_exports(self, project_id: str) -> None:
        export_dir = self.root_dir / project_id / "exports"
        if export_dir.exists():
            shutil.rmtree(export_dir)
        export_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _read_json(path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def _write_json(path: Path, data: dict) -> None:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
