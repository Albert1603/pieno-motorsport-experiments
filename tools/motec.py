#!/usr/bin/env python3
"""MoTeC .ld telemetry file reader CLI."""

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import ldparser as ld


def cmd_metadata(args):
    l = ld.ldData.fromfile(args.file)
    head = l.head

    event = None
    if hasattr(head, 'event') and head.event:
        event = {
            "name": getattr(head.event, 'name', None),
            "session": getattr(head.event, 'session', None),
            "comment": getattr(head.event, 'comment', None),
        }

    print(json.dumps({
        "driver": head.driver,
        "vehicle": head.vehicleid,
        "venue": head.venue,
        "datetime": str(head.datetime),
        "shortComment": head.short_comment,
        "channelCount": len(l.channs),
        "event": event,
    }, indent=2))


def cmd_channels(args):
    l = ld.ldData.fromfile(args.file)
    channels = []
    for c in l.channs:
        channels.append({
            "name": c.name,
            "shortName": c.short_name,
            "unit": c.unit,
            "frequency": c.freq,
            "dataLength": c.data_len,
        })
    print(json.dumps(channels, indent=2))


def cmd_data(args):
    l = ld.ldData.fromfile(args.file)

    channel = None
    for c in l.channs:
        if c.name == args.channel:
            channel = c
            break

    if channel is None:
        print(json.dumps({"error": f"Channel not found: {args.channel}"}), file=sys.stderr)
        sys.exit(1)

    values = list(channel.data)
    original_length = len(values)
    max_samples = args.max_samples

    if len(values) > max_samples:
        step = math.ceil(len(values) / max_samples)
        values = [values[i] for i in range(0, len(values), step)]

    print(json.dumps({
        "name": channel.name,
        "unit": channel.unit,
        "frequency": channel.freq,
        "originalLength": original_length,
        "sampleCount": len(values),
        "data": values,
    }, indent=2))


def main():
    parser = argparse.ArgumentParser(description="MoTeC .ld telemetry file reader")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # metadata
    p_meta = subparsers.add_parser("metadata", help="Print session metadata as JSON")
    p_meta.add_argument("file", help="Path to the .ld file")

    # channels
    p_chan = subparsers.add_parser("channels", help="List channels as JSON")
    p_chan.add_argument("file", help="Path to the .ld file")

    # data
    p_data = subparsers.add_parser("data", help="Get channel data as JSON")
    p_data.add_argument("file", help="Path to the .ld file")
    p_data.add_argument("channel", help="Name of the channel to read")
    p_data.add_argument("--max-samples", type=int, default=1000,
                        help="Maximum number of samples to return (default: 1000)")

    args = parser.parse_args()

    if args.command == "metadata":
        cmd_metadata(args)
    elif args.command == "channels":
        cmd_channels(args)
    elif args.command == "data":
        cmd_data(args)


if __name__ == "__main__":
    main()
