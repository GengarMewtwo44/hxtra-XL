#!/usr/bin/env python3
"""Read-only HX Stomp XL 3.80.0 Entry 0 map and known HXtra signature scanner.

This tool never writes or patches firmware. It verifies the supplied HXF container,
extracts Entry 0 from its L6IA payload, maps the seven LPC43xx segments, and locates
known HX Stomp settings-function signatures in the XL image.
"""
import argparse
import hashlib
import struct
import zlib

import hxf
import l6ia


# Signatures are the stock first instructions documented by HXtra's Stomp 3.80.0
# patch_menu.py. A match in XL is a candidate, not proof of equivalent semantics.
SIGNATURES = {
    "settings_get": bytes.fromhex("b0f5bf7f"),
    "settings_limits": bytes.fromhex("cb2808b5"),
    "settings_class": bytes.fromhex("cb2805d9"),
    "settings_label": bytes.fromhex("f0b5bd28"),
}


def load_entry0(stock_hxf):
    raw = open(stock_hxf, "rb").read()
    chunks = hxf._chunks(raw)
    head = next((body for cid, _, _, body in chunks if cid == b"HEAD"), None)
    compressed = next((body for cid, _, _, body in chunks if cid == b"data"), None)
    if head is None or compressed is None:
        raise ValueError("HXF must contain HEAD and data chunks")
    payload = zlib.decompress(compressed)
    expected_size = struct.unpack_from(">I", head, 16)[0]
    expected_md5 = head[20:36].hex()
    actual_md5 = hashlib.md5(payload).hexdigest()
    if len(payload) != expected_size or actual_md5 != expected_md5:
        raise ValueError(
            f"HXF payload verification failed: size {len(payload):#x}/{expected_size:#x}, "
            f"MD5 {actual_md5}/{expected_md5}"
        )

    entries = l6ia.parse(payload)
    entry = next((e for e in entries if e["index"] == 0), None)
    if entry is None or entry["type"] != 2:
        raise ValueError("L6IA Entry 0 is missing or is not the main application")
    _, swapped, _ = l6ia.describe(payload, entry)
    return raw, actual_md5, swapped


def parse_segments(entry0):
    if len(entry0) < 0x34:
        raise ValueError("Entry 0 is too short for an LPC image header")
    magic, size, _crc, version, count = struct.unpack_from("<5I", entry0, 0)
    if magic != 0x230B0C5E or version != 2 or size != len(entry0):
        raise ValueError(
            f"Unexpected Entry 0 header: magic={magic:#x}, size={size:#x}, "
            f"version={version}, actual={len(entry0):#x}"
        )
    if count > 32:
        raise ValueError(f"Implausible segment count: {count}")
    segments = []
    off = 0x34
    for index in range(count):
        if off + 12 > len(entry0):
            raise ValueError(f"Truncated segment header {index}")
        length, address, next_off = struct.unpack_from("<3I", entry0, off)
        if next_off != off + 12 + length or next_off > len(entry0):
            raise ValueError(f"Invalid segment {index} bounds at {off:#x}")
        segments.append({
            "index": index,
            "file_offset": off + 12,
            "length": length,
            "address": address,
            "end": address + length,
        })
        off = next_off
    if off != len(entry0):
        raise ValueError(f"Segment table ends at {off:#x}, Entry 0 ends at {len(entry0):#x}")
    return segments


def scan_segment(entry0, segment, signature):
    start = segment["file_offset"]
    data = entry0[start:start + segment["length"]]
    matches = []
    pos = 0
    while True:
        pos = data.find(signature, pos)
        if pos < 0:
            break
        matches.append(segment["address"] + pos)
        pos += 1
    return matches



def thumb_bl_targets(code, base):
    """Return direct Thumb-2 BL call sites grouped by absolute target address."""
    calls = {}
    halfwords = struct.unpack(f"<{len(code) // 2}H", code[:len(code) // 2 * 2])
    for i in range(len(halfwords) - 1):
        first, second = halfwords[i], halfwords[i + 1]
        if first & 0xF800 != 0xF000 or second & 0xD000 != 0xD000:
            continue
        sign = (first >> 10) & 1
        offset = ((sign << 24)
                  | ((1 - (((second >> 13) & 1) ^ sign)) << 23)
                  | ((1 - (((second >> 11) & 1) ^ sign)) << 22)
                  | ((first & 0x3FF) << 12)
                  | ((second & 0x7FF) << 1))
        target = base + 2 * i + 4 + offset - (sign << 25)
        calls.setdefault(target & ~1, []).append(base + 2 * i)
    return calls


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stock_hxf", help="official stock HX Stomp XL .hxf file")
    args = parser.parse_args()

    _raw, payload_md5, entry0 = load_entry0(args.stock_hxf)
    segments = parse_segments(entry0)
    print(f"Verified HXF payload MD5: {payload_md5}")
    print(f"Entry 0: {len(entry0):,} bytes; {len(segments)} segments")
    for seg in segments:
        print(
            f"  seg[{seg['index']}] VA {seg['address']:#010x}..{seg['end']:#010x} "
            f"size={seg['length']:#x} file+{seg['file_offset']:#x}"
        )

    print("\nKnown HXtra settings signatures (XL matches are candidates):")
    matches_by_name = {}
    for name, signature in SIGNATURES.items():
        matches = []
        for seg in segments:
            matches.extend(scan_segment(entry0, seg, signature))
        matches_by_name[name] = matches
        formatted = ", ".join(f"{address:#010x}" for address in matches) or "no match"
        print(f"  {name}: {formatted}")

    # Direct BL callers help distinguish duplicate prologues. Literal-loaded
    # BLX calls are deliberately not inferred by this first-pass scanner.
    code_seg = next((s for s in segments if s["address"] == 0x28D92230), None)
    if code_seg is not None:
        code = entry0[code_seg["file_offset"]:code_seg["file_offset"] + code_seg["length"]]
        callers = thumb_bl_targets(code, code_seg["address"])
        print("\nDirect Thumb BL callers of settings candidates:")
        for name, matches in matches_by_name.items():
            for target in matches:
                sites = callers.get(target & ~1, [])
                formatted = ", ".join(f"{site:#010x}" for site in sites) or "none found"
                print(f"  {name} {target:#010x}: {formatted}")


if __name__ == "__main__":
    main()
