"use client";

import type { AudioDiagnostics, MonitorMode } from "@/lib/binaural-engine";

interface Props {
  holding: boolean;
  visualsEnabled: boolean;
  monitorMode: MonitorMode;
  diagnostics: AudioDiagnostics | null;
  onHoldChange: (holding: boolean) => void;
  onVisualsChange: (enabled: boolean) => void;
  onMonitorChange: (mode: MonitorMode) => void;
  onDownloadReference: () => void;
}

export function AudioLabPanel({
  holding, visualsEnabled, monitorMode, diagnostics,
  onHoldChange, onVisualsChange, onMonitorChange, onDownloadReference,
}: Props) {
  return (
    <details className="rounded-xl border border-teal-300/20 bg-[#111716] text-xs">
      <summary className="cursor-pointer px-4 py-3 font-medium text-teal-200 focus-visible:outline-2 focus-visible:outline-teal-300">
        Sound Lab <span className="ml-1 font-normal text-stone-500">/ A–B diagnostics &amp; isolation</span>
      </summary>
      <div className="space-y-4 border-t border-stone-800 p-4">
        <p className="leading-relaxed text-stone-400">Isolate variables one at a time: hold Δf constant, monitor a single channel, or disable rendering entirely. Controls here never modify the saved symphony.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={holding} onClick={() => onHoldChange(!holding)} className={`rounded-lg border px-3 py-2 ${holding ? "border-amber-400/50 bg-amber-500/15 text-amber-200" : "border-stone-700 text-stone-300"}`}>
            {holding ? "Beat held · Resume journey" : "Hold this beat"}
          </button>
          <button type="button" aria-pressed={!visualsEnabled} onClick={() => onVisualsChange(!visualsEnabled)} className={`rounded-lg border px-3 py-2 ${!visualsEnabled ? "border-teal-400/50 bg-teal-500/15 text-teal-200" : "border-stone-700 text-stone-300"}`}>
            {visualsEnabled ? "Try audio only" : "Audio only · Restore visuals"}
          </button>
        </div>
        <div>
          <p className="mb-2 text-stone-400">Headphone monitoring</p>
          <div className="flex rounded-lg border border-stone-700 p-1">
            {(["stereo", "left", "right"] as const).map((mode) => (
              <button type="button" key={mode} aria-pressed={monitorMode === mode} onClick={() => onMonitorChange(mode)} className={`flex-1 rounded-md py-1.5 ${monitorMode === mode ? "bg-stone-700 text-stone-50" : "text-stone-400"}`}>
                {mode === "stereo" ? "Stereo" : mode === "left" ? "Left only" : "Right only"}
              </button>
            ))}
          </div>
          {monitorMode !== "stereo" && <p className="mt-2 text-[11px] text-amber-200">Single-ear check active. Choose Stereo to hear the binaural pair again.</p>}
        </div>
        <button type="button" onClick={onDownloadReference} className="w-full rounded-lg border border-stone-700 px-3 py-2 text-stone-200 hover:border-teal-300/50">Download 8-second reference WAV</button>
        <p className="text-[11px] leading-relaxed text-stone-500">The reference WAV renders the current f_L / f_R pair offline at −18 dBFS with no room layer. Compare it in an external player: if it clicks there too, the artifact is downstream of the browser.</p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-stone-800 pt-3 font-mono text-[10px] text-stone-500">
          <dt>Engine</dt><dd className="text-right text-teal-200">{diagnostics ? "Native audio-clock" : "Ready on Play"}</dd>
          <dt>Sample rate</dt><dd className="text-right">{diagnostics ? `${(diagnostics.sampleRate / 1000).toFixed(1)} kHz` : "—"}</dd>
          <dt>Buffer latency</dt><dd className="text-right">{diagnostics ? `${diagnostics.baseLatencyMs.toFixed(1)} ms` : "—"}</dd>
        </dl>
        <details className="text-[11px] leading-relaxed text-stone-500">
          <summary className="cursor-pointer text-stone-400">Signal path notes</summary>
          <p className="mt-2">Stereo output keeps f_L and f_R fully separated; Σ(L+R)/2 and the XY figure are computed views of the generated signals, not measurements of the listener. Band names classify the programmed Δf. Keep volume comfortable.</p>
        </details>
      </div>
    </details>
  );
}
