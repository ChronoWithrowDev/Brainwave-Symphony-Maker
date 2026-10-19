"use client";

import React, { useEffect, useRef, useState } from "react";
import { BRAINWAVE_BANDS } from "@/lib/ledger-data";
import { WAVEFORM_SIZE, type LiveAudioTelemetry } from "@/lib/binaural-engine";

export type WaveformSampleReader = (
  left: Float32Array<ArrayBuffer>,
  right: Float32Array<ArrayBuffer>
) => number | null;

interface Props {
  telemetry: LiveAudioTelemetry;
  readWaveforms: WaveformSampleReader;
}

function sampleAt(samples: Float32Array, position: number): number {
  const index = Math.max(0, Math.min(samples.length - 2, Math.floor(position)));
  const blend = Math.max(0, Math.min(1, position - index));
  return samples[index] + (samples[index + 1] - samples[index]) * blend;
}

/** Latest rising zero crossing with room for `count` samples after it. */
function triggerAt(samples: Float32Array, count: number, period: number): number {
  const end = Math.max(1, samples.length - count - 3);
  const start = Math.max(1, end - Math.ceil(period * 1.5));
  for (let index = end; index >= start; index--) {
    if (samples[index - 1] <= 0 && samples[index] > 0) {
      const difference = samples[index] - samples[index - 1];
      return index - 1 - samples[index - 1] / Math.max(0.000001, difference);
    }
  }
  return end;
}

export function PhaseInterferenceCanvas({ telemetry, readWaveforms }: Props) {
  const wavesRef = useRef<HTMLCanvasElement>(null);
  const orbitRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef(new Float32Array(WAVEFORM_SIZE));
  const rightRef = useRef(new Float32Array(WAVEFORM_SIZE));
  const latest = useRef(telemetry);
  const captured = useRef(false);
  const rate = useRef(48000);
  const orbitDirty = useRef(true);
  const [sampleRate, setSampleRate] = useState<number | null>(null);
  const [view, setView] = useState<"envelope" | "zoom">("envelope");
  const [showOrbit, setShowOrbit] = useState(true);

  useEffect(() => { latest.current = telemetry; }, [telemetry]);
  useEffect(() => { orbitDirty.current = true; }, [showOrbit]);

  useEffect(() => {
    const waves = wavesRef.current;
    const orbit = orbitRef.current;
    if (!waves) return;
    const waveContext = waves.getContext("2d");
    const orbitContext = orbit?.getContext("2d");
    if (!waveContext) return;
    let frameId = 0;
    let lastDraw = -1000;
    let visible = true;
    const bounds = { waveWidth: 600, waveHeight: 320, orbitWidth: 200, orbitHeight: 320 };
    const resize = new ResizeObserver(() => {
      const rect = waves.getBoundingClientRect();
      bounds.waveWidth = rect.width;
      bounds.waveHeight = rect.height;
      if (orbit) {
        const orbitRect = orbit.getBoundingClientRect();
        bounds.orbitWidth = orbitRect.width;
        bounds.orbitHeight = orbitRect.height;
      }
      lastDraw = -1000;
      orbitDirty.current = true;
      if (!latest.current.isPlaying) draw(performance.now());
    });
    resize.observe(waves);
    if (orbit) resize.observe(orbit);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    intersection.observe(waves);

    function fitCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, width: number, height: number): boolean {
      const ratio = Math.min(1.5, window.devicePixelRatio || 1);
      const pixelWidth = Math.max(1, Math.round(width * ratio));
      const pixelHeight = Math.max(1, Math.round(height * ratio));
      let changed = false;
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        changed = true;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineJoin = "round";
      context.lineCap = "round";
      return changed;
    }

    function draw(timestamp: number) {
      const current = latest.current;
      const active = current.isPlaying;
      if (active && (timestamp - lastDraw < 1000 / 30 || !visible || document.hidden)) {
        frameId = requestAnimationFrame(draw);
        return;
      }
      lastDraw = timestamp;
      if (active) {
        const nextRate = readWaveforms(leftRef.current, rightRef.current);
        if (nextRate) {
          rate.current = nextRate;
          if (!captured.current) setSampleRate(nextRate);
          captured.current = true;
        }
      }
      const width = bounds.waveWidth;
      const height = bounds.waveHeight;
      if (width <= 0 || height <= 0) {
        if (active) frameId = requestAnimationFrame(draw);
        return;
      }
      fitCanvas(waves!, waveContext!, width, height);
      const ctx = waveContext!;
      ctx.fillStyle = "#0D0B09";
      ctx.fillRect(0, 0, width, height);
      const sourceRate = rate.current;
      const bandSpec = BRAINWAVE_BANDS[current.band];
      const carrierPeriod = sourceRate / Math.max(40, current.carrierHz);
      // ENVELOPE: full analyser history so lane 3's beat envelope breathes at Δf.
      // ZOOM: six trigger-locked carrier cycles for individual waveform shape.
      const zoom = view === "zoom";
      const windowSamples = zoom
        ? Math.round(carrierPeriod * 6)
        : WAVEFORM_SIZE - 4;
      const leftStart = zoom ? triggerAt(leftRef.current, windowSamples, carrierPeriod) : 0;
      const rightStart = zoom ? triggerAt(rightRef.current, windowSamples, sourceRate / Math.max(40.5, current.rightEarHz)) : 0;
      const plotLeft = 46;
      const plotRight = width - 14;
      const plotWidth = Math.max(1, plotRight - plotLeft);
      const rowHeight = (height - 46) / 3;
      const colors = ["#F59E0B", "#2DD4BF", bandSpec.color];
      const labels = [
        `LEFT CARRIER · f_L = ${current.carrierHz.toFixed(1)} Hz`,
        `RIGHT CARRIER · f_R = f_L + Δf = ${current.rightEarHz.toFixed(1)} Hz`,
        `Σ = (L+R)/2 · ENVELOPE Δf = ${current.beatHz.toFixed(2)} Hz [${bandSpec.symbol} ${bandSpec.name.toUpperCase()}]`,
      ];
      // Time-axis grid
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(245,239,230,0.06)";
      for (let tick = 1; tick < 4; tick++) {
        const x = plotLeft + (plotWidth * tick) / 4;
        ctx.beginPath();
        ctx.moveTo(x, 14);
        ctx.lineTo(x, height - 18);
        ctx.stroke();
      }
      const points = Math.min(1600, Math.max(480, Math.round(plotWidth * 2)));
      ctx.font = "10px monospace";
      for (let lane = 0; lane < 3; lane++) {
        const center = 22 + rowHeight * (lane + 0.5);
        const amplitude = rowHeight * 0.33;
        ctx.fillStyle = colors[lane];
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.font = lane === 2 ? "bold 10px monospace" : "10px monospace";
        ctx.fillText(labels[lane], plotLeft, center - amplitude - 6, plotWidth);
        for (const guide of [-1, 0, 1]) {
          const y = center - guide * amplitude;
          ctx.beginPath();
          ctx.strokeStyle = guide === 0 ? "rgba(245,239,230,0.22)" : "rgba(245,239,230,0.07)";
          ctx.setLineDash(guide === 0 ? [] : [3, 5]);
          ctx.moveTo(plotLeft, y);
          ctx.lineTo(plotRight, y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(245,239,230,0.32)";
        ctx.textAlign = "right";
        ctx.font = "8px monospace";
        ctx.fillText("+1", plotLeft - 6, center - amplitude + 3);
        ctx.fillText("0", plotLeft - 6, center + 3);
        ctx.fillText("−1", plotLeft - 6, center + amplitude + 3);
        if (captured.current) {
          ctx.beginPath();
          ctx.strokeStyle = colors[lane];
          ctx.lineWidth = lane === 2 ? 2.3 : 1.6;
          ctx.shadowColor = colors[lane];
          ctx.shadowBlur = lane === 2 ? 9 : 4;
          for (let point = 0; point <= points; point++) {
            const fraction = point / points;
            const delta = fraction * windowSamples;
            let value = 0;
            if (lane === 0) value = sampleAt(leftRef.current, leftStart + delta);
            else if (lane === 1) value = sampleAt(rightRef.current, rightStart + delta);
            else value = (sampleAt(leftRef.current, leftStart + delta) + sampleAt(rightRef.current, leftStart + delta)) / 2;
            const x = plotLeft + fraction * plotWidth;
            const y = center - value * amplitude;
            if (!point) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        } else {
          ctx.beginPath();
          ctx.strokeStyle = "rgba(245,239,230,0.25)";
          ctx.lineWidth = 1.3;
          ctx.setLineDash([5, 6]);
          ctx.moveTo(plotLeft, center);
          ctx.lineTo(plotRight, center);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      // Time axis in milliseconds across the analyser window
      ctx.fillStyle = "rgba(245,239,230,0.34)";
      ctx.font = "9px monospace";
      ctx.textBaseline = "bottom";
      const windowMs = (windowSamples / sourceRate) * 1000;
      for (let tick = 0; tick <= 4; tick++) {
        ctx.textAlign = tick === 0 ? "left" : tick === 4 ? "right" : "center";
        if (tick === 3 && plotWidth < 420) continue;
        const label = tick === 4
          ? `${windowMs.toFixed(1)} ms`
          : `${((tick / 4) * windowMs).toFixed(1)}`;
        ctx.fillText(label, plotLeft + (tick / 4) * plotWidth, height - 4);
      }

      if (showOrbit && orbit && orbitContext) {
        const ow = bounds.orbitWidth;
        const oh = bounds.orbitHeight;
        const oc = orbitContext;
        const resized = fitCanvas(orbit, oc, ow, oh);
        if (resized || orbitDirty.current || !active) {
          oc.fillStyle = "#0D0B09";
          oc.fillRect(0, 0, ow, oh);
          orbitDirty.current = false;
        } else {
          // Phosphor persistence: previous sweeps decay instead of vanishing,
          // so the ellipse precessing at Δf leaves a visible rotating trail.
          oc.fillStyle = "rgba(13,11,9,0.22)";
          oc.fillRect(0, 0, ow, oh);
        }
        const cx = ow / 2;
        const cy = oh / 2;
        const radius = Math.max(24, Math.min(ow * 0.36, oh * 0.33));
        oc.lineWidth = 1;
        oc.strokeStyle = "rgba(245,239,230,0.1)";
        oc.beginPath();
        oc.arc(cx, cy, radius + 8, 0, Math.PI * 2);
        oc.moveTo(cx - radius - 14, cy);
        oc.lineTo(cx + radius + 14, cy);
        oc.moveTo(cx, cy - radius - 14);
        oc.lineTo(cx, cy + radius + 14);
        oc.stroke();
        oc.font = "9px monospace";
        oc.textAlign = "center";
        oc.fillStyle = "rgba(245,239,230,0.6)";
        oc.fillText("LISSAJOUS X·Y", cx, 14);
        oc.fillStyle = "rgba(245,239,230,0.35)";
        oc.fillText("x = L(t)   y = R(t)", cx, 26);
        if (captured.current) {
          // Draw the freshest ~2 carrier cycles each frame; precession at Δf
          // plus persistence traces the full phase figure over time.
          const cycleSamples = sourceRate / Math.max(40, current.carrierHz);
          const sweep = Math.min(WAVEFORM_SIZE - 4, Math.max(32, Math.round(cycleSamples * 2)));
          const start = WAVEFORM_SIZE - sweep - 2;
          const gradient = oc.createLinearGradient(cx - radius, cy + radius, cx + radius, cy - radius);
          gradient.addColorStop(0, "#F59E0B");
          gradient.addColorStop(0.5, bandSpec.color);
          gradient.addColorStop(1, "#2DD4BF");
          oc.strokeStyle = gradient;
          oc.lineWidth = 1.7;
          oc.shadowColor = bandSpec.color;
          oc.shadowBlur = 7;
          oc.beginPath();
          for (let point = 0; point <= 220; point++) {
            const at = start + (point / 220) * sweep;
            const x = cx + sampleAt(leftRef.current, at) * radius;
            const y = cy - sampleAt(rightRef.current, at) * radius;
            if (!point) oc.moveTo(x, y);
            else oc.lineTo(x, y);
          }
          oc.stroke();
          oc.shadowBlur = 0;
          oc.fillStyle = bandSpec.color;
          oc.textAlign = "center";
          oc.fillText(`PHASE DRIFT Δf = ${current.beatHz.toFixed(2)} Hz`, cx, oh - 8);
        } else {
          oc.fillStyle = "rgba(245,239,230,0.25)";
          oc.fillText("AWAITING SIGNAL", cx, cy + 3);
        }
      }
      if (active) frameId = requestAnimationFrame(draw);
    }

    frameId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frameId);
      resize.disconnect();
      intersection.disconnect();
    };
  }, [readWaveforms, showOrbit, view, telemetry.isPlaying]);

  const windowLabel = sampleRate
    ? `${WAVEFORM_SIZE} SAMPLES · ${((WAVEFORM_SIZE / sampleRate) * 1000).toFixed(1)} ms · ${(sampleRate / 1000).toFixed(1)} kHz`
    : `${WAVEFORM_SIZE} SAMPLE WINDOW`;

  return (
    <section className="overflow-hidden rounded-xl border border-amber-200/15 bg-[#0D0B09] shadow-xl">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-800/80 px-4 py-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-100">
            <span>Live 3-Channel Oscilloscope</span>
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
              L · R · Σ(L+R)/2
            </span>
          </h3>
          <p className="mt-0.5 text-[11px] text-stone-400">
            Real analyser samples. Channel 3 sums both carriers — the interference envelope breathes at exactly <span className="font-mono text-amber-200">Δf = {telemetry.beatHz.toFixed(2)} Hz</span>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <div className="flex rounded-lg border border-stone-700 p-0.5 font-mono" aria-label="Oscilloscope time window">
            {(["envelope", "zoom"] as const).map((mode) => (
              <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)} className={`rounded-md px-2 py-1 ${view === mode ? "bg-amber-500/20 text-amber-200" : "text-stone-400 hover:text-stone-100"}`}>
                {mode === "envelope" ? "ENVELOPE" : "ZOOM ×6"}
              </button>
            ))}
          </div>
          <button type="button" aria-pressed={showOrbit} onClick={() => setShowOrbit(!showOrbit)} className={`rounded-lg border px-2 py-1.5 font-mono ${showOrbit ? "border-teal-400/40 bg-teal-500/15 text-teal-200" : "border-stone-700 text-stone-400 hover:text-stone-100"}`}>
            {showOrbit ? "XY PHASE ON" : "XY PHASE OFF"}
          </button>
          <span className={`rounded-md border px-2 py-1.5 font-mono ${telemetry.isPlaying ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : "border-stone-700 bg-stone-950 text-stone-400"}`}>
            {telemetry.isPlaying ? "LIVE" : sampleRate ? "HELD" : "READY"}
          </span>
        </div>
      </div>
      <div className={`grid ${showOrbit ? "sm:grid-cols-[minmax(0,1fr)_200px]" : "grid-cols-1"}`}>
        <div className="relative min-w-0">
          <canvas ref={wavesRef} className="block h-[300px] w-full sm:h-[330px]" aria-label="Oscilloscope of left carrier, right carrier, and their normalized sum" />
          {!sampleRate && !telemetry.isPlaying && (
            <p className="pointer-events-none absolute inset-x-12 top-1/2 -translate-y-1/2 rounded-lg border border-stone-700/80 bg-stone-950/90 p-2 text-center text-[11px] text-stone-400">
              Press Play to sample f_L, f_R, and the interference sum.
            </p>
          )}
        </div>
        {showOrbit && <canvas ref={orbitRef} className="block h-[210px] w-full border-t border-stone-800 sm:h-[330px] sm:border-t-0 sm:border-l" aria-label="Lissajous XY phase figure of left versus right carrier with persistence trail" />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-800/80 px-4 py-2 text-[10px] text-stone-500">
        <span>
          <strong className="text-amber-200/90">Interference:</strong> <code className="text-stone-300">Σ(t) = [sin(2πf_L·t) + sin(2πf_R·t)]/2</code> — constructive and destructive beating at <code className="text-amber-300">f_R − f_L</code>. The XY figure precesses once per beat cycle.
        </span>
        <span className="font-mono text-stone-400">{windowLabel}</span>
      </div>
    </section>
  );
}
