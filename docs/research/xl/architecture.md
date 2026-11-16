# HX Stomp XL 3.80.0 application map

Status tags: **[verified offline]** means checked against the user's supplied stock firmware by checksum and binary inspection. A matching instruction signature is a candidate hook, not proof that the XL function has the same semantics as the HX Stomp function.

## Source image

- Product: HX Stomp XL 3.80.0
- User-supplied stock HXF payload MD5: `329e3a26d60d3de1988b6785fa833ee1`
- Entry 0: LPC43xx main application, Cortex-M4, 7 segments
- The original stock HXF is user-owned and is not stored in this repository.

## Entry 0 segments [verified offline]

| Segment | Load address | Length | End address |
|---:|---:|---:|---:|
| 0 | `0x10000000` | `0xE4` | `0x100000E4` |
| 1 | `0x100000F0` | `0x3548` | `0x10003638` |
| 2 | `0x10080000` | `0x1004` | `0x10081004` |
| 3 | `0x20000000` | `0xC1F0` | `0x2000C1F0` |
| 4 | `0x28000000` | `0x1BE3` | `0x28001BE3` |
| 5 | `0x28001BE4` | `0x184EC` | `0x2801A0D0` |
| 6 | `0x28D92230` | `0xB4014` | `0x28E46244` |

Segment 6 is the large application-code/data region. Its start differs from the HX Stomp 3.80.0 segment 6 base (`0x28D8FA80`). Do not apply a constant address delta: XL function locations must be independently resolved.

## Initial settings-hook candidates [verified offline]

The following byte signatures are documented by HXtra's HX Stomp 3.80.0 `tools/patch_menu.py`. They were searched in XL Entry 0 segment 6.

| HXtra function | HX Stomp address | XL match(es) | Assessment |
|---|---:|---:|---|
| Settings value getter | `0x28E1F844` | `0x28E25C70`, `0x28E266A0` | Two signature matches; first has a function-like prologue and body, second is adjacent to a limits routine and needs call-site analysis |
| Settings limits | `0x28E20280` | `0x28E266AC` | Strong candidate; expected opening bytes match |
| Settings classification | `0x28E20250` | `0x28E2667C` | Strong candidate; expected opening bytes match |
| Settings long-label function | `0x28D97634` | `0x28D9A324`, `0x28D9A3B8` | Ambiguous duplicate prologues; callers and return behavior must identify the correct target |

These are not yet approved patch sites. Before enabling the Global Settings engine, trace call sites, verify function boundaries and calling conventions, identify the XL settings tables, and map the remaining menu navigation/dispatch code.

## Code-cave caution

A large zero-filled run exists in segment 6, beginning at `0x28E34344` and measuring 43,838 bytes. This is only an observation. It is **not** approved as a code cave until references, runtime initialization, memory ownership, and boot-time writes are ruled out.

## Analysis tooling

`tools/xl_firmware.py` is a read-only mapper. It verifies the HXF payload against the embedded size and MD5, parses Entry 0's segment table, and scans the known settings signatures. It does not modify or emit firmware.
