#!/usr/bin/env python3
"""Build a read-only HX Stomp XL visualizer research report.

This combines local stock-firmware mapping with the repository's existing
architecture notes. It does not patch, rewrite, or emit firmware bytes.
"""
import argparse
import hashlib
import os
import struct
from datetime import datetime, timezone

import xl_firmware


REPO_NOTES = [
    ("XL port plan", "docs/research/XL_PORT_PLAN.md"),
    ("XL architecture", "docs/research/xl/architecture.md"),
    ("M4/DSP transport", "docs/research/m4/dsp-link.md"),
    ("Home, Show and Edit views", "docs/research/m4/home-screen.md"),
    ("Gain-reduction meter research", "docs/research/features/gr-meter.md"),
    ("GR meter implementation", "src/m4/gr_meter.s"),
    ("DSP meter implementation", "src/m4/dsp_meter.s"),
    ("BPM widget implementation", "src/m4/bpm.s"),
    ("Virtual settings implementation", "src/m4/virtual_settings.s"),
    ("Settings ID inventory", "tools/setting_ids.py"),
    ("Menu patch engine", "tools/patch_menu.py"),
]

EXPECTED_PRIOR_PAYLOAD_MD5 = "329e3a26d60d3de1988b6785fa833ee1"


def read_note(root, title, relative):
    path = os.path.join(root, relative)
    if not os.path.isfile(path):
        return title, None
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return title, f.read()


def short_note(text, limit=2600):
    if text is None:
        return "Not present in this checkout."
    # Preserve useful technical content while keeping the one-command report
    # compact enough to paste into a chat.
    lines = [line.rstrip() for line in text.splitlines() if line.strip()]
    result = "\n".join(lines)
    if len(result) > limit:
        result = result[:limit].rsplit("\n", 1)[0] + "\n[truncated; full note remains in repository]"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stock_hxf", help="untouched stock HX Stomp XL .hxf file")
    parser.add_argument("--output", help="optional Markdown report path; defaults to stdout")
    parser.add_argument("--repo", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        help="repository root (normally detected automatically)")
    args = parser.parse_args()

    stock_path = os.path.abspath(args.stock_hxf)
    if not os.path.isfile(stock_path):
        parser.error(f"firmware file not found: {stock_path}")

    raw, payload_md5, entry0 = xl_firmware.load_entry0(stock_path)
    segments = xl_firmware.parse_segments(entry0)
    file_md5 = hashlib.md5(raw).hexdigest()
    code_seg = next((s for s in segments if s["address"] == 0x28D92230), None)

    report = []
    add = report.append
    add("# HX Stomp XL visualizer research report")
    add("")
    add(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    add(f"Firmware file: `{stock_path}`")
    add("")
    add("## 1. Firmware identity and integrity")
    add("")
    add("- HXF container: parsed successfully by the repository HXF/L6IA readers.")
    add(f"- File size: {len(raw):,} bytes")
    add(f"- Full HXF MD5: `{file_md5}`")
    add(f"- Verified decompressed payload MD5: `{payload_md5}`")
    add(f"- Entry 0 size: {len(entry0):,} bytes")
    add(f"- Entry 0 segments: {len(segments)}")
    if payload_md5 == EXPECTED_PRIOR_PAYLOAD_MD5:
        add("- Prior documented payload hash: MATCH.")
    else:
        add("- Prior documented payload hash: DOES NOT MATCH.")
        add(f"  - Earlier repository note lists `{EXPECTED_PRIOR_PAYLOAD_MD5}`.")
        add("  - This is a provenance discrepancy to reconcile, not proof of modification.")
        add("  - Keep this exact file as the analysis input; do not substitute another build.")
    add("")
    add("## 2. Entry 0 memory map")
    add("")
    add("| Segment | Virtual address range | Size | File offset |")
    add("|---:|---|---:|---:|")
    for seg in segments:
        add(f"| {seg['index']} | `{seg['address']:#010x}..{seg['end']:#010x}` | "
            f"`{seg['length']:#x}` | `{seg['file_offset']:#x}` |")
    add("")
    add("## 3. XL settings-function candidates")
    add("")
    add("These are signature matches against known HX Stomp routines. They are candidates, not approved hooks.")
    add("")
    matches_by_name = {}
    for name, signature in xl_firmware.SIGNATURES.items():
        matches = []
        for seg in segments:
            matches.extend(xl_firmware.scan_segment(entry0, seg, signature))
        matches_by_name[name] = matches
        add(f"- **{name}:** " + (", ".join(f"`{m:#010x}`" for m in matches) if matches else "no match"))
    add("")
    add("### Direct Thumb BL call-site scan (exploratory)")
    add("")
    add("This first-pass scan only detects direct Thumb-2 BL encodings. It does not resolve literal-loaded BLX calls, indirect calls, function boundaries, or prove semantic equivalence.")
    if code_seg:
        code = entry0[code_seg["file_offset"]:code_seg["file_offset"] + code_seg["length"]]
        callers = xl_firmware.thumb_bl_targets(code, code_seg["address"])
        for name, targets in matches_by_name.items():
            for target in targets:
                sites = callers.get(target & ~1, [])
                shown = sites[:24]
                suffix = f" (+{len(sites)-len(shown)} more)" if len(sites) > len(shown) else ""
                add(f"- `{name}` target `{target:#010x}`: " +
                    (", ".join(f"`{s:#010x}`" for s in shown) if shown else "no direct BL callers found") + suffix)
    else:
        add("- Could not identify the expected XL code segment at `0x28D92230`.")
    add("")
    add("## 4. Existing architecture evidence")
    add("")
    add("The following repository notes are included as research context. HX Stomp findings are not automatically XL findings.")
    for title, relative in REPO_NOTES:
        _, note = read_note(args.repo, title, relative)
        add(f"### {title} (`{relative}`)")
        add("")
        add(short_note(note))
        add("")
    add("## 5. Visualizer-specific assessment")
    add("")
    add("### Confirmed from the current repository research")
    add("- The M4 can receive custom DSP measurements through the SHARC-to-M4 SPI frame tail; the existing research documents a tested transport path.")
    add("- The Home/Show UI and Edit UI are distinct views with separate paint registrations in the Stomp research notes.")
    add("- The Home view uses widget erase/draw passes and a framebuffer paint cycle; widget setters invalidate canvases and should not be called at audio rate.")
    add("- Existing HXtra virtual settings and menu patching are documented as HX Stomp-specific; the XL global-settings engine has not been ported.")
    add("")
    add("### Still unproven for XL")
    add("- Exact XL Show View paint hook and safe overlay region.")
    add("- Exact XL Edit View separation and a proof that the overlay cannot leak into Edit View.")
    add("- Exact XL settings storage, menu dispatch, setting ID allocation, and persistence.")
    add("- A safe SHARC-side measurement point for the actual guitar input signal, including silence and sustained-note behavior.")
    add("- Whether the current NAM-modified SHARC image leaves the intended measurement/transport path available without conflicts.")
    add("- A validated XL code/data cave and runtime memory ownership.")
    add("")
    add("## 6. Recommended next research steps")
    add("")
    add("1. Reconcile the payload hash against the known stock firmware source/version metadata. Do not infer modification from the mismatch alone.")
    add("2. Disassemble and compare the XL settings candidates and their callers; resolve getter/label variants and identify the XL settings table.")
    add("3. Trace XL view registration and paint functions independently, identifying Show View and Edit View boundaries.")
    add("4. Trace the XL SHARC receive/send frame path and locate a safe signal measurement point in the actual audio graph.")
    add("5. Verify memory/cave ownership and timing before designing any hook.")
    add("")
    add("## 7. Safety boundary")
    add("")
    add("This report is read-only. It does not alter, rebuild, sign, or flash firmware. Keep the working MAIN and Backup images untouched until the XL hooks, tests, and recovery path have been independently verified.")
    add("")

    output = "\n".join(report)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output)
        print(f"Research report written to: {os.path.abspath(args.output)}")
        print(f"Report length: {len(output):,} characters")
    else:
        print(output)


if __name__ == "__main__":
    main()
