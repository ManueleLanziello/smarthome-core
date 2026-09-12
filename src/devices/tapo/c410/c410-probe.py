"""Probe read-only C410: riceve IP e credenziali dall'app chiamante."""

from __future__ import annotations

import argparse
import json
import os
import time

from pytapo import Tapo


SAFE_INFO_KEYS = {
    "alias",
    "avatar",
    "basic_info",
    "device_info",
    "device_model",
    "device_name",
    "device_type",
    "fw_cur",
    "fw_ver",
    "hw_ver",
    "mac",
    "mac_address",
    "model",
    "name",
    "sw_ver",
    "type",
}


def load_tapo_credentials() -> tuple[str, str]:
    username = os.environ.get("TAPO_USERNAME", "")
    password = os.environ.get("TAPO_PASSWORD", "")
    if not username or not password:
        raise RuntimeError("TAPO_USERNAME e TAPO_PASSWORD non disponibili.")
    return username, password


def redact(message: object, secrets: tuple[str, ...]) -> str:
    safe = str(message)
    for secret in secrets:
        if secret:
            safe = safe.replace(secret, "[REDACTED]")
    return safe


def safe_device_info(value: object) -> object:
    if isinstance(value, dict):
        return {
            str(key): safe_device_info(child)
            for key, child in value.items()
            if str(key).lower() in SAFE_INFO_KEYS
        }
    if isinstance(value, list):
        return [safe_device_info(child) for child in value]
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ip", required=True)
    args = parser.parse_args()
    username, password = load_tapo_credentials()
    started = time.perf_counter()
    try:
        camera = Tapo(
            args.ip,
            username,
            password,
            cloudPassword=password,
            reuseSession=False,
            printDebugInformation=False,
            printWarnInformation=False,
            redactConfidentialInformation=True,
            controlPort=443,
            streamPort=8800,
        )
        elapsed = time.perf_counter() - started
        report = {
            "connection": True,
            "authentication": True,
            "elapsed_seconds": round(elapsed, 3),
            "transport": "KLAP" if camera.isKLAP else "PyTapo HTTPS",
            "device_type": camera.deviceType,
            "stream_endpoint": f"{args.ip}:8800",
            "device_info": safe_device_info(camera.basicInfo),
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        elapsed = time.perf_counter() - started
        print(json.dumps({
            "connection": True,
            "authentication": False,
            "elapsed_seconds": round(elapsed, 3),
            "error_type": type(error).__name__,
            "error": redact(error, (username, password)),
        }, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
