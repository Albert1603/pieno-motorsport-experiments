#!/usr/bin/env python3
"""LMU setup (.svm) file parser CLI."""

import argparse
import json
import sys
from pathlib import Path


def parse_svm(content):
    result = {}
    current_section = "HEADER"
    result[current_section] = {}

    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("//"):
            continue

        if line.startswith("[") and line.endswith("]"):
            current_section = line[1:-1]
            result[current_section] = {}
            continue

        eq_index = line.find("=")
        if eq_index != -1:
            key = line[:eq_index].strip()
            rest = line[eq_index + 1:].strip()

            value = rest
            comment = ""

            comment_index = rest.find("//")
            if comment_index != -1:
                value = rest[:comment_index].strip()
                comment = rest[comment_index + 2:].strip()

            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]

            # Try to parse as number
            try:
                value = float(value)
                if value == int(value):
                    value = int(value)
            except (ValueError, OverflowError):
                pass

            result[current_section][key] = {
                "value": value,
                "displayValue": comment if comment else (str(value) if not isinstance(value, str) else value),
            }

    return result


def stringify_svm(obj):
    lines = []

    # Header first
    if "HEADER" in obj:
        for key, data in obj["HEADER"].items():
            val = data["value"]
            if isinstance(val, str) and "Class" in key:
                val = f'"{val}"'
            line = f"{key}={val}"
            display = data.get("displayValue", "")
            if display and display != str(data["value"]):
                line += f"//{display}"
            lines.append(line)

    for section, entries in obj.items():
        if section == "HEADER":
            continue
        lines.append(f"\n[{section}]")
        for key, data in entries.items():
            val = data["value"]
            line = f"{key}={val}"
            display = data.get("displayValue", "")
            if display and display != str(val):
                line += f"//{display}"
            lines.append(line)

    return "\n".join(lines) + "\n"


def cmd_read(args):
    content = Path(args.file).read_text(encoding="utf-8")
    print(json.dumps(parse_svm(content), indent=2))


def cmd_write(args):
    if args.json_data:
        data = json.loads(args.json_data)
    else:
        data = json.load(sys.stdin)

    svm_text = stringify_svm(data)
    Path(args.file).write_text(svm_text, encoding="utf-8")
    print(f"Setup saved to {args.file}")


def main():
    parser = argparse.ArgumentParser(description="LMU setup (.svm) file parser")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # read
    p_read = subparsers.add_parser("read", help="Parse SVM file to JSON")
    p_read.add_argument("file", help="Path to the .svm file")

    # write
    p_write = subparsers.add_parser("write", help="Write JSON back to SVM file")
    p_write.add_argument("file", help="Path to the output .svm file")
    p_write.add_argument("json_data", nargs="?", default=None,
                         help="JSON data (or pass via stdin)")

    args = parser.parse_args()

    if args.command == "read":
        cmd_read(args)
    elif args.command == "write":
        cmd_write(args)


if __name__ == "__main__":
    main()
