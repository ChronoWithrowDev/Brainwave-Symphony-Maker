import type { AmbientTexture, BrainwaveBand, SymphonyStage } from "@/db/schema";
import { buildFrequencyCurves, sampleSequence, sequenceDuration } from "./audio-schedule";
export { interpolateValue } from "./audio-schedule";

export const WAVEFORM_SIZE = 8192;
export type MonitorMode = "stereo" | "left" | "right";

export interface LiveAudioTelemetry {
  isPlaying: boolean;
  carrierHz: number;
  rightEarHz: number;
  beatHz: number;
  band: BrainwaveBand;
  stageIndex: number;
  stageElapsedSec: number;
  stageProgress: number;
  totalElapsedSec: number;
  totalDurationSec: number;
}

export interface AudioDiagnostics {
  backend: string;
  sampleRate: number;
  baseLatencyMs: number;
  outputLatencyMs: number | null;
  state: string;
}

interface Voice {
  left: OscillatorNode;
  right: OscillatorNode;
  leftGain: GainNode;
  rightGain: GainNode;
  leftAnalyser: AnalyserNode;
  rightAnalyser: AnalyserNode;
}

export function classifyBandFromBeatHz(beatHz: number): BrainwaveBand {
  if (beatHz < 4) return "DELTA";
  if (beatHz < 8) return "THETA";
  if (beatHz <= 13) return "ALPHA";
  if (beatHz <= 30) return "BETA";
  return "GAMMA";
}

function disconnectNodes(nodes: AudioNode[]) {
  for (const node of nodes) {
    try {
      if ("stop" in node) (node as OscillatorNode).stop();
    } catch { /* A scheduled source may already be stopped. */ }
    try { node.disconnect(); } catch { /* Disconnected already. */ }
  }
}

function voiceNodes(voice: Voice): AudioNode[] {
  return [voice.left, voice.right, voice.leftGain, voice.rightGain, voice.leftAnalyser, voice.rightAnalyser];
}

export class BinauralSymphonyEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private binauralGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private leftMonitor: GainNode | null = null;
  private rightMonitor: GainNode | null = null;
  private merger: ChannelMergerNode | null = null;
  private voice: Voice | null = null;
  private ambientNodes: AudioNode[] = [];
  private currentTexture: AmbientTexture = "pure_sine";
  private masterVolume = 0.45;
  private ambientVolume = 0;
  private monitorMode: MonitorMode = "stereo";
  private isRunning = false;
  private generation = 0;
  private loopScheduler: ReturnType<typeof setInterval> | null = null;
  private sequenceStartedAt = 0;
  private sequenceOffset = 0;
  private sequenceTotal = 0;
  private holding = false;
  private fixedCarrier = 216;
  private fixedBeat = 10;

  private ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      // Playback buffering trades a little control latency for more underrun headroom.
      // Let the browser use the output device's native sample rate.
      this.ctx = new AudioCtx({ latencyHint: "playback" });
    }
    return this.ctx;
  }

  public async start(
    initialCarrierHz: number,
    initialBeatHz: number,
    texture: AmbientTexture,
    masterVol: number,
    ambientVol: number
  ): Promise<void> {
    if (typeof window === "undefined") return;
    this.stop();
    const generation = ++this.generation;
    const ctx = this.ensureContext();
    await ctx.resume();
    if (generation !== this.generation) return;

    this.masterVolume = Math.max(0, Math.min(1, masterVol));
    this.ambientVolume = Math.max(0, Math.min(0.85, ambientVol));
    this.currentTexture = texture;
    this.fixedCarrier = initialCarrierHz;
    this.fixedBeat = initialBeatHz;
    const now = ctx.currentTime;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(0, now);
    this.masterGain.gain.linearRampToValueAtTime(this.masterVolume, now + 0.09);
    this.masterGain.connect(ctx.destination);

    this.binauralGain = ctx.createGain();
    this.binauralGain.gain.value = 0.35;
    this.binauralGain.connect(this.masterGain);
    this.merger = ctx.createChannelMerger(2);
    this.merger.connect(this.binauralGain);
    this.leftMonitor = ctx.createGain();
    this.rightMonitor = ctx.createGain();
    this.leftMonitor.channelCount = this.rightMonitor.channelCount = 1;
    this.leftMonitor.channelCountMode = this.rightMonitor.channelCountMode = "explicit";
    this.leftMonitor.connect(this.merger, 0, 0);
    this.rightMonitor.connect(this.merger, 0, 1);
    this.leftMonitor.gain.value = this.monitorMode === "right" ? 0 : 1;
    this.rightMonitor.gain.value = this.monitorMode === "left" ? 0 : 1;

    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = this.ambientVolume;
    this.ambientGain.connect(this.masterGain);
    this.isRunning = true;
    this.holding = true;
    this.voice = this.createVoice(initialCarrierHz, initialBeatHz, now + 0.01);
    this.buildAmbientLayer(texture, initialCarrierHz);
  }

  private createVoice(carrierHz: number, beatHz: number, startAt: number): Voice {
    const ctx = this.ctx!;
    const left = ctx.createOscillator();
    const right = ctx.createOscillator();
    left.type = right.type = "sine";
    left.frequency.value = Math.max(40, Math.min(900, carrierHz));
    right.frequency.value = left.frequency.value + Math.max(0.5, Math.min(55, beatHz));
    const leftGain = ctx.createGain();
    const rightGain = ctx.createGain();
    for (const gain of [leftGain, rightGain]) {
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(1, startAt + 0.045);
    }
    left.connect(leftGain);
    right.connect(rightGain);
    leftGain.connect(this.leftMonitor!);
    rightGain.connect(this.rightMonitor!);

    // Analysis is a parallel observation branch, never an inline audio dependency.
    const leftAnalyser = ctx.createAnalyser();
    const rightAnalyser = ctx.createAnalyser();
    leftAnalyser.fftSize = rightAnalyser.fftSize = WAVEFORM_SIZE;
    leftAnalyser.smoothingTimeConstant = rightAnalyser.smoothingTimeConstant = 0;
    left.connect(leftAnalyser);
    right.connect(rightAnalyser);
    left.start(startAt);
    right.start(startAt);
    return { left, right, leftGain, rightGain, leftAnalyser, rightAnalyser };
  }

  private retireVoice(voice: Voice, crossfadeAt = this.ctx!.currentTime) {
    const now = this.ctx!.currentTime;
    for (const gain of [voice.leftGain, voice.rightGain]) {
      const held = gain.gain.value;
      if (typeof gain.gain.cancelAndHoldAtTime === "function") gain.gain.cancelAndHoldAtTime(now);
      else {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(held, now);
      }
      gain.gain.setValueAtTime(held, crossfadeAt);
      gain.gain.linearRampToValueAtTime(0, crossfadeAt + 0.045);
    }
    setTimeout(() => disconnectNodes(voiceNodes(voice)), Math.ceil((crossfadeAt - now) * 1000) + 90);
  }

  /** Called only for play/edit/seek/hold, never for React telemetry ticks. */
  public setSequence(
    stages: SymphonyStage[],
    offsetSec: number,
    continuousGlide: boolean,
    hold = false
  ): void {
    if (!this.ctx || !this.isRunning || !stages.length) return;
    if (this.loopScheduler) clearInterval(this.loopScheduler);
    this.loopScheduler = null;
    const total = sequenceDuration(stages);
    const offset = ((Math.max(0, offsetSec) % total) + total) % total;
    const first = sampleSequence(stages, offset, continuousGlide);
    const last = sampleSequence(stages, total, continuousGlide);
    const CHUNK_SECONDS = 30;
    const LOOKAHEAD_SECONDS = 65;

    // Build only bounded chunks before choosing a start timestamp. Scheduling an
    // entire long symphony as one curve can take longer than the lead time; the
    // browser then clamps that curve's start and the following loop overlaps it.
    const firstChunk = hold
      ? null
      : buildFrequencyCurves(stages, offset, continuousGlide, undefined, CHUNK_SECONDS);
    let secondChunk = null;
    if (firstChunk) {
      const secondOffset = firstChunk.offset + firstChunk.duration;
      const wraps = secondOffset >= total - 0.000001;
      secondChunk = buildFrequencyCurves(
        stages,
        wraps ? 0 : secondOffset,
        continuousGlide,
        wraps ? last : undefined,
        CHUNK_SECONDS
      );
    }

    const startAt = this.ctx.currentTime + 0.2;
    const previous = this.voice;
    const voice = this.createVoice(first.carrierHz, first.beatHz, startAt);
    this.voice = voice;
    if (previous) this.retireVoice(previous, startAt);
    this.sequenceStartedAt = startAt;
    this.sequenceOffset = offset;
    this.sequenceTotal = total;
    this.holding = hold;
    this.fixedCarrier = first.carrierHz;
    this.fixedBeat = first.beatHz;
    if (hold || !firstChunk || !secondChunk) return;

    let nextAt = startAt;
    let nextPosition = offset;
    let nextBridge: { carrierHz: number; beatHz: number } | undefined;
    const prebuilt = [firstChunk, secondChunk];

    const scheduleNextChunk = (): boolean => {
      const chunk =
        prebuilt.shift() ??
        buildFrequencyCurves(
          stages,
          nextPosition,
          continuousGlide,
          nextBridge,
          CHUNK_SECONDS
        );
      try {
        voice.left.frequency.setValueCurveAtTime(chunk.left, nextAt, chunk.duration);
        voice.right.frequency.setValueCurveAtTime(chunk.right, nextAt, chunk.duration);
      } catch (error) {
        // A scheduling failure must never take down the whole application. The
        // oscillators retain their last frequency while the UI remains usable.
        console.error("Unable to schedule the next audio segment", error);
        if (this.loopScheduler) clearInterval(this.loopScheduler);
        this.loopScheduler = null;
        return false;
      }

      const endPosition = chunk.offset + chunk.duration;
      if (endPosition >= total - 0.000001) {
        nextPosition = 0;
        nextBridge = last;
      } else {
        nextPosition = endPosition;
        nextBridge = undefined;
      }
      nextAt += chunk.duration;
      return true;
    };

    if (!scheduleNextChunk() || !scheduleNextChunk()) return;

    this.loopScheduler = setInterval(() => {
      if (this.voice !== voice || !this.ctx) return;
      while (nextAt < this.ctx.currentTime + LOOKAHEAD_SECONDS) {
        if (!scheduleNextChunk()) break;
      }
    }, 500);
  }

  public getPosition(): number {
    if (!this.ctx || this.holding || !this.isRunning) return this.sequenceOffset;
    const delta = Math.max(0, this.ctx.currentTime - this.sequenceStartedAt);
    return this.sequenceTotal > 0 ? (this.sequenceOffset + delta) % this.sequenceTotal : 0;
  }

  public setMonitorMode(mode: MonitorMode): void {
    this.monitorMode = mode;
    if (!this.ctx) return;
    this.leftMonitor?.gain.setTargetAtTime(mode === "right" ? 0 : 1, this.ctx.currentTime, 0.015);
    this.rightMonitor?.gain.setTargetAtTime(mode === "left" ? 0 : 1, this.ctx.currentTime, 0.015);
  }

  public getDiagnostics(): AudioDiagnostics | null {
    if (!this.ctx) return null;
    return {
      backend: "Native · audio-clock timeline",
      sampleRate: this.ctx.sampleRate,
      baseLatencyMs: this.ctx.baseLatency * 1000,
      outputLatencyMs: "outputLatency" in this.ctx ? this.ctx.outputLatency * 1000 : null,
      state: this.ctx.state,
    };
  }

  public readWaveforms(left: Float32Array<ArrayBuffer>, right: Float32Array<ArrayBuffer>): number | null {
    if (!this.ctx || !this.isRunning || !this.voice) return null;
    this.voice.leftAnalyser.getFloatTimeDomainData(left);
    this.voice.rightAnalyser.getFloatTimeDomainData(right);
    return this.ctx.sampleRate;
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.025);
    }
  }

  public setAmbientVolume(volume: number): void {
    this.ambientVolume = Math.max(0, Math.min(0.85, volume));
    if (this.ctx && this.ambientGain && this.isRunning) {
      this.ambientGain.gain.setTargetAtTime(this.ambientVolume, this.ctx.currentTime, 0.04);
      if (this.ambientVolume > 0 && !this.ambientNodes.length) {
        this.buildAmbientLayer(this.currentTexture, this.fixedCarrier);
      }
    }
  }

  public setAmbientTexture(texture: AmbientTexture, carrierHz: number): void {
    this.currentTexture = texture;
    if (this.isRunning) this.buildAmbientLayer(texture, carrierHz);
  }

  public testStereoChannel(channel: "left" | "right"): void {
    if (typeof window === "undefined") return;
    const ctx = this.ensureContext();
    void ctx.resume();
    const source = ctx.createOscillator();
    const gain = ctx.createGain();
    const merger = ctx.createChannelMerger(2);
    source.frequency.value = 440;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.035);
    gain.gain.linearRampToValueAtTime(0, now + 0.45);
    source.connect(gain);
    gain.connect(merger, 0, channel === "left" ? 0 : 1);
    merger.connect(ctx.destination);
    source.start(now);
    source.stop(now + 0.5);
    source.onended = () => disconnectNodes([source, gain, merger]);
  }

  private buildAmbientLayer(texture: AmbientTexture, baseCarrierHz: number): void {
    disconnectNodes(this.ambientNodes);
    this.ambientNodes = [];
    if (!this.ctx || !this.ambientGain || texture === "pure_sine" || this.ambientVolume === 0) return;
    const ctx = this.ctx;
    if (texture === "pink_rain") {
      const buffer = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const samples = buffer.getChannelData(channel);
        let smoothed = 0;
        for (let index = 0; index < samples.length; index++) {
          smoothed = smoothed * 0.98 + (Math.random() * 2 - 1) * 0.02;
          samples[index] = smoothed * 0.3;
        }
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 950;
      source.connect(filter);
      filter.connect(this.ambientGain);
      source.start();
      this.ambientNodes = [source, filter];
      return;
    }
    const root = ctx.createOscillator();
    const fifth = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    root.type = texture === "cello_drone" ? "sawtooth" : "sine";
    fifth.type = "triangle";
    root.frequency.value = Math.max(55, baseCarrierHz * 0.5);
    fifth.frequency.value = Math.max(55, baseCarrierHz * (texture === "cello_drone" ? 0.75 : 0.502));
    filter.type = "lowpass";
    filter.frequency.value = texture === "cello_drone" ? 240 : 320;
    gain.gain.value = 0.18;
    root.connect(filter);
    fifth.connect(filter);
    filter.connect(gain);
    gain.connect(this.ambientGain);
    root.start();
    fifth.start();
    this.ambientNodes = [root, fifth, filter, gain];
  }

  public stop(): void {
    this.generation++;
    if (this.loopScheduler) clearInterval(this.loopScheduler);
    this.loopScheduler = null;
    if (!this.ctx) return;
    this.sequenceOffset = this.getPosition();
    this.isRunning = false;
    const nodes = [
      ...(this.voice ? voiceNodes(this.voice) : []),
      ...this.ambientNodes,
      this.leftMonitor, this.rightMonitor, this.merger,
      this.binauralGain, this.ambientGain, this.masterGain,
    ].filter((node): node is AudioNode => node !== null);
    if (this.masterGain) {
      const now = this.ctx.currentTime;
      const held = this.masterGain.gain.value;
      if (typeof this.masterGain.gain.cancelAndHoldAtTime === "function") this.masterGain.gain.cancelAndHoldAtTime(now);
      else {
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setValueAtTime(held, now);
      }
      this.masterGain.gain.linearRampToValueAtTime(0, now + 0.045);
    }
    this.voice = null;
    this.ambientNodes = [];
    this.masterGain = this.binauralGain = this.ambientGain = null;
    this.leftMonitor = this.rightMonitor = null;
    this.merger = null;
    setTimeout(() => disconnectNodes(nodes), 90);
  }

  public getIsRunning(): boolean { return this.isRunning; }
}

export function computeSymphonyTelemetry(
  stages: SymphonyStage[],
  elapsedSec: number,
  isPlaying: boolean,
  continuousGlide: boolean
): LiveAudioTelemetry {
  const sample = sampleSequence(stages, elapsedSec, continuousGlide);
  return {
    ...sample,
    isPlaying,
    band: classifyBandFromBeatHz(sample.beatHz),
    carrierHz: Number(sample.carrierHz.toFixed(2)),
    beatHz: Number(sample.beatHz.toFixed(2)),
    rightEarHz: Number((sample.carrierHz + sample.beatHz).toFixed(2)),
  };
}
