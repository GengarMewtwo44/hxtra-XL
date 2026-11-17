/* HXtra XL Audio Visualizer core.
 * Platform-neutral spectrum processing and screen renderer.
 * Input contract: PCM samples or normalized magnitude bins from a platform adapter.
 */
export class AudioVisualizer {
  constructor({ minHz = 45, maxHz = 16000, bands = 48, attack = 0.58, release = 0.16, peakDecay = 0.012 } = {}) {
    this.minHz = minHz; this.maxHz = maxHz; this.bandCount = bands;
    this.attack = attack; this.release = release; this.peakDecay = peakDecay;
    this.levels = new Float32Array(bands);
    this.peaks = new Float32Array(bands);
    this.raw = new Float32Array(bands);
    this.lastTime = 0;
  }

  // 1024-point radix-2 FFT with Hann window. Output is frequency magnitude.
  analysePcm(input, sampleRate = 48000) {
    const n = 1024, re = new Float32Array(n), im = new Float32Array(n);
    const offset = Math.max(0, input.length - n);
    for (let i = 0; i < n; i++) {
      const sample = input[offset + i] || 0;
      const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
      re[i] = sample * hann;
    }
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const angle = -2 * Math.PI / len, wr0 = Math.cos(angle), wi0 = Math.sin(angle);
      for (let start = 0; start < n; start += len) {
        let wr = 1, wi = 0;
        for (let j = 0; j < len / 2; j++) {
          const even = start + j, odd = even + len / 2;
          const tr = wr * re[odd] - wi * im[odd], ti = wr * im[odd] + wi * re[odd];
          re[odd] = re[even] - tr; im[odd] = im[even] - ti;
          re[even] += tr; im[even] += ti;
          const next = wr * wr0 - wi * wi0; wi = wr * wi0 + wi * wr0; wr = next;
        }
      }
    }
    const mags = new Float32Array(n / 2);
    for (let i = 0; i < mags.length; i++) mags[i] = Math.hypot(re[i], im[i]) * 2 / n;
    this.pushSpectrum(mags, sampleRate);
    return mags;
  }

  // Adapter path for firmware/DSP that supplies frequency magnitudes directly.
  pushSpectrum(magnitudes, sampleRate = 48000) {
    const nyquist = sampleRate / 2;
    const lo = Math.max(1, this.minHz), hi = Math.min(this.maxHz, nyquist);
    for (let b = 0; b < this.bandCount; b++) {
      const f0 = lo * Math.pow(hi / lo, b / this.bandCount);
      const f1 = lo * Math.pow(hi / lo, (b + 1) / this.bandCount);
      const first = Math.max(1, Math.floor(f0 * magnitudes.length * 2 / sampleRate));
      const last = Math.max(first + 1, Math.ceil(f1 * magnitudes.length * 2 / sampleRate));
      let sum = 0, count = 0;
      for (let k = first; k < Math.min(last, magnitudes.length); k++) { sum += magnitudes[k]; count++; }
      const magnitude = count ? sum / count : 0;
      // Log compression gives quiet harmonics room without letting the noise floor dominate.
      this.raw[b] = Math.max(0, Math.min(1, Math.log1p(magnitude * 90) / Math.log1p(90)));
    }
  }

  update(deltaSeconds = 1 / 60, sensitivity = 1) {
    const dt = Math.min(0.05, Math.max(0, deltaSeconds));
    const scale = Math.max(0.25, Math.min(3, sensitivity));
    for (let i = 0; i < this.bandCount; i++) {
      const target = Math.min(1, this.raw[i] * scale);
      const coeff = target > this.levels[i] ? this.attack : this.release;
      this.levels[i] += (target - this.levels[i]) * (1 - Math.pow(1 - coeff, dt * 60));
      this.peaks[i] = Math.max(this.levels[i], this.peaks[i] - this.peakDecay * dt * 60);
    }
  }

  draw(ctx, { x, y, width, height, time = 0, labels = false, grid = false } = {}) {
    const bands = this.bandCount;
    const midY = y + height * 0.48;
    const halfH = Math.min(height * 0.44, midY - y);
    const slotW = width / bands;
    const barW = Math.max(2, slotW * 0.68);
    const segmentGap = 2;
    const segmentH = 4;
    const maxSegments = Math.max(1, Math.floor(halfH / (segmentH + segmentGap)));

    ctx.save();
    // The spectrum floats on true black: no grid, labels, or frequency markings.
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y, width, height);

    // A very restrained central glow gives the mirrored display a luminous anchor.
    const glow = ctx.createLinearGradient(0, midY - 12, 0, midY + 22);
    glow.addColorStop(0, 'rgba(0,125,112,0)');
    glow.addColorStop(0.48, 'rgba(0,125,112,0.16)');
    glow.addColorStop(1, 'rgba(0,125,112,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x, midY - 12, width, 34);

    for (let i = 0; i < bands; i++) {
      const bx = x + i * slotW + (slotW - barW) / 2;
      const active = Math.max(0, Math.min(1, this.levels[i]));
      const peak = Math.max(active, this.peaks[i]);
      const litSegments = Math.min(maxSegments, Math.round(active * maxSegments));
      const peakSegment = Math.min(maxSegments, Math.round(peak * maxSegments));

      // Soft teal halo behind the active column.
      if (litSegments > 0) {
        const top = midY - litSegments * (segmentH + segmentGap);
        ctx.shadowColor = '#00bda9';
        ctx.shadowBlur = 7;
        ctx.fillStyle = 'rgba(0,125,112,0.5)';
        ctx.fillRect(bx - 1, top - 1, barW + 2, litSegments * (segmentH + segmentGap) + 2);
        ctx.shadowBlur = 0;
      }

      for (let s = 0; s < maxSegments; s++) {
        const activeSeg = s < litSegments;
        const peakSeg = s === peakSegment - 1;
        const topY = midY - (s + 1) * (segmentH + segmentGap);
        const bottomY = midY + s * (segmentH + segmentGap);

        if (activeSeg) {
          const intensity = 0.58 + 0.36 * (s / Math.max(1, litSegments));
          ctx.fillStyle = `rgba(56,217,194,${intensity})`;
          ctx.fillRect(bx, topY, barW, segmentH);
          // Mirrored reflection: same shape, fading quickly into black.
          ctx.fillStyle = `rgba(0,125,112,${0.22 * (1 - s / maxSegments)})`;
          ctx.fillRect(bx, bottomY, barW, segmentH);
        }
        if (peakSeg) {
          ctx.fillStyle = '#b9fff5';
          ctx.fillRect(bx, topY - 1, barW, 2);
          ctx.fillStyle = 'rgba(56,217,194,0.22)';
          ctx.fillRect(bx, bottomY, barW, 2);
        }
      }
    }
    ctx.restore();
  }

  reset() { this.levels.fill(0); this.peaks.fill(0); this.raw.fill(0); }
}
