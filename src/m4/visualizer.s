@ visualizer.s - XL visualizer's DSP-to-M4 spectrum frame receiver.
@
@ Frame contract (XL transport already verified on the unit):
@   word 200: 0x600DF00D marker
@   word 201: 0x0000565A tag ("VZ")
@   word 202: monotonically increasing producer counter
@   words 203..250: 48 unsigned Q15 band magnitudes, low 16 bits
@
@ The M4 sees each 32-bit SPI word with its halfwords exchanged, so rotate
@ right 16 before checking/using the fields. The producer is not installed yet;
@ this receiver is deliberately inert until a matching marker and tag arrive.
@ No display hook is installed by this module.

.syntax unified
.thumb

.equ VIZ_MARKER, 0xf00d600d
.equ VIZ_TAG,    0x0000565a
.equ VIZ_BANDS,  48
.equ VIZ_FIRST_WORD, 203
.equ VIZ_MARKER_OFFSET, 800
.equ VIZ_TAG_OFFSET, 804
.equ VIZ_COUNT_OFFSET, 808
.equ VIZ_BANDS_OFFSET, (VIZ_FIRST_WORD * 4)

.thumb_func
visualizer_frame:                   @ r1 = 1 KB RX frame, called before stock receiver
    push {r0-r7, lr}
    sub sp, #4                      @ keep the stack 8-byte aligned across this callback
    adr.w r4, visualizer_state

    @ Reject unrelated frames. The marker is the transport probe's established
    @ marker; the tag prevents interpreting another feature's payload as bands.
    ldr r0, [r1, #VIZ_MARKER_OFFSET]
    ldr r2, =VIZ_MARKER
    cmp r0, r2
    bne visualizer_frame_out

    ldr r0, [r1, #VIZ_TAG_OFFSET]
    ror r0, r0, #16
    ldr r2, =VIZ_TAG
    cmp r0, r2
    bne visualizer_frame_out

    @ Remember that a valid spectrum has arrived and its producer sequence.
    ldr r0, [r1, #VIZ_COUNT_OFFSET]
    ror r0, r0, #16
    str r0, [r4, #4]
    movs r0, #1
    str r0, [r4]

    @ Copy 48 Q15 magnitudes. Each occupies the low halfword after ROR #16.
    addw r5, r1, #VIZ_BANDS_OFFSET
    addw r6, r4, #8
    movs r7, #VIZ_BANDS
visualizer_copy_band:
    ldr r0, [r5], #4
    ror r0, r0, #16
    uxth r0, r0
    strh r0, [r6], #2
    subs r7, #1
    bne visualizer_copy_band

visualizer_frame_out:
    add sp, #4
    pop {r0-r7, pc}

@ Read-only state layout for the later Show View renderer:
@   +0 valid flag; +4 producer sequence; +8 48 x uint16 Q15 band values.
.balign 4
visualizer_state:
    .word 0
    .word 0
visualizer_levels:
    .space (VIZ_BANDS * 2)
