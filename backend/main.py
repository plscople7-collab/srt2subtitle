from __future__ import annotations

import argparse
import base64
import json
import mimetypes
from email.parser import BytesParser
from email.policy import default
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .exo_parser import ExoTemplateError, decode_exo_bytes, parse_exo_template
from .local_transcriber import MediaInput, transcribe_media_to_srt
from .transcribe import TranscriptionError
from .v2_converter import convert_srt_project
from .v2_store import V2Store
from .validators import ValidationError


ROOT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT_DIR / "frontend"
V2_STORE = V2Store(ROOT_DIR / "data" / "v2")
STATIC_FILES = {
    "/v2.js",
    "/v2.css",
    "/transcriber.js",
    "/transcriber.css",
    "/studio.js",
    "/studio.css",
}


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "SubtitleExoServer/0.2"

    def end_headers(self) -> None:
        self._set_cors_headers()
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path in {"/", "/studio", "/studio/"}:
                self._serve_static("studio.html")
                return
            if parsed.path in {"/v2", "/v2/"}:
                self._serve_static("v2.html")
                return
            if parsed.path in {"/transcriber", "/transcriber/"}:
                self._serve_static("transcriber.html")
                return
            if parsed.path in STATIC_FILES:
                self._serve_static(parsed.path.lstrip("/"))
                return
            if parsed.path == "/api/health":
                self._send_json(HTTPStatus.OK, {"ok": True, "runtime": "local-python-api", "version": "0.2"})
                return
            if parsed.path == "/api/v2/projects":
                self._send_json(HTTPStatus.OK, {"projects": V2_STORE.list_projects()})
                return
            if parsed.path == "/api/v2/presets":
                self._send_json(HTTPStatus.OK, {"presets": V2_STORE.list_presets()})
                return
            if parsed.path.startswith("/api/v2/projects/"):
                project_id = parsed.path.rsplit("/", 1)[-1]
                self._send_json(HTTPStatus.OK, V2_STORE.get_project(project_id))
                return
            if parsed.path.startswith("/api/v2/presets/"):
                preset_id = parsed.path.rsplit("/", 1)[-1]
                self._send_json(HTTPStatus.OK, V2_STORE.get_preset(preset_id))
                return
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "NOT_FOUND"})
        except FileNotFoundError:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "NOT_FOUND", "message": "対象が見つかりません。"})
        except Exception as exc:  # noqa: BLE001
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "ERR-INTERNAL-001", "message": str(exc)})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/transcriber/transcribe":
                self._handle_local_transcriber()
                return
            if parsed.path == "/api/v2/convert":
                self._handle_v2_convert()
                return
            if parsed.path == "/api/v2/projects":
                self._handle_v2_save_project()
                return
            if parsed.path == "/api/v2/presets":
                self._handle_v2_save_preset()
                return
            if parsed.path == "/api/v2/presets/delete":
                self._handle_v2_delete_preset()
                return
            if parsed.path == "/api/v2/template-preview":
                self._handle_v2_template_preview()
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

    def _handle_local_transcriber(self) -> None:
        form = self._read_multipart()
        result = transcribe_media_to_srt(
            [
                MediaInput(filename=part["filename"] or f"audio_{index}.wav", content=part["content"])
                for index, part in enumerate(form.get("media_file", []), start=1)
            ],
            root_dir=ROOT_DIR,
            model_name=_get_optional_text_field(form, "model") or "base",
            language=_get_optional_text_field(form, "language") or "ja",
            engine=_get_optional_text_field(form, "engine") or "whisper",
        )
        self._send_json(HTTPStatus.OK, result)

    def _handle_v2_convert(self) -> None:
        form = self._read_multipart()
        project_payload = json.loads(_get_text_field(form, "project_json"))
        speaker_specs = []
        for index in range(int(_get_text_field(form, "speaker_count"))):
            prefix = f"speaker_{index}_"
            display_name = _get_text_field(form, prefix + "display_name")
            srt_parts = form.get(prefix + "srt_file", [])
            template_parts = form.get(prefix + "template_exo", [])
            if not srt_parts:
                raise ValidationError("ERR-SRT-001", f"{display_name} のSRTがありません。")
            if not template_parts:
                raise ValidationError("ERR-SPEAKER-001", f"{display_name} の見本EXOがありません。")
            speaker_specs.append(
                {
                    "display_name": display_name,
                    "subtitle_rule": json.loads(_get_text_field(form, prefix + "subtitle_rule_json")),
                    "base_layer": _get_optional_text_field(form, prefix + "base_layer"),
                    "srt_name": srt_parts[0]["filename"] or f"speaker_{index + 1}.srt",
                    "srt_bytes": srt_parts[0]["content"],
                    "template_name": template_parts[0]["filename"] or f"speaker_{index + 1}.exo",
                    "template_bytes": template_parts[0]["content"],
                }
            )

        result = convert_srt_project(project_payload, speaker_specs)
        self._send_json(
            HTTPStatus.OK,
            {
                "project": result["project"],
                "segments": result["segments"],
                "analysis": result["analysis"],
                "exo_content_b64": base64.b64encode(result["exo_bytes"]).decode("ascii"),
                "srt_content": result["srt_text"],
                "json_content": result["json_text"],
            },
        )

    def _handle_v2_save_project(self) -> None:
        payload = self._read_json()
        self._send_json(HTTPStatus.OK, V2_STORE.save_project(payload, payload.get("project_id")))

    def _handle_v2_save_preset(self) -> None:
        payload = self._read_json()
        template_file = payload.get("template_exo", {})
        if not template_file.get("content_b64"):
            raise ValidationError("ERR-SPEAKER-001", "プリセット保存には見本EXOが必要です。")

        template_bytes = base64.b64decode(template_file["content_b64"])
        template_text, file_encoding = decode_exo_bytes(template_bytes)
        template_meta = parse_exo_template(template_text, "pending", template_file.get("name", "template.exo"), file_encoding)
        saved = V2_STORE.save_preset(
            {
                "name": str(payload.get("name", "")).strip() or "preset",
                "subtitle_rule": payload.get("subtitle_rule", {}),
                "base_layer": int(payload.get("base_layer") or 1),
                "template_exo": template_file,
                "template_preview_meta": template_meta.get("preview", {}),
            },
            payload.get("preset_id"),
        )
        self._send_json(HTTPStatus.OK, saved)

    def _handle_v2_delete_preset(self) -> None:
        payload = self._read_json()
        preset_id = str(payload.get("preset_id", "")).strip()
        if not preset_id:
            raise ValidationError("ERR-SPEAKER-001", "preset_id is required.")
        V2_STORE.delete_preset(preset_id)
        self._send_json(HTTPStatus.OK, {"deleted": True, "preset_id": preset_id})

    def _handle_v2_template_preview(self) -> None:
        form = self._read_multipart()
        template_parts = form.get("template_exo", [])
        if not template_parts:
            raise ValidationError("ERR-SPEAKER-001", "見本EXOがありません。")
        template_name = template_parts[0]["filename"] or "template.exo"
        template_text, file_encoding = decode_exo_bytes(template_parts[0]["content"])
        template_meta = parse_exo_template(template_text, "pending", template_name, file_encoding)
        self._send_json(
            HTTPStatus.OK,
            {
                "template_preview_meta": template_meta.get("preview", {}),
                "file_encoding": file_encoding,
            },
        )

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

    def _read_multipart(self) -> dict[str, list[dict]]:
        return self._parse_multipart(
            self.headers.get("Content-Type", ""),
            self.rfile.read(int(self.headers.get("Content-Length", "0"))),
        )

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

    def _set_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")


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


def run(port: int = 8000) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", port), RequestHandler)
    print(f"Serving on http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    run(port=args.port)
