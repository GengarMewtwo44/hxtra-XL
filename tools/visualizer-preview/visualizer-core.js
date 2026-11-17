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
    const bands = this.bandCount, gap = 1.25, barW = width / bands;
    const midY = y + height / 2;
    const halfH = height * 0.47;
    ctx.save();

    // Pure black field: no frequency labels, grid, or decorative background.
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y, width, height);

    // A restrained center horizon gives the mirrored spectrum a visual anchor.
    const horizon = ctx.createLinearGradient(x, midY, x + width, midY);
    horizon.addColorStop(0, 'rgba(0,125,112,0)');
    horizon.addColorStop(0.5, 'rgba(56,217,194,0.26)');
    horizon.addColorStop(1, 'rgba(0,125,112,0)');
    ctx.fillStyle = horizon;
    ctx.fillRect(x, midY - 1, width, 2);

    for (let i = 0; i < bands; i++) {
      const bx = x + i * barW + gap / 2;
      const bw = Math.max(1, barW - gap);
      const level = Math.max(0, Math.min(1, this.levels[i]));
      const peak = Math.max(level, Math.min(1, this.peaks[i]));
      const h = level * halfH;
      const ph = peak * halfH;
      if (h < 0.65 && ph < 1) continue;

      // Soft atmospheric bloom, then a darker extruded edge for depth.
      ctx.save();
      ctx.shadowColor = '#00a995';
      ctx.shadowBlur = 5 + level * 13;
      ctx.fillStyle = 'rgba(0,125,112,0.24)';
      ctx.fillRect(bx - 1.5, midY - h - 2, bw + 3, h * 2 + 4);
      ctx.restore();

      // Dark side faces create a subtle beveled / 3D pillar appearance.
      ctx.fillStyle = '#075b54';
      ctx.fillRect(bx, midY - h, Math.max(1, bw * 0.22), h);
      ctx.fillRect(bx, midY, Math.max(1, bw * 0.22), h);
      ctx.fillStyle = '#087f73';
      ctx.fillRect(bx + bw * 0.78, midY - h, Math.max(1, bw * 0.22), h);
      ctx.fillRect(bx + bw * 0.78, midY, Math.max(1, bw * 0.22), h);

      // Main luminous faces fade from deep teal at the outside to bright cyan at the core.
      const upper = ctx.createLinearGradient(0, midY - h, 0, midY);
      upper.addColorStop(0, '#08796f');
      upper.addColorStop(0.48, '#18b9a7');
      upper.addColorStop(1, '#8affee');
      ctx.fillStyle = upper;
      ctx.fillRect(bx + bw * 0.22, midY - h, Math.max(1, bw * 0.56), h);

      const lower = ctx.createLinearGradient(0, midY, 0, midY + h);
      lower.addColorStop(0, '#8affee');
      lower.addColorStop(0.52, '#18b9a7');
      lower.addColorStop(1, '#075b54');
      ctx.fillStyle = lower;
      ctx.fillRect(bx + bw * 0.22, midY, Math.max(1, bw * 0.56), h);

      // Fine highlight on the inside edge sells the glass-like illuminated surface.
      ctx.fillStyle = 'rgba(210,255,249,0.72)';
      ctx.fillRect(bx + bw * 0.22, midY - h, Math.max(1, bw * 0.11), h);
      ctx.fillRect(bx + bw * 0.22, midY, Math.max(1, bw * 0.11), h);

      // Peak caps remain mirrored and decay smoothly after transients.
      ctx.fillStyle = 'rgba(185,255,245,0.88)';
      ctx.shadowColor = '#38d9c2';
      ctx.shadowBlur = 4;
      ctx.fillRect(bx, midY - ph - 1, bw, 1.5);
      ctx.fillRect(bx, midY + ph - 0.5, bw, 1.5);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  reset() { this.levels.fill(0); this.peaks.fill(0); this.raw.fill(0); }
}
