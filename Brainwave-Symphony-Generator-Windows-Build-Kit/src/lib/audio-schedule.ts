import type { SymphonyStage, TransitionMode } from "@/db/schema";

export function interpolateValue(
  start: number,
  end: number,
  t: number,
  mode: TransitionMode
): number {
  const progress = Math.max(0, Math.min(1, t));
  if (mode === "step") {
    const weight = Math.max(0, (progress - 0.92) / 0.08);
    return start + (end - start) * weight;
  }
  if (mode === "linear_ramp") {
    const weight = Math.max(0, (progress - 0.35) / 0.65);
    return start + (end - start) * weight;
  }
  const glide = Math.max(0, (progress - 0.25) / 0.75);
  return start + (end - start) * ((1 - Math.cos(glide * Math.PI)) / 2);
}

export function sequenceDuration(stages: SymphonyStage[]): number {
  return stages.reduce((sum, stage) => sum + Math.max(5, stage.durationSec), 0);
}

export function sampleSequence(
  stages: SymphonyStage[],
  elapsedSec: number,
  continuousGlide: boolean
) {
  const totalDurationSec = sequenceDuration(stages);
  const position = Math.max(0, Math.min(totalDurationSec, elapsedSec));
  if (!stages.length) {
    return {
      carrierHz: 216,
      beatHz: 10,
      stageIndex: 0,
      stageElapsedSec: 0,
      stageProgress: 0,
      totalElapsedSec: 0,
      totalDurationSec: 0,
    };
  }

  let startTime = 0;
  let stageIndex = stages.length - 1;
  for (let index = 0; index < stages.length; index++) {
    const duration = Math.max(5, stages[index].durationSec);
    if (position < startTime + duration || index === stages.length - 1) {
      stageIndex = index;
      break;
    }
    startTime += duration;
  }

  const stage = stages[stageIndex];
  const next = stages[stageIndex + 1] ?? stage;
  const stageElapsedSec = Math.max(0, position - startTime);
  const stageProgress = Math.min(1, stageElapsedSec / Math.max(5, stage.durationSec));
  const carrier = continuousGlide
    ? interpolateValue(stage.carrierHz, next.carrierHz, stageProgress, stage.transitionType)
    : stage.carrierHz;
  const beat = continuousGlide
    ? interpolateValue(stage.beatHz, next.beatHz, stageProgress, stage.transitionType)
    : stage.beatHz;

  return {
    carrierHz: Math.max(40, Math.min(900, carrier)),
    beatHz: Math.max(0.5, Math.min(55, beat)),
    stageIndex,
    stageElapsedSec,
    stageProgress,
    totalElapsedSec: position,
    totalDurationSec,
  };
}

/** Native AudioParam curves are interpolated by the audio renderer, not React. */
export function buildFrequencyCurves(
  stages: SymphonyStage[],
  offsetSec: number,
  continuousGlide: boolean,
  bridgeFrom?: { carrierHz: number; beatHz: number },
  windowDurationSec?: number
) {
  const total = sequenceDuration(stages);
  const offset = Math.max(0, Math.min(Math.max(0, total - 0.001), offsetSec));
  const remaining = Math.max(0.001, total - offset);
  const duration =
    windowDurationSec !== undefined && Number.isFinite(windowDurationSec)
      ? Math.max(0.001, Math.min(remaining, windowDurationSec))
      : remaining;
  const count = Math.max(2, Math.ceil(duration * 128) + 1);
  const left = new Float32Array(count);
  const right = new Float32Array(count);

  for (let index = 0; index < count; index++) {
    const localTime = (index / (count - 1)) * duration;
    const sample = sampleSequence(stages, offset + localTime, continuousGlide);
    let carrier = sample.carrierHz;
    let beat = sample.beatHz;
    // Smooth the frequency boundary at a loop seam, without resetting phase.
    if (bridgeFrom && localTime < 0.04) {
      const blend = (1 - Math.cos((localTime / 0.04) * Math.PI)) / 2;
      carrier = bridgeFrom.carrierHz + (carrier - bridgeFrom.carrierHz) * blend;
      beat = bridgeFrom.beatHz + (beat - bridgeFrom.beatHz) * blend;
    }
    left[index] = carrier;
    right[index] = carrier + beat;
  }

  return { left, right, duration, offset };
}

/** A quiet reference WAV bypasses real-time synthesis, canvas and scheduling. */
export function makeReferenceWav(
  carrierHz: number,
  beatHz: number,
  monitor: "stereo" | "left" | "right" = "stereo",
  seconds = 8
): Blob {
  const sampleRate = 48000;
  const frameCount = Math.round(Math.max(1, Math.min(30, seconds)) * sampleRate);
  const pcmBytes = frameCount * 4;
  const buffer = new ArrayBuffer(44 + pcmBytes);
  const view = new DataView(buffer);
  const writeText = (at: number, text: string) => {
    for (let index = 0; index < text.length; index++) view.setUint8(at + index, text.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes, true);
  writeText(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, pcmBytes, true);
  const leftHz = Math.max(40, Math.min(900, carrierHz));
  const rightHz = leftHz + Math.max(0.5, Math.min(55, beatHz));
  for (let frame = 0; frame < frameCount; frame++) {
    const time = frame / sampleRate;
    const fade = Math.min(1, time / 0.05, (frameCount - frame - 1) / (sampleRate * 0.05));
    const level = 0.12 * Math.max(0, fade);
    const leftValue = monitor === "right" ? 0 : Math.sin(2 * Math.PI * leftHz * time) * level;
    const rightValue = monitor === "left" ? 0 : Math.sin(2 * Math.PI * rightHz * time) * level;
    view.setInt16(44 + frame * 4, Math.round(leftValue * 32767), true);
    view.setInt16(46 + frame * 4, Math.round(rightValue * 32767), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
