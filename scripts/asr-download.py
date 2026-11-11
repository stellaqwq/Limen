"""Download publisher-hosted SenseVoice weights with bounded range requests."""
import hashlib
import json
from pathlib import Path
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / "runtime" / "asr" / "models"
REPOSITORY = "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"


def download(url, target, expected_size=None, expected_hash=None):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and expected_hash:
        with target.open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() == expected_hash:
                return
    temporary = target.with_suffix(target.suffix + ".part")
    offset = temporary.stat().st_size if temporary.exists() else 0
    if expected_size and offset > expected_size:
        temporary.unlink()
        offset = 0
    while expected_size is None or offset < expected_size:
        end = offset + 4 * 1024 * 1024 - 1
        if expected_size:
            end = min(end, expected_size - 1)
        request = urllib.request.Request(url + ("&" if "?" in url else "?") + "part=" + str(offset), headers={"Range": f"bytes={offset}-{end}", "Cache-Control": "no-cache"})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=40) as response:
                    content_range = response.headers.get("Content-Range", "")
                    if response.status == 206:
                        if not content_range.startswith(f"bytes {offset}-"):
                            raise ValueError("Unexpected range response")
                        total = int(content_range.split("/")[1])
                        if expected_size is not None and total != expected_size:
                            raise ValueError("Asset size changed")
                        expected_size = total
                    elif response.status != 200 or offset != 0:
                        raise ValueError("Server does not support safe resume")
                    body = response.read(4 * 1024 * 1024 + 1)
                    if not body or len(body) > 4 * 1024 * 1024:
                        raise ValueError("Invalid download chunk")
                    if response.status == 200:
                        expected_size = int(response.headers.get("Content-Length", len(body)))
                with temporary.open("ab") as output:
                    output.write(body)
                offset += len(body)
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(attempt + 1)
        if offset % (16 * 1024 * 1024) == 0:
            print(json.dumps({"asset": target.name, "bytes": offset, "total": expected_size}), flush=True)
    with temporary.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if expected_hash and digest != expected_hash:
        raise ValueError("Publisher SHA-256 mismatch")
    temporary.replace(target)


def main():
    with urllib.request.urlopen("https://huggingface.co/api/models/" + REPOSITORY + "/tree/main", timeout=30) as response:
        listing = json.load(response)
    weights = next(item for item in listing if item["path"] == "model.int8.onnx")
    digest = weights["lfs"]["oid"]
    download("https://huggingface.co/" + REPOSITORY + "/resolve/main/model.int8.onnx", ROOT / "sensevoice" / "model.int8.onnx", weights["size"], digest)
    for name in ["tokens.txt", "LICENSE", "README.md", "test_wavs/zh.wav", "test_wavs/en.wav"]:
        download("https://huggingface.co/" + REPOSITORY + "/resolve/main/" + name, ROOT / "sensevoice" / name)
    download("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx", ROOT / "silero_vad.onnx")
    manifest = {"model": "sensevoice-small-int8", "source": "https://huggingface.co/" + REPOSITORY, "model_bytes": weights["size"], "sha256": digest, "publisher_hash_verified": True}
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, **manifest}), flush=True)


if __name__ == "__main__":
    main()
