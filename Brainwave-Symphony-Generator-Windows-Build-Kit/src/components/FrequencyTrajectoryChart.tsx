"use client";

import React, { useMemo } from "react";
import type { SymphonyStage } from "@/db/schema";
import {
  interpolateValue,
  type LiveAudioTelemetry,
} from "@/lib/binaural-engine";
import { BRAINWAVE_BANDS } from "@/lib/ledger-data";

interface FrequencyTrajectoryChartProps {
  stages: SymphonyStage[];
  telemetry: LiveAudioTelemetry;
  continuousGlide: boolean;
  onSeekSeconds: (seconds: number) => void;
}

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 320;
const PLOT = { left: 68, top: 20, right: 22, bottom: 48 };
const PLOT_WIDTH = VIEW_WIDTH - PLOT.left - PLOT.right;
const PLOT_HEIGHT = VIEW_HEIGHT - PLOT.top - PLOT.bottom;
const MAX_BEAT_HZ = 50;

const FREQUENCY_BANDS = [
  { key: "GAMMA" as const, low: 30, high: 50 },
  { key: "BETA" as const, low: 13, high: 30 },
  { key: "ALPHA" as const, low: 8, high: 13 },
  { key: "THETA" as const, low: 4, high: 8 },
  { key: "DELTA" as const, low: 0, high: 4 },
];

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function xForTime(seconds: number, totalDuration: number): number {
  return PLOT.left + (Math.max(0, seconds) / Math.max(1, totalDuration)) * PLOT_WIDTH;
}

function yForFrequency(frequency: number): number {
  const clamped = Math.max(0, Math.min(MAX_BEAT_HZ, frequency));
  return PLOT.top + ((MAX_BEAT_HZ - clamped) / MAX_BEAT_HZ) * PLOT_HEIGHT;
}

export function FrequencyTrajectoryChart({
  stages,
  telemetry,
  continuousGlide,
  onSeekSeconds,
}: FrequencyTrajectoryChartProps) {
  const stageDurations = stages.map((stage) => Math.max(5, stage.durationSec));
  const totalDuration = stageDurations.reduce((sum, duration) => sum + duration, 0);

  const stageGeometry = useMemo(() => {
    let elapsed = 0;
    return stages.map((stage, index) => {
      const duration = Math.max(5, stage.durationSec);
      const next = stages[index + 1] ?? stage;
      const sampleCount = Math.max(18, Math.ceil(duration / 2));
      const points: string[] = [];

      for (let step = 0; step <= sampleCount; step++) {
        const progress = step / sampleCount;
        const frequency = continuousGlide
          ? interpolateValue(
              stage.beatHz,
              next.beatHz,
              progress,
              stage.transitionType
            )
          : stage.beatHz;
        const time = elapsed + duration * progress;
        points.push(
          `${step === 0 ? "M" : "L"} ${xForTime(time, totalDuration).toFixed(2)} ${yForFrequency(frequency).toFixed(2)}`
        );
      }

      const geometry = {
        index,
        startTime: elapsed,
        endTime: elapsed + duration,
        path: points.join(" "),
        color: BRAINWAVE_BANDS[stage.band].color,
        band: stage.band,
        name: stage.name,
      };
      elapsed += duration;
      return geometry;
    });
  }, [continuousGlide, stages, totalDuration]);

  const xTicks = [0, 0.25, 0.5, 0.75, 1];
  const yTicks = [0, 4, 8, 13, 20, 30, 40, 50];
  const cursorX = xForTime(telemetry.totalElapsedSec, totalDuration);
  const cursorY = yForFrequency(telemetry.beatHz);
  const activeStage = stageGeometry[telemetry.stageIndex];

  const seekFromClientX = (clientX: number, svg: SVGSVGElement) => {
    const bounds = svg.getBoundingClientRect();
    if (bounds.width <= 0 || totalDuration <= 0) return;
    const viewX = ((clientX - bounds.left) / bounds.width) * VIEW_WIDTH;
    const ratio = Math.max(
      0,
      Math.min(1, (viewX - PLOT.left) / PLOT_WIDTH)
    );
    onSeekSeconds(ratio * totalDuration);
  };

  const handleScrubClick = (event: React.MouseEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement;
    if (svg) seekFromClientX(event.clientX, svg);
  };

  const handleScrubKeyDown = (event: React.KeyboardEvent<SVGRectElement>) => {
    const amount = event.shiftKey ? 30 : 5;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onSeekSeconds(Math.max(0, telemetry.totalElapsedSec - amount));
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onSeekSeconds(Math.min(totalDuration, telemetry.totalElapsedSec + amount));
    } else if (event.key === "Home") {
      event.preventDefault();
      onSeekSeconds(0);
    } else if (event.key === "End") {
      event.preventDefault();
      onSeekSeconds(totalDuration);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-amber-200/15 bg-[#0D0B09] shadow-xl">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-800/80 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-stone-100">
            Frequency trajectory
          </h3>
          <p className="mt-0.5 text-[11px] text-stone-400">
            Binaural difference <span className="font-mono text-amber-200">Δf = f_R − f_L</span> versus time · click or focus the plot to seek
          </p>
        </div>
        <div className="rounded-lg border border-stone-700/80 bg-stone-950/80 px-3 py-1.5 font-mono text-xs">
          <span className="text-stone-400">NOW </span>
          <span style={{ color: BRAINWAVE_BANDS[telemetry.band].color }}>
            {telemetry.beatHz.toFixed(2)} Hz
          </span>
          <span className="ml-2 text-stone-500">{formatTime(telemetry.totalElapsedSec)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-stone-800/70 px-4 py-2">
        {FREQUENCY_BANDS.slice().reverse().map(({ key }) => (
          <span key={key} className="inline-flex items-center gap-1.5 text-[10px] text-stone-400">
            <span
              className="h-2 w-2 rounded-sm"
              style={{ backgroundColor: BRAINWAVE_BANDS[key].color }}
            />
            {BRAINWAVE_BANDS[key].name} · {BRAINWAVE_BANDS[key].rangeLabel}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        className="block h-[250px] w-full touch-none sm:h-[290px]"
        role="group"
        aria-label="Binaural beat frequency trajectory chart"
      >
        <rect x="0" y="0" width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="#0D0B09" />

        {/* Frequency-band reference zones */}
        {FREQUENCY_BANDS.map(({ key, low, high }) => {
          const top = yForFrequency(high);
          const bottom = yForFrequency(low);
          return (
            <rect
              key={`zone-${key}`}
              x={PLOT.left}
              y={top}
              width={PLOT_WIDTH}
              height={bottom - top}
              fill={BRAINWAVE_BANDS[key].color}
              opacity={0.075}
            />
          );
        })}

        {/* Active movement wash */}
        {activeStage && (
          <rect
            x={xForTime(activeStage.startTime, totalDuration)}
            y={PLOT.top}
            width={Math.max(0, xForTime(activeStage.endTime, totalDuration) - xForTime(activeStage.startTime, totalDuration))}
            height={PLOT_HEIGHT}
            fill={activeStage.color}
            opacity={0.045}
          />
        )}

        {/* Grid and calibrated axes */}
        {yTicks.map((frequency) => {
          const y = yForFrequency(frequency);
          return (
            <g key={`y-${frequency}`}>
              <line
                x1={PLOT.left}
                y1={y}
                x2={VIEW_WIDTH - PLOT.right}
                y2={y}
                stroke={frequency === 0 ? "rgba(245,239,230,0.26)" : "rgba(245,239,230,0.11)"}
                strokeDasharray={frequency === 0 ? undefined : "3 6"}
              />
              <text
                x={PLOT.left - 12}
                y={y + 4}
                textAnchor="end"
                fill="rgba(245,239,230,0.62)"
                fontSize="11"
                fontFamily="monospace"
              >
                {frequency}
              </text>
            </g>
          );
        })}

        {xTicks.map((ratio) => {
          const x = PLOT.left + ratio * PLOT_WIDTH;
          return (
            <g key={`x-${ratio}`}>
              <line
                x1={x}
                y1={PLOT.top}
                x2={x}
                y2={PLOT.top + PLOT_HEIGHT}
                stroke="rgba(245,239,230,0.1)"
                strokeDasharray="3 6"
              />
              <text
                x={x}
                y={VIEW_HEIGHT - 18}
                textAnchor={ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"}
                fill="rgba(245,239,230,0.58)"
                fontSize="11"
                fontFamily="monospace"
              >
                {formatTime(totalDuration * ratio)}
              </text>
            </g>
          );
        })}

        {/* Movement dividers */}
        {stageGeometry.slice(1).map((stage) => {
          const x = xForTime(stage.startTime, totalDuration);
          return (
            <line
              key={`divider-${stage.index}`}
              x1={x}
              y1={PLOT.top}
              x2={x}
              y2={PLOT.top + PLOT_HEIGHT}
              stroke="rgba(245,239,230,0.2)"
              strokeDasharray="2 5"
            />
          );
        })}

        {/* One colored trace per movement, sampled from the exact transition curve */}
        {stageGeometry.map((stage) => (
          <path
            key={`trace-${stage.index}`}
            d={stage.path}
            fill="none"
            stroke={stage.color}
            strokeWidth={stage.index === telemetry.stageIndex ? 3.5 : 2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={stage.index === telemetry.stageIndex ? 1 : 0.82}
          />
        ))}

        {/* Playhead and current frequency marker */}
        <line
          x1={cursorX}
          y1={PLOT.top}
          x2={cursorX}
          y2={PLOT.top + PLOT_HEIGHT}
          stroke="#F5EFE6"
          strokeWidth="1.5"
          opacity="0.82"
        />
        <circle
          cx={cursorX}
          cy={cursorY}
          r="6"
          fill={BRAINWAVE_BANDS[telemetry.band].color}
          stroke="#F5EFE6"
          strokeWidth="2"
        />

        <text
          x={18}
          y={PLOT.top + PLOT_HEIGHT / 2}
          transform={`rotate(-90 18 ${PLOT.top + PLOT_HEIGHT / 2})`}
          textAnchor="middle"
          fill="rgba(245,239,230,0.7)"
          fontSize="11"
          fontFamily="monospace"
        >
          Δf · Hz
        </text>
        <text
          x={PLOT.left + PLOT_WIDTH / 2}
          y={VIEW_HEIGHT - 2}
          textAnchor="middle"
          fill="rgba(245,239,230,0.52)"
          fontSize="10"
          fontFamily="monospace"
        >
          SYMPHONY TIME
        </text>

        {/* Keyboard-accessible seek target on top of the plot */}
        <rect
          x={PLOT.left}
          y={PLOT.top}
          width={PLOT_WIDTH}
          height={PLOT_HEIGHT}
          fill="transparent"
          role="slider"
          tabIndex={0}
          aria-label="Seek through binaural beat frequency trajectory"
          aria-valuemin={0}
          aria-valuemax={Math.round(totalDuration)}
          aria-valuenow={Math.round(telemetry.totalElapsedSec)}
          aria-valuetext={`${formatTime(telemetry.totalElapsedSec)} of ${formatTime(totalDuration)}, ${telemetry.beatHz.toFixed(1)} hertz binaural difference`}
          onClick={handleScrubClick}
          onKeyDown={handleScrubKeyDown}
          className="cursor-crosshair outline-none focus-visible:stroke-amber-200 focus-visible:stroke-2"
        />
      </svg>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-800/80 px-4 py-2 text-[10px] text-stone-500">
        <span>
          Δf(t) = f_R − f_L · programmed beat-frequency trajectory across all movements
        </span>
        <span className="font-mono text-stone-400">
          {continuousGlide ? "TRANSITION CURVES ON" : "STAGE TARGETS · GLIDE OFF"}
        </span>
      </div>
    </section>
  );
}
