#!/usr/bin/env python3
"""Generate imagery for Bazaar with Gemini ("nanobanana") or Imagen.

    python3 scripts/gen-image.py --prompt "..." --out apps/storefront/public/brand/hero.png
    python3 scripts/gen-image.py --batch scripts/image-manifest.json

Key comes from ~/.cubitrek-secrets/growth.env (GEMINI_API_KEY). Never printed.

Model notes:
  gemini-2.5-flash-image   "nanobanana" — fast, good at composited scenes
  gemini-3.1-flash-image   newer, better prompt adherence
  imagen-4.0-generate-001  cleanest photographic output, supports aspect ratio
"""

import argparse
import base64
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

SECRETS = pathlib.Path.home() / ".cubitrek-secrets/growth.env"
API = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_MODEL = "gemini-2.5-flash-image"


def load_key() -> str:
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key
    if SECRETS.exists():
        for line in SECRETS.read_text().splitlines():
            if line.startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("No GEMINI_API_KEY found in env or ~/.cubitrek-secrets/growth.env")


def post(url: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:400]
        sys.exit(f"HTTP {e.code}: {body}")


def generate(prompt: str, out: pathlib.Path, model: str, aspect: str, key: str) -> bool:
    out.parent.mkdir(parents=True, exist_ok=True)

    if model.startswith("imagen"):
        data = post(
            f"{API}/{model}:predict?key={key}",
            {
                "instances": [{"prompt": prompt}],
                "parameters": {"sampleCount": 1, "aspectRatio": aspect},
            },
        )
        preds = data.get("predictions") or []
        if not preds or "bytesBase64Encoded" not in preds[0]:
            print(f"  no image returned: {json.dumps(data)[:200]}")
            return False
        out.write_bytes(base64.b64decode(preds[0]["bytesBase64Encoded"]))
    else:
        gen_cfg = {"responseModalities": ["IMAGE"]}
        # Gemini image models letterbox into a square unless told otherwise,
        # which wastes a third of a hero banner on white bars.
        if aspect and aspect != "1:1":
            gen_cfg["imageConfig"] = {"aspectRatio": aspect}
        data = post(
            f"{API}/{model}:generateContent?key={key}",
            {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": gen_cfg},
        )
        parts = (
            data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            if data.get("candidates")
            else []
        )
        blob = next((p["inlineData"]["data"] for p in parts if "inlineData" in p), None)
        if not blob:
            print(f"  no image returned: {json.dumps(data)[:200]}")
            return False
        out.write_bytes(base64.b64decode(blob))

    import struct
    raw = out.read_bytes()
    dims = ""
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", raw[16:24])
        dims = f"  {w}x{h}"
    print(f"  wrote {out.name}{dims}  ({out.stat().st_size // 1024} KB)")
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt")
    ap.add_argument("--out")
    ap.add_argument("--batch", help="JSON file: [{prompt, out, model?, aspect?}, ...]")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--aspect", default="1:1", help="imagen only: 1:1 3:4 4:3 9:16 16:9")
    args = ap.parse_args()

    key = load_key()
    root = pathlib.Path(__file__).resolve().parent.parent

    if args.batch:
        jobs = json.loads(pathlib.Path(args.batch).read_text())
    elif args.prompt and args.out:
        jobs = [{"prompt": args.prompt, "out": args.out}]
    else:
        sys.exit("Need --prompt and --out, or --batch")

    ok = 0
    for i, job in enumerate(jobs, 1):
        out = root / job["out"]
        if out.exists() and not job.get("overwrite"):
            print(f"[{i}/{len(jobs)}] skip (exists) {job['out']}")
            ok += 1
            continue
        print(f"[{i}/{len(jobs)}] {job['out']}")
        if generate(
            job["prompt"],
            out,
            job.get("model", args.model),
            job.get("aspect", args.aspect),
            key,
        ):
            ok += 1

    print(f"\n{ok}/{len(jobs)} generated")
    if ok < len(jobs):
        sys.exit(1)


if __name__ == "__main__":
    main()
