#!/usr/bin/env python3
"""Build a local MCPB from compiled sources and production Node.js dependencies.

Usage: npm run pack:mcpb
A working npm installation and registry connectivity are required. No credentials
are read here; uploading the bundle to Smithery is a separate authenticated step.
"""
from __future__ import annotations
import json
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
OUT = ROOT / "releases" / f"hkmo-open-data-mcp-{PACKAGE['version']}.mcpb"
NEEDED = ("dist/src/index.js", "dist/src/geo-transform.py", "manifest.json", "package.json")
for path in NEEDED:
    if not (ROOT / path).is_file():
        raise SystemExit(f"Missing {path}; run npm run build first")
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
if manifest.get("version") != PACKAGE["version"]:
    raise SystemExit("MCPB manifest and package version must agree")

with tempfile.TemporaryDirectory(prefix="hkmo-mcpb-") as directory:
    staging = Path(directory)
    for name in ("manifest.json", "package.json", "README.md", "LICENSE"):
        shutil.copy2(ROOT / name, staging / name)
    shutil.copytree(ROOT / "dist", staging / "dist")
    subprocess.run(
        ["npm", "install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
        cwd=staging, check=True
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED,
                         compresslevel=6) as bundle:
        for item in sorted(staging.rglob("*")):
            if item.is_file() and not item.is_symlink():
                bundle.write(item, item.relative_to(staging).as_posix())
print(f"Created {OUT} (contains compiled server and production dependencies)")
