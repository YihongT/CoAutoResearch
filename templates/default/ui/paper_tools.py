"""Pinned, local paper-writing tools. No model API keys or global installs."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

SKILL_REVISION = "9cf7d9aea7d84754db4c167ab04b299d33c444bc"
SKILLS = ("scientific-writing", "scientific-visualization", "citation-management", "venue-templates")
REQUIREMENTS = ("matplotlib==3.11.1", "numpy==2.5.3", "pillow==12.3.0", "pypdf==6.18.0", "requests==2.34.2")


def tools_root() -> Path:
    return Path(os.environ.get("COAUTO_PAPER_TOOLS_DIR") or Path.home() / ".co-auto-research" / "paper-tools" / SKILL_REVISION).expanduser().resolve()


def executable(name: str) -> str:
    found = shutil.which(name)
    if not found and sys.platform == "darwin":
        found = next((str(p / name) for p in (Path("/Library/TeX/texbin"), Path("/opt/homebrew/bin"), Path("/usr/local/bin")) if (p / name).is_file()), None)
    if not found:
        raise ValueError(f"Paper export needs {name}. Follow docs/paper-generation.md to finish setup, then retry.")
    return found


def python_path(root: Path) -> Path:
    return root / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def toolchain() -> dict:
    root = tools_root()
    if not (root / "ready.json").is_file() or not python_path(root).is_file():
        raise ValueError("Paper tools are not configured. Ask your setup agent to follow docs/paper-generation.md, then retry Generate paper.")
    for name in SKILLS:
        if not (root / "skills" / name / "SKILL.md").is_file():
            raise ValueError(f"Missing paper skill: {name}. Run the paper setup again.")
    return {"root": root, "python": str(python_path(root)), "latexmk": executable("latexmk"), "pdftoppm": executable("pdftoppm"), "pdfinfo": executable("pdfinfo"), "pdffonts": executable("pdffonts")}


def setup() -> dict:
    """Idempotent setup invoked by the user's setup agent, never by a web request."""
    if sys.version_info < (3, 12):
        raise ValueError("Paper tool setup needs Python 3.12 or newer; the dashboard itself still supports Python 3.10+.")
    root = tools_root()
    root.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, LC_ALL="C", LANG="C", MPLBACKEND="Agg")
    latexmk, pdftoppm = executable("latexmk"), executable("pdftoppm")
    executable("pdfinfo")
    executable("pdffonts")
    if not all((root / "skills" / name / "SKILL.md").is_file() for name in SKILLS):
        with tempfile.TemporaryDirectory(dir=root, prefix="install-") as temporary:
            staging = Path(temporary)
            commands = [
                ["git", "init", "--quiet"],
                ["git", "remote", "add", "origin", "https://github.com/K-Dense-AI/scientific-agent-skills.git"],
                ["git", "fetch", "--quiet", "--depth", "1", "--filter=blob:none", "origin", SKILL_REVISION],
                ["git", "checkout", "FETCH_HEAD", "--", *[f"skills/{name}" for name in SKILLS], "LICENSE.md", "CITATION.cff"],
            ]
            for command in commands:
                subprocess.run(command, cwd=staging, env=env, check=True, timeout=180)
            for name in SKILLS:
                if not (staging / "skills" / name / "SKILL.md").is_file():
                    raise ValueError(f"Skill checkout is incomplete: {name}")
            if any(path.is_symlink() for path in (staging / "skills").rglob("*")):
                raise ValueError("Skill checkout contains symbolic links.")
            shutil.copytree(staging / "skills", root / "skills", dirs_exist_ok=True)
            for name in ("LICENSE.md", "CITATION.cff"):
                shutil.copyfile(staging / name, root / name)
    python = python_path(root)
    if not python.is_file():
        subprocess.run([sys.executable, "-m", "venv", str(root / "venv")], env=env, check=True, timeout=120)
    subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check", *REQUIREMENTS], env=env, check=True, timeout=600)
    checks = (
        "scientific-writing/scripts/check_consistency.py",
        "scientific-visualization/scripts/figure_export.py",
        "citation-management/scripts/validate_citations.py",
        "venue-templates/scripts/validate_format.py",
    )
    for script in checks:
        subprocess.run([str(python), str(root / "skills" / script), "--help"], env=env, check=True, capture_output=True, timeout=30)
    with tempfile.TemporaryDirectory(dir=root, prefix="smoke-") as temporary:
        smoke = Path(temporary)
        (smoke / "smoke.tex").write_text(r"\documentclass{article}\begin{document}Paper export setup verified.\end{document}")
        subprocess.run([latexmk, "-norc", "-pdf", "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "smoke.tex"], cwd=smoke, env=env, check=True, capture_output=True, timeout=90)
        subprocess.run([pdftoppm, "-f", "1", "-singlefile", "-scale-to", "800", "-png", "smoke.pdf", "preview"], cwd=smoke, env=env, check=True, capture_output=True, timeout=30)
        if not (smoke / "preview.png").is_file():
            raise ValueError("Paper preview smoke test did not produce an image.")
    receipt = {"revision": SKILL_REVISION, "skills": list(SKILLS), "requirements": list(REQUIREMENTS), "smoke_test": "passed", "hashes": {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((root / "skills").rglob("*")) if p.is_file() and "__pycache__" not in p.parts}}
    (root / "ready.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return {"ok": True, "path": str(root), "skills": list(SKILLS), "smoke_test": "passed"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--setup", action="store_true", help="Install the four pinned skills and isolated Python tools; compile and render a smoke PDF.")
    args = parser.parse_args()
    try:
        print(json.dumps(setup() if args.setup else {k: str(v) for k, v in toolchain().items()}, indent=2))
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        parser.exit(1, f"Paper setup failed: {exc}\n")
