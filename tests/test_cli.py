from __future__ import annotations

import subprocess
import sys


def test_version_flag() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "polyopus", "--version"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "0.1.0" in result.stdout


def test_help_lists_commands() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "polyopus", "--help"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "doctor" in result.stdout
    assert "migrate" in result.stdout
