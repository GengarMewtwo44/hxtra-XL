# HX Stomp XL port plan

This note tracks the port of HXtra's Cortex-M4 features to the HX Stomp XL 3.80.0. It is a research plan, not evidence that any feature works on an XL. Keep XL findings separate from HX Stomp findings until each is independently verified.

## Confirmed starting point

- **[verified offline]** `build.py` recognizes the stock HX Stomp XL 3.80.0 firmware by MD5 `329e3a26d60d3de1988b6785fa833ee1`.
- **[verified offline]** The current XL build path installs the NAM A2 Lite SHARC kernel and updates the model/graph data. It deliberately does not call `tools/patch_menu.py`.
- **[verified offline]** `tools/patch_menu.py` explicitly describes itself as HX Stomp-only. Its M4 base address, settings tables, hooks, and code-cave assumptions are HX Stomp-specific.
- **[verified offline]** The feature modules in `tools/features/` use HX Stomp 3.80.0 addresses and expected stock bytes. Their current tests therefore do not establish XL compatibility.
- **[verified offline]** The XL's NAM path is already represented in `build.py`, but the upstream documentation says that XL build has not been tested on an actual XL.

## Porting rules

1. Never apply an HX Stomp M4 patch to the XL merely because the same function or feature exists conceptually.
2. Identify the XL Entry 0 code segment, virtual address mapping, code/data boundaries, writable cave space, and relevant stock routines from the user's own stock firmware.
3. Re-discover every hook on the XL. Record the XL address, expected stock bytes, calling convention, and evidence. Do not copy HX Stomp addresses into XL feature code.
4. Keep XL patch definitions separate from HX Stomp definitions where layouts differ. Share feature logic only after the hardware-facing interface is explicit.
5. Add negative tests proving the XL path cannot accidentally invoke the HX Stomp patch engine.
6. Validate container/archive checksums and patch invariants offline first. Emulator success is not hardware compatibility.
7. Do not install an experimental image until a feature has a reviewed XL patch, repeatable offline tests, a recovery procedure, and a staged on-device validation plan.

## Feature inventory

The following are HXtra features to assess individually. "Unmapped" means the XL hook and data layout have not yet been established; it does not mean the feature is impossible.

| Feature | Main XL dependencies to rediscover |
|---|---|
| Global Settings / feature engine | Settings store, menu navigation, parameter labels, limits tables, image strip, code-cave allocator |
| BPM display | Home view construction/paint, tempo store callbacks, tap LED task and LED send |
| Breathing line | Home divider/widgets, paint passes, animation clock |
| DSP meter | Edit view paint, model browser paint, model list layout |
| Gain-reduction meter | DSP receive-frame callback, Home paint, compressor model/parameter plumbing |
| Long press / virtual footswitches | Key-event handler, function dispatch, MIDI bypass assignment and labels |
| Six snapshots | Snapshot manager, footswitch dispatch, CC 69 handling, preset serialization |
| Tuner enhancements | Tuner page state, knob/event handling, tap-tempo call sites |
| Tap LED colors | LED update path and color encoding |
| Real block names | Model-name tables and display formatting |
| Boot screen | Boot/application ownership of the image and image-store format |
| Metronome block | DSP graph/model integration plus signal-flow UI/category rendering |
| Screen mirror | USB editor/service command handling and transport protocol |

## Work sequence

### Phase 1 — XL firmware map
- Verify the supplied stock file's full-file MD5 before parsing.
- Parse the HXF container and L6IA archive read-only; validate their internal sizes and checksums.
- Identify Entry 0 segments and derive XL-specific virtual-address-to-file-offset mapping.
- Produce a compact map of Entry 0, Entry 2, Entry 3, Entry 4, and image-store entries. Do not commit firmware bytes or extracted Line 6 code/data.

### Phase 2 — M4 port foundation
- Build an XL-specific disassembly and symbol/address notebook containing only addresses, short descriptions, and stock-byte fingerprints.
- Implement an XL patch context with bounds checks, expected-byte checks, overlap detection, and code-cave allocation.
- Add tests for address translation, patch boundaries, overlap rejection, and wrong-firmware rejection.
- Keep the existing HX Stomp engine unchanged.

### Phase 3 — Feature ports
- Port one feature at a time, starting with features that need the fewest shared UI hooks.
- Add XL-specific tests for every hook and data structure.
- Keep features opt-in during development; no default-on XL feature set until the complete combination is tested for conflicts and resource limits.

### Phase 4 — Device validation
- Confirm a reliable stock recovery route before any experimental run.
- Prefer a non-installing RAM test path if the XL boot/loader protocol supports it and is independently verified.
- Test one feature at a time, then combinations. Record exact build hashes and observed results.
- Treat NAM audio validation and M4 UI validation as separate test tracks.

## Current status

**Phase 1 is waiting on the user's local stock HX Stomp XL 3.80.0 file.** The repository can be audited in parallel, but exact XL addresses and patch locations must come from that file. The stock firmware remains local and must never be committed.
