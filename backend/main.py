from __future__ import annotations

import json
import base64
import mimetypes
from email.parser import BytesParser
from email.policy import default
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .exo_parser import ExoTemplateError, decode_exo_bytes, parse_exo_template
from .exo_writer import assign_frames, build_exo, build_segments_json, build_srt
from .preset_store import PresetStore
from .project_store import ProjectStore
from .subtitle_splitter import split_segments
from .transcribe import CompositeTranscriber, SidecarJsonTranscriber, TranscriptionError, WhisperWorkerTranscriber
from .validators import ValidationError, validate_project_payload, validate_speaker_payload


ROOT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT_DIR / "frontend"
DATA_DIR = ROOT_DIR / "data" / "projects"
STORE = ProjectStore(DATA_DIR)
PRESET_STORE = PresetStore(ROOT_DIR / "data" / "presets")
TRANSCRIBER = CompositeTranscriber(
    primary=WhisperWorkerTranscriber(),
    fallback=SidecarJsonTranscriber(),
)
ALLOWED_AUDIO_SUFFIXES = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma", ".webm", ".mp4"}


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "SubtitleExoServer/0.1"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self._serve_static("index.html")
            return
        if parsed.path in {"/app.js", "/style.css"}:
            self._serve_static(parsed.path.lstrip("/"))
            return
        if parsed.path == "/api/projects":
            self._send_json(HTTPStatus.OK, {"projects": STORE.list_projects()})
            return
        if parsed.path == "/api/presets/speakers":
            self._send_json(HTTPStatus.OK, {"presets": PRESET_STORE.list_presets()})
            return
        if parsed.path.startswith("/api/project/"):
            project_id = parsed.path.rsplit("/", 1)[-1]
            self._handle_get_project(project_id)
            return
        self._send_json(HTTPStatus.NOT_FOUND, {"error": "NOT_FOUND"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/project/create":
                self._handle_create_project()
                return
            if parsed.path == "/api/project/save":
                self._handle_save_project()
                return
            if parsed.path == "/api/speakers":
                self._handle_add_speaker()
                return
            if parsed.path == "/api/presets/speakers":
                self._handle_save_preset()
                return
            if parsed.path == "/api/transcribe":
                self._handle_transcribe()
                return
            if parsed.path == "/api/export/exo":
                self._handle_export()
                return
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "NOT_FOUND"})
        except ValidationError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": exc.code, "message": exc.message})
        except ExoTemplateError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": exc.code, "message": exc.args[0]})
        except TranscriptionError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": exc.code, "message": exc.message})
        except FileNotFoundError:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "NOT_FOUND", "message": "対象が見つかりません。"})
        except Exception as exc:  # noqa: BLE001
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "ERR-INTERNAL-001", "message": str(exc)})

    def _handle_create_project(self) -> None:
        payload = self._read_json()
        project_payload = validate_project_payload(payload)
        project = STORE.create_project(project_payload)
        self._send_json(HTTPStatus.OK, {"project_id": project["project_id"]})

    def _handle_save_project(self) -> None:
        payload = self._read_json()
        project_id = str(payload.get("project_id", ""))
        if not project_id:
            raise ValidationError("ERR-PROJECT-001", "project_id は必須です。")
        project_payload = validate_project_payload(payload.get("project", {}))
        project = STORE.update_project_snapshot(project_id, project_payload, payload.get("segments"))
        self._send_json(HTTPStatus.OK, {"project_id": project["project_id"], "saved": True})

    def _handle_add_speaker(self) -> None:
        content_type = self.headers.get("Content-Type", "")
        form = self._parse_multipart(content_type, self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        project_id = _get_text_field(form, "project_id")
        display_name = _get_text_field(form, "display_name")
        subtitle_rule = json.loads(_get_text_field(form, "subtitle_rule_json"))
        preset_id = _get_optional_text_field(form, "preset_id")
        base_layer_text = _get_optional_text_field(form, "base_layer")

        audio_parts = form.get("audio_file", [])
        template_parts = form.get("template_exo", [])
        transcript_parts = form.get("transcript_json", [])
        if not template_parts and not preset_id:
            raise ValidationError("ERR-SPEAKER-001", "テンプレート EXO を指定してください。")

        audio_sources: list[tuple[str, bytes]] = []
        for part in audio_parts:
            filename = part["filename"]
            suffix = Path(filename).suffix.lower()
            if suffix not in ALLOWED_AUDIO_SUFFIXES:
                raise ValidationError("ERR-AUDIO-FORMAT-001", f"未対応の音声形式です: {filename}")
            audio_sources.append((filename, part["content"]))

        transcript_name = transcript_parts[0]["filename"] if transcript_parts else None
        speaker_payload = validate_speaker_payload(
            display_name,
            subtitle_rule,
            [item[0] for item in audio_sources],
            template_parts[0]["filename"] if template_parts else None,
            transcript_name,
            preset_id,
            base_layer_text,
        )
        template_source_name, template_source_bytes, template_meta = self._resolve_template_source(template_parts, preset_id)
        speaker = STORE.add_speaker(
            project_id,
            speaker_payload,
            audio_sources,
            (template_source_name, template_source_bytes),
            (transcript_parts[0]["filename"], transcript_parts[0]["content"]) if transcript_parts else None,
            {**template_meta, "speaker_id": ""},
        )
        speaker["template_meta"]["speaker_id"] = speaker["speaker_id"]
        if speaker["base_layer"] is None:
            speaker["base_layer"] = int(speaker["template_meta"]["preview"].get("layer") or 1)
        project = STORE.get_project(project_id)
        for item in project["speakers"]:
            if item["speaker_id"] == speaker["speaker_id"]:
                item["template_meta"]["speaker_id"] = speaker["speaker_id"]
                if item.get("base_layer") is None:
                    item["base_layer"] = speaker["base_layer"]
                break
        STORE.save_project(project)
        self._send_json(
            HTTPStatus.OK,
            {
                "speaker_id": speaker["speaker_id"],
                "template_status": "ok",
                "template_preview": speaker["template_meta"]["preview"],
                "base_layer": speaker["base_layer"],
                "template_path": speaker["template_exo"],
            },
        )

    def _handle_save_preset(self) -> None:
        content_type = self.headers.get("Content-Type", "")
        form = self._parse_multipart(content_type, self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        preset_name = _get_text_field(form, "preset_name").strip()
        subtitle_rule = json.loads(_get_text_field(form, "subtitle_rule_json"))
        preset_id = _get_optional_text_field(form, "preset_id")
        base_layer_text = _get_optional_text_field(form, "base_layer")
        project_id = _get_optional_text_field(form, "project_id")
        template_relative = _get_optional_text_field(form, "template_relative")
        base_layer = int(base_layer_text) if base_layer_text else 1

        template_parts = form.get("template_exo", [])
        if not template_parts and not (project_id and template_relative):
            raise ValidationError("ERR-SPEAKER-001", "プリセット保存にはテンプレート EXO が必要です。")

        if template_parts:
            template_name = template_parts[0]["filename"]
            template_bytes = template_parts[0]["content"]
        else:
            template_path = STORE.resolve_project_path(project_id, template_relative)
            template_name = template_path.name
            template_bytes = template_path.read_bytes()

        template_text, file_encoding = decode_exo_bytes(template_bytes)
        template_meta = parse_exo_template(template_text, "pending", template_name, file_encoding)
        preset = PRESET_STORE.save_preset(
            preset_name,
            subtitle_rule,
            (template_name, template_bytes),
            template_meta,
            base_layer,
            preset_id or None,
        )
        self._send_json(HTTPStatus.OK, {"preset": preset})

    def _handle_transcribe(self) -> None:
        payload = self._read_json()
        project = STORE.get_project(payload["project_id"])
        speaker_order = {speaker["speaker_id"]: index for index, speaker in enumerate(project["speakers"])}
        recognized_segments: list[dict] = []
        asr_model = str(project["project"].get("asr_model", "base"))
        primary_transcriber = WhisperWorkerTranscriber(model_name=asr_model)
        transcriber = CompositeTranscriber(primary=primary_transcriber, fallback=SidecarJsonTranscriber())

        for speaker in project["speakers"]:
            speaker_segments: list[dict] = []
            for relative_audio in speaker["audio_files"]:
                audio_path = STORE.resolve_project_path(project["project_id"], relative_audio)
                transcript_path = None
                if speaker.get("transcript_json"):
                    transcript_path = str(STORE.resolve_project_path(project["project_id"], speaker["transcript_json"]))
                elif not transcript_path:
                    cached_relative = _find_cached_transcript(project["project_id"], relative_audio, asr_model)
                    if cached_relative is not None:
                        transcript_path = str(STORE.resolve_project_path(project["project_id"], cached_relative))
                recognized = [
                    item.to_dict()
                    for item in transcriber.transcribe(str(audio_path), speaker["speaker_id"], transcript_path)
                ]
                for item in recognized:
                    item["base_layer"] = speaker.get("base_layer") or int(speaker["template_meta"]["preview"].get("layer") or 1)
                if not transcript_path:
                    STORE.write_transcript_cache(project["project_id"], relative_audio, asr_model, recognized)
                speaker_segments.extend(recognized)
            split_result = split_segments(speaker_segments, speaker["subtitle_rule"])
            recognized_segments.extend(split_result)

        framed_segments = assign_frames(recognized_segments, float(project["project"]["fps"]), speaker_order)
        STORE.save_segments(project["project_id"], framed_segments)
        self._send_json(HTTPStatus.OK, {"segments": framed_segments})

    def _handle_export(self) -> None:
        payload = self._read_json()
        project = STORE.get_project(payload["project_id"])
        segments = payload.get("segments") or project.get("segments") or []
        if not segments:
            raise ValidationError("ERR-EXPORT-001", "出力対象の字幕セグメントがありません。")

        exo_text = build_exo(project, segments)
        srt_text = build_srt(segments)
        json_text = build_segments_json(segments)
        exo_encoding = project["speakers"][0]["template_meta"].get("file_encoding", "utf-8")
        exo_bytes = exo_text.encode(exo_encoding, errors="strict")
        output_paths = STORE.write_export_files(project["project_id"], project["project"]["output_name"], exo_bytes, srt_text, json_text)

        self._send_json(
            HTTPStatus.OK,
            {
                "files": output_paths,
                "exo_content_b64": base64.b64encode(exo_bytes).decode("ascii"),
                "srt_content": srt_text,
                "json_content": json_text,
            },
        )

    def _handle_get_project(self, project_id: str) -> None:
        project = STORE.get_project(project_id)
        self._send_json(HTTPStatus.OK, project)

    def _resolve_template_source(self, template_parts: list[dict], preset_id: str | None) -> tuple[str, bytes, dict]:
        if template_parts:
            template_text, file_encoding = decode_exo_bytes(template_parts[0]["content"])
            template_meta = parse_exo_template(template_text, "pending", template_parts[0]["filename"], file_encoding)
            return template_parts[0]["filename"], template_parts[0]["content"], template_meta

        if not preset_id:
            raise ValidationError("ERR-SPEAKER-001", "テンプレート EXO を指定してください。")
        preset = PRESET_STORE.get_preset(preset_id)
        template_path = PRESET_STORE.resolve_preset_path(preset["template_exo"])
        template_bytes = template_path.read_bytes()
        template_text, file_encoding = decode_exo_bytes(template_bytes)
        template_meta = parse_exo_template(template_text, "pending", template_path.name, file_encoding)
        return template_path.name, template_bytes, template_meta

    def _serve_static(self, filename: str) -> None:
        path = FRONTEND_DIR / filename
        if not path.exists():
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "NOT_FOUND"})
            return
        content = path.read_bytes()
        mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{mime_type}; charset=UTF-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        payload = self.rfile.read(length).decode("utf-8")
        return json.loads(payload) if payload else {}

    def _parse_multipart(self, content_type: str, body: bytes) -> dict[str, list[dict]]:
        message = BytesParser(policy=default).parsebytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8") + body
        )
        fields: dict[str, list[dict]] = {}
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if not name:
                continue
            fields.setdefault(name, []).append(
                {
                    "filename": part.get_filename(),
                    "content": part.get_payload(decode=True) or b"",
                    "content_type": part.get_content_type(),
                    "text": part.get_content() if part.get_content_maintype() == "text" else None,
                }
            )
        return fields

    def _send_json(self, status: HTTPStatus, payload: dict) -> None:
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=UTF-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def _get_text_field(form: dict[str, list[dict]], key: str) -> str:
    items = form.get(key)
    if not items:
        raise ValidationError("ERR-REQUEST-001", f"{key} が不足しています。")
    item = items[0]
    if item["text"] is not None:
        return str(item["text"])
    return item["content"].decode("utf-8")


def _get_optional_text_field(form: dict[str, list[dict]], key: str) -> str | None:
    items = form.get(key)
    if not items:
        return None
    item = items[0]
    if item["text"] is not None:
        return str(item["text"])
    return item["content"].decode("utf-8")


def _find_cached_transcript(project_id: str, relative_audio_path: str, model_name: str) -> str | None:
    project_dir = STORE.root_dir / project_id
    audio_path = project_dir / relative_audio_path
    cache_path = audio_path.parent / f"{audio_path.stem}.whisper.{model_name}.json"
    if cache_path.exists():
        return str(cache_path.relative_to(project_dir))
    return None


def run() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 8000), RequestHandler)
    print("Serving on http://127.0.0.1:8000")
    server.serve_forever()


if __name__ == "__main__":
    run()
