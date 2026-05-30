from __future__ import annotations

import base64
import json
import mimetypes
import re
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

try:
    from .inference_engine import InferenceEngine
except ImportError:
    from inference_engine import InferenceEngine


ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT / "frontend"
DATA_DIR = ROOT / "data"
EXPORTS_DIR = ROOT / "exports"
RESULTS_DIR = DATA_DIR / "results"
MODELS_DIR = DATA_DIR / "models"

for directory in (DATA_DIR, EXPORTS_DIR, RESULTS_DIR, MODELS_DIR):
    directory.mkdir(parents=True, exist_ok=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "ModalConstraintThreatAnalyzer/1.0"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json({"status": "ok", "service": "Modal Constraint Threat Analyzer"})
            return
        if parsed.path == "/api/results":
            self.send_json({"results": list_json_files(RESULTS_DIR)})
            return
        if parsed.path == "/api/models":
            self.send_json({"models": list_json_files(MODELS_DIR)})
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            payload = self.read_json()
            if parsed.path == "/api/validate":
                engine = InferenceEngine(payload.get("model", payload))
                findings = [finding.to_dict() for finding in engine.validate()]
                self.send_json({"findings": findings})
                return
            if parsed.path == "/api/infer":
                self.handle_infer(payload)
                return
            if parsed.path == "/api/models":
                self.handle_save_model(payload)
                return
            if parsed.path == "/api/export-image":
                self.handle_export_image(payload)
                return
            self.send_json({"error": "Unknown endpoint"}, status=404)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def handle_infer(self, payload: dict) -> None:
        model = payload.get("model", payload)
        include_scenario_rules = payload.get("includeScenarioRules", True)
        save_result = payload.get("saveResult", True)
        engine = InferenceEngine(model)
        result = engine.infer(include_scenario_rules=include_scenario_rules)
        result["modelName"] = payload.get("modelName") or model.get("name") or "Untitled Model"
        if save_result:
            result_id = timestamp_id("result")
            result["resultId"] = result_id
            write_json(RESULTS_DIR / f"{result_id}.json", {"model": model, "result": result})
        self.send_json(result)

    def handle_save_model(self, payload: dict) -> None:
        model = payload.get("model", payload)
        model_id = payload.get("modelId") or timestamp_id("model")
        saved = {
            "modelId": model_id,
            "savedAt": utc_now(),
            "model": model,
        }
        write_json(MODELS_DIR / f"{safe_name(model_id)}.json", saved)
        self.send_json({"modelId": model_id, "path": str(MODELS_DIR / f"{safe_name(model_id)}.json")})

    def handle_export_image(self, payload: dict) -> None:
        name = safe_name(payload.get("filename") or timestamp_id("diagram"))
        image_data = payload.get("imageData", "")
        svg_data = payload.get("svg", "")
        if image_data.startswith("data:image/png;base64,"):
            raw = base64.b64decode(image_data.split(",", 1)[1])
            path = EXPORTS_DIR / ensure_ext(name, ".png")
            path.write_bytes(raw)
        elif svg_data:
            path = EXPORTS_DIR / ensure_ext(name, ".svg")
            path.write_text(svg_data, encoding="utf-8")
        else:
            raise ValueError("No imageData or svg payload provided.")
        self.send_json({"filename": path.name, "path": str(path)})

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def serve_static(self, raw_path: str) -> None:
        path = unquote(raw_path)
        if path in {"", "/"}:
            path = "/index.html"
        target = (FRONTEND_DIR / path.lstrip("/")).resolve()
        if not str(target).startswith(str(FRONTEND_DIR.resolve())) or not target.exists() or not target.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{utc_now()}] {self.address_string()} {fmt % args}")


def utc_now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def timestamp_id(prefix: str) -> str:
    return f"{prefix}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')}"


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("_") or "artifact"


def ensure_ext(name: str, ext: str) -> str:
    return name if name.lower().endswith(ext) else f"{name}{ext}"


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def list_json_files(directory: Path) -> list[dict[str, str | int]]:
    items = []
    for path in sorted(directory.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        stat = path.stat()
        items.append({"name": path.name, "path": str(path), "size": stat.st_size})
    return items


def run(host: str = "127.0.0.1", port: int = 8000) -> None:
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Modal Constraint Threat Analyzer running at http://{host}:{port}")
    print(f"Serving frontend from {FRONTEND_DIR}")
    server.serve_forever()


if __name__ == "__main__":
    run()
