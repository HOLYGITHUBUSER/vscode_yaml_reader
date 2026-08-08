#!/usr/bin/env python3
"""编译 TypeScript 并打包 VSIX 到 07-artifacts-安装包/。"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_JSON = ROOT / "package.json"
OUT_DIR = ROOT / "07-artifacts-安装包"
TSCONFIG = ROOT / "00-config-工程配置" / "tsconfig-编译配置.json"
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
STAMPED_RE = re.compile(r"^.+-v\d+\.\d+\.\d+-\d{8}-\d{6}\.vsix$")
KEEP_TIMESTAMPED = 1


def run(cmd: list[str], *, cwd: Path = ROOT) -> None:
    print("+", " ".join(cmd), flush=True)
    r = subprocess.run(cmd, cwd=cwd)
    if r.returncode != 0:
        sys.exit(r.returncode)


def bump_patch(version: str) -> str:
    m = SEMVER.match(version.strip())
    if not m:
        print(f"error: version must be x.y.z, got {version!r}", file=sys.stderr)
        sys.exit(1)
    major, minor, patch = map(int, m.groups())
    return f"{major}.{minor}.{patch + 1}"


def git(*args: str) -> str:
    try:
        return subprocess.check_output(
            ["git", *args], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bump", action="store_true")
    parser.add_argument("--keep", type=int, default=KEEP_TIMESTAMPED)
    args = parser.parse_args()

    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    if args.bump:
        old = data["version"]
        data["version"] = bump_patch(old)
        PACKAGE_JSON.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"version {old} -> {data['version']}")

    version = data["version"]
    name = data["name"]

    if not TSCONFIG.is_file():
        print(f"error: missing {TSCONFIG}", file=sys.stderr)
        sys.exit(1)
    tsc = ROOT / "node_modules" / ".bin" / "tsc"
    if tsc.is_file():
        run([str(tsc), "-p", str(TSCONFIG)])
    else:
        run(["npx", "tsc", "-p", str(TSCONFIG)])

    vsce = ROOT / "node_modules" / ".bin" / "vsce"
    if not vsce.is_file():
        print("error: @vscode/vsce not found; run: npm install", file=sys.stderr)
        sys.exit(1)

    now = datetime.now()
    stamp_file = now.strftime("%Y%m%d-%H%M%S")
    stamp_human = now.strftime("%Y-%m-%d %H:%M:%S")
    stamped_name = f"{name}-v{version}-{stamp_file}.vsix"

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamped_path = OUT_DIR / stamped_name
    info_path = OUT_DIR / "build-info-构建信息.md"

    # 打包时跳过 prepublish 重编译，并排除单测产物与 source map
    test_out = ROOT / "out" / "test-单元测试"
    pkg_backup = data.get("scripts", {}).get("vscode:prepublish")
    try:
        if test_out.is_dir():
            shutil.rmtree(test_out)
        for mapf in (ROOT / "out").rglob("*.map"):
            mapf.unlink(missing_ok=True)
        data.setdefault("scripts", {})["vscode:prepublish"] = "node -e \"process.exit(0)\""
        PACKAGE_JSON.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        run(
            [
                str(vsce),
                "package",
                "--out",
                str(stamped_path),
                "--allow-missing-repository",
            ]
        )
    finally:
        data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
        if pkg_backup is not None:
            data.setdefault("scripts", {})["vscode:prepublish"] = pkg_backup
        else:
            data.get("scripts", {}).pop("vscode:prepublish", None)
        PACKAGE_JSON.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        # 恢复单测产物，方便本地继续 npm test
        if tsc.is_file():
            run([str(tsc), "-p", str(TSCONFIG)])
        else:
            run(["npx", "tsc", "-p", str(TSCONFIG)])

    digest = hashlib.sha256(stamped_path.read_bytes()).hexdigest()[:16]
    commit = git("rev-parse", "--short", "HEAD") or "n/a"
    info_path.write_text(
        f"""# Build Info

- **package:** {name}
- **version:** {version}
- **file:** {stamped_name}
- **sha256(16):** {digest}
- **built_at:** {stamp_human}
- **git:** {commit}
""",
        encoding="utf-8",
    )

    stamped = sorted(OUT_DIR.glob("*.vsix"), key=lambda p: p.stat().st_mtime, reverse=True)
    for oldp in stamped[args.keep :]:
        if STAMPED_RE.match(oldp.name):
            oldp.unlink(missing_ok=True)

    print(f"OK {stamped_path}")


if __name__ == "__main__":
    main()
