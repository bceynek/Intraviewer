"""Publish frontend assets to Vercel's static directory."""

from pathlib import Path
from shutil import copytree

ROOT = Path(__file__).resolve().parent

if __name__ == "__main__":
    copytree(ROOT / "Frontend", ROOT / "public", dirs_exist_ok=True)
