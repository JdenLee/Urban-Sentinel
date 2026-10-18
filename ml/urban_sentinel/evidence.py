"""Platform fingerprint recorded with every run (proof of where training/inference executed)."""
from __future__ import annotations

import platform
import sys
from datetime import datetime, timezone
from importlib import metadata
from pathlib import Path


def _cpu_machine_line() -> str | None:
    cpuinfo = Path("/proc/cpuinfo")
    if not cpuinfo.exists():
        return None
    for line in cpuinfo.read_text(errors="replace").splitlines():
        # s390x kernels report e.g. "processor 0: version = 00, identification = ..., machine = 3931"
        if "machine" in line or line.startswith("features"):
            return line.strip()[:200]
    return None


def fingerprint() -> dict:
    versions = {}
    for pkg in ["numpy", "pandas", "scikit-learn", "xgboost", "fastapi", "uvicorn"]:
        try:
            versions[pkg] = metadata.version(pkg)
        except metadata.PackageNotFoundError:
            versions[pkg] = None
    return {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "machine": platform.machine(),  # "s390x" on IBM LinuxONE
        "system": platform.system(),
        "platform": platform.platform(),
        "byteorder": sys.byteorder,  # "big" on IBM Z
        "python": sys.version.split()[0],
        "cpu": _cpu_machine_line(),
        "packages": versions,
    }
