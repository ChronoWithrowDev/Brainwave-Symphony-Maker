"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  SkipBack,
  Volume2,
  Waves,
  Plus,
  Trash2,
  Save,
  Sparkles,
  BookOpen,
  Copy,
  Check,
  Headphones,
  Sliders,
  Heart,
  Clock,
  Activity,
  Radio,
  Send,
  Users,
  Compass,
  Download,
  Upload,
} from "lucide-react";
import type {
  AmbientTexture,
  BrainwaveBand,
  SessionLogRecord,
  StewardRecord,
  SymphonyRecord,
  SymphonyStage,
  TransitionMode,
} from "@/db/schema";
import {
  AMBIENT_TEXTURES,
  BRAINWAVE_BANDS,
  DEFAULT_SYMPHONIES,
  LEDGER_TEXT,
} from "@/lib/ledger-data";
import {
  BinauralSymphonyEngine,
  classifyBandFromBeatHz,
  computeSymphonyTelemetry,
  type AudioDiagnostics,
  type MonitorMode,
} from "@/lib/binaural-engine";
import { makeReferenceWav } from "@/lib/audio-schedule";
import { AudioLabPanel } from "@/components/AudioLabPanel";
import { PhaseInterferenceCanvas } from "@/components/PhaseInterferenceCanvas";
import { FrequencyTrajectoryChart } from "@/components/FrequencyTrajectoryChart";
import { LedgerVaultDrawer } from "@/components/LedgerVaultDrawer";
import { OriginsArchiveDrawer } from "@/components/OriginsArchiveDrawer";
import { StewardManagerModal } from "@/components/StewardManagerModal";

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem.toString().padStart(2, "0")}`;
}

interface StageNumberFieldProps {
  id: string;
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  precision: number;
  onCommit: (value: number) => void;
}

function StageNumberField({
  id, label, value, minimum, maximum, step, precision, onCommit,
}: StageNumberFieldProps) {
  const format = (number: number) => number.toFixed(precision);
  const [draft, setDraft] = useState(format(value));
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setDraft(format(value));
  }, [value, precision]);

  const commit = (raw: string) => {
    editing.current = false;
    const parsed = Number(raw.trim());
    if (raw.trim() !== "" && Number.isFinite(parsed)) onCommit(parsed);
    else setDraft(format(value));
  };

  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      min={minimum}
      max={maximum}
      step={step}
      value={draft}
      aria-label={label}
      onFocus={() => { editing.current = true; }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.value = format(value);
          setDraft(format(value));
          event.currentTarget.blur();
        }
      }}
      className="w-[5.7rem] rounded-md border border-stone-700 bg-stone-950 px-2 py-1.5 text-right font-mono text-xs font-semibold text-stone-100 outline-none transition focus:border-amber-400/70 focus:ring-1 focus:ring-amber-400/30"
    />
  );
}

export function BrainwaveSymphonyStudio() {
  // Database-backed state
  const [symphoniesList, setSymphoniesList] = useState<SymphonyRecord[]>([]);
  const [stewardsList, setStewardsList] = useState<StewardRecord[]>([]);
  const [sessionLogs, setSessionLogs] = useState<SessionLogRecord[]>([]);
  const [ledgerText, setLedgerText] = useState<string>(LEDGER_TEXT);
  const [ledgerVersion, setLedgerVersion] = useState<string>("v9.2");
  const [loading, setLoading] = useState<boolean>(true);

  // Active Steward & Personal Library Filter
  const [activeStewardName, setActiveStewardName] = useState<string>("Shared Clearing");
  const [libraryFilter, setLibraryFilter] = useState<"all" | "shared" | "personal">("all");

  // Active Symphony & editable working copy
  const [activeSymphonyId, setActiveSymphonyId] = useState<number | null>(null);
  const [title, setTitle] = useState<string>(DEFAULT_SYMPHONIES[0].title);
  const [subtitle, setSubtitle] = useState<string>(DEFAULT_SYMPHONIES[0].subtitle);
  const [author, setAuthor] = useState<string>(DEFAULT_SYMPHONIES[0].author);
  const [stewardName, setStewardName] = useState<string>("Shared Clearing");
  const [description, setDescription] = useState<string>(DEFAULT_SYMPHONIES[0].description);
  const [stages, setStages] = useState<SymphonyStage[]>(DEFAULT_SYMPHONIES[0].stages);
  const [ambientTexture, setAmbientTexture] = useState<AmbientTexture>("pure_sine");
  // Default to 0.0 per Ptolemy's request: raw sine waves hitting the skull
  const [ambientLevel, setAmbientLevel] = useState<number>(0.0);
  const [masterVolume, setMasterVolume] = useState<number>(0.45);
  const [continuousGlide, setContinuousGlide] = useState<boolean>(true);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const elapsedSecRef = useRef(0);
  const startingRef = useRef(false);
  const [audioStarting, setAudioStarting] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isToneHeld, setIsToneHeld] = useState(false);
  const [visualsEnabled, setVisualsEnabled] = useState(true);
  const [monitorMode, setMonitorMode] = useState<MonitorMode>("stereo");
  const [audioDiagnostics, setAudioDiagnostics] = useState<AudioDiagnostics | null>(null);

  // Headphone channel test feedback
  const [channelTestActive, setChannelTestActive] = useState<"left" | "right" | null>(null);

  // Modals & Drawers
  const [originsDrawerOpen, setOriginsDrawerOpen] = useState<boolean>(false);
  const [stewardModalOpen, setStewardModalOpen] = useState<boolean>(false);
  const [ledgerDrawerOpen, setLedgerDrawerOpen] = useState<boolean>(false);
  const [quickCopied, setQuickCopied] = useState<boolean>(false);

  // Session Logging
  const [sessionNote, setSessionNote] = useState<string>("");
  const [savingSymphony, setSavingSymphony] = useState<boolean>(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [loggingSession, setLoggingSession] = useState<boolean>(false);

  // File import ref
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Audio Engine Ref
  const engineRef = useRef<BinauralSymphonyEngine | null>(null);
  const readWaveforms = useCallback(
    (
      leftSamples: Float32Array<ArrayBuffer>,
      rightSamples: Float32Array<ArrayBuffer>
    ) => engineRef.current?.readWaveforms(leftSamples, rightSamples) ?? null,
    []
  );

  const selectSymphonyRecord = useCallback((sym: SymphonyRecord) => {
    setActiveSymphonyId(sym.id);
    setTitle(sym.title);
    setSubtitle(sym.subtitle);
    setAuthor(sym.author);
    setStewardName(sym.stewardName);
    setDescription(sym.description);
    setStages(sym.stages);
    setAmbientTexture(sym.ambientTexture);
    // Respect the 0% default if user hasn't actively raised it
    setAmbientLevel(sym.ambientLevel ?? 0.0);
    elapsedSecRef.current = 0;
    setElapsedSec(0);
    setIsToneHeld(false);
  }, []);

  // Load initial data from PostgreSQL API
  useEffect(() => {
    let mounted = true;
    async function fetchInitial() {
      try {
        const res = await fetch("/api/symphonies");
        if (!res.ok) throw new Error("Failed to load");
        const data = await res.json();
        if (!mounted) return;

        if (Array.isArray(data.stewards)) {
          setStewardsList(data.stewards);
        }

        if (Array.isArray(data.symphonies) && data.symphonies.length > 0) {
          setSymphoniesList(data.symphonies);
          selectSymphonyRecord(data.symphonies[0]);
        }
        if (Array.isArray(data.sessionLogs)) {
          setSessionLogs(data.sessionLogs);
        }
        if (data.ledger?.content) {
          setLedgerText(data.ledger.content);
          setLedgerVersion(data.ledger.version || "v9.2");
        }
      } catch (err) {
        console.error("Initial load error:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchInitial();
    return () => {
      mounted = false;
    };
  }, [selectSymphonyRecord]);

  // Compute live telemetry from current stages + elapsedSec
  const telemetry = computeSymphonyTelemetry(
    stages,
    elapsedSec,
    isPlaying,
    continuousGlide
  );

  // Keyboard shortcut listener (Space = play/pause, Left/Right = skip)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input or textarea
      if (
        ledgerDrawerOpen || originsDrawerOpen || stewardModalOpen ||
        (e.target instanceof Element && e.target.closest("input, textarea, select, button, [role='slider'], [contenteditable='true']"))
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        handleJumpToStage(Math.min(stages.length - 1, telemetry.stageIndex + 1));
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        handleJumpToStage(Math.max(0, telemetry.stageIndex - 1));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // Schedule a whole journey once. UI redraws never reschedule the audio.
  useEffect(() => {
    if (!isPlaying || !engineRef.current) return;
    engineRef.current.setSequence(stages, elapsedSecRef.current, continuousGlide, isToneHeld);
  }, [isPlaying, stages, continuousGlide, isToneHeld]);

  // The display follows the AudioContext clock, not a drifting performance timer.
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      const position = engineRef.current?.getPosition() ?? elapsedSecRef.current;
      elapsedSecRef.current = position;
      setElapsedSec(position);
    }, 100);
    return () => clearInterval(timer);
  }, [isPlaying]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.stop();
    };
  }, []);

  const handleTogglePlay = async () => {
    if (startingRef.current) return;
    if (!engineRef.current) engineRef.current = new BinauralSymphonyEngine();
    const engine = engineRef.current;
    if (isPlaying) {
      const position = engine.getPosition();
      elapsedSecRef.current = position;
      setElapsedSec(position);
      engine.stop();
      setIsPlaying(false);
      return;
    }
    startingRef.current = true;
    setAudioStarting(true);
    setAudioError(null);
    try {
      engine.setMonitorMode(monitorMode);
      await engine.start(telemetry.carrierHz, telemetry.beatHz, ambientTexture, masterVolume, ambientLevel);
      if (!engine.getIsRunning()) return;
      setAudioDiagnostics(engine.getDiagnostics());
      setIsPlaying(true);
      if (activeSymphonyId) {
        fetch("/api/symphonies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "increment_play", id: activeSymphonyId }),
        }).catch(() => {});
      }
    } catch (error) {
      engine.stop();
      setAudioError(error instanceof Error ? error.message : "Could not start audio. Try Play again.");
    } finally {
      startingRef.current = false;
      setAudioStarting(false);
    }
  };

  const handleSeek = (seconds: number) => {
    const total = telemetry.totalDurationSec;
    const target = Math.max(0, Math.min(Math.max(0, total - 0.001), seconds));
    elapsedSecRef.current = target;
    setElapsedSec(target);
    if (isPlaying) engineRef.current?.setSequence(stages, target, continuousGlide, isToneHeld);
  };

  const handleRestart = () => handleSeek(0);

  const handleJumpToStage = (index: number) => {
    const target = stages.slice(0, index).reduce((sum, stage) => sum + Math.max(5, stage.durationSec), 0);
    handleSeek(target + 0.001);
  };

  const handleMonitorChange = (mode: MonitorMode) => {
    setMonitorMode(mode);
    engineRef.current?.setMonitorMode(mode);
  };

  const handleDownloadReference = () => {
    const blob = makeReferenceWav(telemetry.carrierHz, telemetry.beatHz, monitorMode);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `clearing-reference-${telemetry.beatHz.toFixed(2)}hz-${monitorMode}.wav`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleTestChannel = (channel: "left" | "right") => {
    if (!engineRef.current) {
      engineRef.current = new BinauralSymphonyEngine();
    }
    engineRef.current.testStereoChannel(channel);
    setChannelTestActive(channel);
    setTimeout(() => setChannelTestActive(null), 800);
  };

  const handleMasterVolumeChange = (val: number) => {
    setMasterVolume(val);
    engineRef.current?.setMasterVolume(val);
  };

  const handleAmbientLevelChange = (val: number) => {
    setAmbientLevel(val);
    engineRef.current?.setAmbientVolume(val);
  };

  const handleAmbientTextureChange = (tex: AmbientTexture) => {
    setAmbientTexture(tex);
    engineRef.current?.setAmbientTexture(tex, telemetry.carrierHz);
  };

  const handleStageChange = (
    index: number,
    patch: Partial<SymphonyStage>
  ) => {
    setStages((prev) =>
      prev.map((st, idx) => {
        if (idx !== index) return st;
        const updated = { ...st, ...patch };
        if (patch.beatHz !== undefined && patch.band === undefined) {
          updated.band = classifyBandFromBeatHz(patch.beatHz);
        }
        return updated;
      })
    );
  };

  const commitStageNumber = (
    index: number,
    field: "beatHz" | "carrierHz" | "durationSec",
    rawValue: number,
    minimum: number,
    maximum: number,
    increment: number
  ) => {
    if (!Number.isFinite(rawValue)) return;
    const clamped = Math.min(maximum, Math.max(minimum, rawValue));
    const decimals = increment < 1 ? (increment.toString().split(".")[1]?.length ?? 0) : 0;
    const stepped = Number((Math.round(clamped / increment) * increment).toFixed(decimals));
    handleStageChange(index, { [field]: stepped });
  };

  const handleBandPresetSelect = (index: number, band: BrainwaveBand) => {
    const spec = BRAINWAVE_BANDS[band];
    handleStageChange(index, {
      band,
      beatHz: spec.defaultBeatHz,
      carrierHz: spec.defaultCarrierHz,
    });
  };

  const handleAddStage = () => {
    const lastStage = stages[stages.length - 1];
    const newStage: SymphonyStage = {
      id: `st-${Date.now()}`,
      name: `${stages.length + 1}. New Movement`,
      band: "THETA",
      carrierHz: lastStage ? lastStage.carrierHz : 194.18,
      beatHz: 6.0,
      durationSec: 60,
      transitionType: "cosine_glide",
      intent: "Observe conscious slip into liminal imagery.",
    };
    setStages((prev) => [...prev, newStage]);
  };

  const handleDeleteStage = (index: number) => {
    if (stages.length <= 1) return;
    setStages((prev) => prev.filter((_, idx) => idx !== index));
  };

  const showToast = (msg: string) => {
    setSaveToast(msg);
    setTimeout(() => setSaveToast(null), 3200);
  };

  const handleSaveCurrentSymphony = async (asNew: boolean) => {
    setSavingSymphony(true);
    try {
      const action = asNew || !activeSymphonyId ? "create" : "update";
      const targetSteward = activeStewardName;

      const res = await fetch("/api/symphonies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          id: activeSymphonyId,
          title: asNew ? `${title} (Curated)` : title,
          subtitle,
          author: targetSteward,
          stewardName: targetSteward,
          description,
          ambientTexture,
          ambientLevel,
          stages,
          isFavorite: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const saved: SymphonyRecord = data.symphony;
        if (action === "create") {
          setSymphoniesList((prev) => [saved, ...prev]);
          selectSymphonyRecord(saved);
          showToast(`Saved to ${targetSteward}'s library!`);
        } else {
          setSymphoniesList((prev) =>
            prev.map((item) => (item.id === saved.id ? saved : item))
          );
          showToast(`Updated in ${targetSteward}'s library!`);
        }
      }
    } finally {
      setSavingSymphony(false);
    }
  };

  const handleCreateNewBlankSymphony = () => {
    const newBlank: SymphonyRecord = {
      id: 0,
      slug: `blank-${Date.now()}`,
      title: `${activeStewardName}'s New Symphony`,
      subtitle: "Custom binaural sequence",
      author: activeStewardName,
      stewardName: activeStewardName,
      isPreset: false,
      description: "Crafted in Mind Control Clearing.",
      ambientTexture: "pure_sine",
      ambientLevel: 0.0,
      stages: [
        {
          id: `st-init-1`,
          name: "I. Focus Ignition",
          band: "BETA",
          carrierHz: 256,
          beatHz: 18.0,
          durationSec: 45,
          transitionType: "step",
          intent: "Sharp laser lock.",
        },
        {
          id: `st-init-2`,
          name: "II. Liminal Drift",
          band: "THETA",
          carrierHz: 194.18,
          beatHz: 6.0,
          durationSec: 60,
          transitionType: "cosine_glide",
          intent: "Let lucidity soften.",
        },
      ],
      isFavorite: false,
      playCount: 0,
      createdAt: new Date(),
    };
    selectSymphonyRecord(newBlank);
    showToast(`Started new symphony draft for ${activeStewardName}`);
  };

  const handleToggleFavorite = async (sym: SymphonyRecord) => {
    const res = await fetch("/api/symphonies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "toggle_favorite",
        id: sym.id,
        isFavorite: !sym.isFavorite,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setSymphoniesList((prev) =>
        prev.map((item) => (item.id === sym.id ? data.symphony : item))
      );
    }
  };

  const handleExportJson = () => {
    const exportData = {
      app: "Mind Control Clearing",
      version: "1.0",
      steward: activeStewardName,
      symphony: {
        title,
        subtitle,
        author,
        description,
        stages,
        ambientTexture,
        ambientLevel,
      },
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.symphony.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Exported symphony file!");
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.symphony && Array.isArray(parsed.symphony.stages)) {
          setTitle(parsed.symphony.title || "Imported Symphony");
          setSubtitle(parsed.symphony.subtitle || "Imported from file");
          setStages(parsed.symphony.stages);
          setAmbientTexture(parsed.symphony.ambientTexture || "pure_sine");
          setAmbientLevel(parsed.symphony.ambientLevel ?? 0.0);
          showToast("Loaded imported symphony!");
        }
      } catch {
        showToast("Invalid symphony JSON file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleLogSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingSession(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symphonyId: activeSymphonyId,
          symphonyTitle: title,
          listenerNode: activeStewardName,
          durationCompletedSec:
            elapsedSec > 10
              ? Math.round(elapsedSec)
              : Math.round(telemetry.totalDurationSec),
          notes:
            sessionNote.trim() ||
            `Listened to ${title} (${stages.length} movements, peaking in ${telemetry.band} band at Δf ${telemetry.beatHz} Hz).`,
          frameNumber: 153,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSessionLogs(data.sessionLogs);
        setSessionNote("");
        showToast(`Logged session for ${activeStewardName}!`);
      }
    } finally {
      setLoggingSession(false);
    }
  };

  const handleQuickCopyLedger = async () => {
    try {
      await navigator.clipboard.writeText(ledgerText);
      setQuickCopied(true);
      setTimeout(() => setQuickCopied(false), 2500);
    } catch {
      // ignore
    }
  };

  // Filter symphonies by library selection
  const filteredSymphonies = useMemo(() => {
    if (libraryFilter === "shared") {
      return symphoniesList.filter((s) => s.isPreset);
    }
    if (libraryFilter === "personal") {
      if (activeStewardName === "Shared Clearing") return [];
      return symphoniesList.filter(
        (s) => !s.isPreset && s.stewardName === activeStewardName
      );
    }
    // "all": show Shared Clearing + current active steward's creations
    return symphoniesList.filter(
      (s) =>
        s.stewardName === "Shared Clearing" ||
        s.isPreset ||
        s.stewardName === activeStewardName
    );
  }, [symphoniesList, libraryFilter, activeStewardName]);

  const activeStage = stages[telemetry.stageIndex] ?? stages[0];
  const activeBandSpec = BRAINWAVE_BANDS[telemetry.band];
  const activeSteward = stewardsList.find((s) => s.name === activeStewardName);
  const selectedSymphony = symphoniesList.find((s) => s.id === activeSymphonyId);
  const isEditingCorePreset = selectedSymphony?.isPreset === true;

  return (
    <div className="min-h-screen bg-[#110E0C] text-[#F5EFE6] selection:bg-amber-500/30 selection:text-amber-100">
      {/* Hidden File Input for Symphony JSON Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportJson}
        accept=".json"
        className="hidden"
      />

      {/* Subtle Top Ambient Glow */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-80 opacity-25 blur-3xl transition-colors duration-1000"
        style={{
          background: `radial-gradient(circle at 50% 0%, ${activeBandSpec.color}, transparent 70%)`,
        }}
      />

      {/* Top Consumer Header Bar */}
      <header className="sticky top-0 z-30 border-b border-amber-200/15 bg-[#110E0C]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* Logo & Co-Authorship */}
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-500/10 shadow-inner"
              style={{
                boxShadow: isPlaying
                  ? `0 0 18px ${activeBandSpec.glow}`
                  : undefined,
              }}
            >
              <Waves
                className="h-5 w-5 transition-colors"
                style={{ color: activeBandSpec.color }}
              />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base font-semibold tracking-tight text-amber-50 sm:text-lg">
                  Mind Control Clearing
                </h1>
                <span className="rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] text-amber-200">
                  FRAME 153 • {ledgerVersion}
                </span>
                <span className="hidden rounded-md border border-teal-400/30 bg-teal-500/10 px-2 py-0.5 font-mono text-[11px] text-teal-200 lg:inline-block">
                  PTOLEMAIC NO-DESIGNATION STUDIOS
                </span>
              </div>
              <p className="text-xs text-stone-400">
                An instrument for the inner landscape. Your controls. Your ride.
              </p>
            </div>
          </div>

          {/* Right Header Navigation: Steward Selector, Headphone Calibrator, Origins Drawer, Ledger */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Steward Profile Button */}
            <button
              onClick={() => setStewardModalOpen(true)}
              className="flex items-center gap-2 rounded-xl border border-stone-800 bg-stone-900/90 px-3 py-1.5 text-xs text-stone-200 transition hover:border-amber-400/40 hover:text-amber-100"
              title="Switch profile or manage personal libraries"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: activeSteward?.color || "#F59E0B" }}
              />
              <span className="font-medium text-amber-200">{activeStewardName}</span>
              <Users className="h-3.5 w-3.5 text-stone-400" />
            </button>

            {/* Headphone L / R Stereo Channel Calibrator */}
            <div className="flex items-center rounded-xl border border-stone-800 bg-stone-900/90 p-0.5 text-xs">
              <span className="px-2 text-[10px] text-stone-400 font-mono">TEST:</span>
              <button
                type="button"
                onClick={() => handleTestChannel("left")}
                className={`rounded-lg px-2 py-1 font-mono text-[11px] font-semibold transition ${
                  channelTestActive === "left"
                    ? "bg-amber-500 text-stone-950 scale-105"
                    : "text-amber-300 hover:bg-stone-800"
                }`}
                title="Play test chime in LEFT ear only to check headphone orientation"
              >
                LEFT
              </button>
              <button
                type="button"
                onClick={() => handleTestChannel("right")}
                className={`rounded-lg px-2 py-1 font-mono text-[11px] font-semibold transition ${
                  channelTestActive === "right"
                    ? "bg-teal-400 text-stone-950 scale-105"
                    : "text-teal-300 hover:bg-stone-800"
                }`}
                title="Play test chime in RIGHT ear only to check headphone orientation"
              >
                RIGHT
              </button>
            </div>

            {/* Origins Archive Drawer (Moved off the home screen per Ptolemy's request!) */}
            <button
              onClick={() => setOriginsDrawerOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-stone-700 bg-stone-900 px-3 py-1.5 text-xs font-medium text-stone-200 transition hover:border-amber-400/40 hover:text-amber-100"
              title="Open Greeting from the Wooden Room & Origin Archive"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              <span className="hidden sm:inline">Origins Archive</span>
            </button>

            {/* Quick Copy Ledger */}
            <button
              onClick={handleQuickCopyLedger}
              className="flex items-center gap-1.5 rounded-xl border border-amber-400/35 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-500/25"
              title="Copy full Frame 146 Ledger to clipboard (Axiom V)"
            >
              {quickCopied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-300" />
                  <span>Copied F146</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy Ledger</span>
                </>
              )}
            </button>

            {/* Full Ledger Vault */}
            <button
              onClick={() => setLedgerDrawerOpen(true)}
              className="rounded-xl border border-stone-700 bg-stone-900 p-2 text-stone-300 transition hover:border-amber-400/40 hover:text-amber-100"
              title="Open Ledger Vault & Continuity History"
              aria-label="Ledger Vault"
            >
              <BookOpen className="h-4 w-4 text-amber-300" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {saveToast && (
          <div className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-stone-950/95 px-4 py-3 text-xs font-medium text-emerald-300 shadow-2xl">
            <Check className="h-4 w-4" />
            <span>{saveToast}</span>
          </div>
        )}

        {/* Primary 12-Column Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Column (8 cols): Master Visualizer & Sequencer */}
          <div className="space-y-6 lg:col-span-8">
            {/* Active Symphony Title & Master Transport Bar */}
            <div className="rounded-2xl border border-amber-200/15 bg-[#171310] p-5 shadow-xl">
              <div className="flex flex-col justify-between gap-4 border-b border-amber-200/10 pb-4 sm:flex-row sm:items-center">
                <div className="space-y-1 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${activeBandSpec.badgeClass}`}
                    >
                      {activeBandSpec.symbol} {activeBandSpec.name} (
                      {activeBandSpec.rangeLabel})
                    </span>
                    <span className="font-mono text-xs text-stone-400">
                      Movement {telemetry.stageIndex + 1} of {stages.length}
                    </span>
                    <span className="rounded bg-stone-800 px-2 py-0.5 font-mono text-[10px] text-stone-300">
                      Library: {stewardName}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    aria-label="Symphony Title"
                    className="w-full bg-transparent text-xl font-bold tracking-tight text-amber-50 focus:border-b focus:border-amber-400 focus:outline-none sm:text-2xl"
                  />
                  <input
                    type="text"
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    aria-label="Symphony Subtitle"
                    className="w-full bg-transparent text-xs text-stone-400 focus:border-b focus:border-stone-600 focus:outline-none"
                  />
                </div>

                {/* Master Play / Pause / Skip Controls */}
                <div className="flex items-center gap-2 self-start sm:self-center">
                  <button
                    onClick={handleRestart}
                    title="Restart Symphony (R)"
                    className="rounded-xl border border-stone-700 bg-stone-900 p-2.5 text-stone-300 transition hover:border-stone-500 hover:text-white"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() =>
                      handleJumpToStage(Math.max(0, telemetry.stageIndex - 1))
                    }
                    title="Previous Movement (Left Arrow)"
                    className="rounded-xl border border-stone-700 bg-stone-900 p-2.5 text-stone-300 transition hover:border-stone-500 hover:text-white"
                  >
                    <SkipBack className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handleTogglePlay}
                    disabled={audioStarting}
                    className="flex items-center gap-2.5 rounded-xl bg-amber-500 px-5 py-3 text-sm font-semibold text-stone-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400"
                    title="Play / Pause (Spacebar)"
                  >
                    {isPlaying ? (
                      <>
                        <Pause className="h-4 w-4 fill-current" />
                        <span>Pause</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 fill-current" />
                        <span>{audioStarting ? "Starting…" : "Play"}</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() =>
                      handleJumpToStage(
                        Math.min(stages.length - 1, telemetry.stageIndex + 1)
                      )
                    }
                    title="Next Movement (Right Arrow)"
                    className="rounded-xl border border-stone-700 bg-stone-900 p-2.5 text-stone-300 transition hover:border-stone-500 hover:text-white"
                  >
                    <SkipForward className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Live Movement Progress & Telemetry Readout */}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-amber-200/10 bg-stone-950/70 p-3">
                  <div className="text-[11px] font-medium text-stone-400 uppercase">
                    Binaural Beat (Δf)
                  </div>
                  <div
                    className="mt-0.5 font-mono text-xl font-bold"
                    style={{ color: activeBandSpec.color }}
                  >
                    {telemetry.beatHz.toFixed(2)} Hz
                  </div>
                  <div className="text-[11px] text-stone-400">
                    {activeBandSpec.stateSummary}
                  </div>
                </div>

                <div className="rounded-xl border border-amber-200/10 bg-stone-950/70 p-3">
                  <div className="text-[11px] font-medium text-stone-400 uppercase">
                    Stereo Carriers (L / R)
                  </div>
                  <div className="mt-0.5 font-mono text-base font-semibold text-stone-100">
                    <span className="text-amber-300">
                      {telemetry.carrierHz.toFixed(1)}
                    </span>{" "}
                    /{" "}
                    <span className="text-teal-300">
                      {telemetry.rightEarHz.toFixed(1)}
                    </span>{" "}
                    Hz
                  </div>
                  <div className="text-[11px] text-stone-400">
                    Pure Sine Phase-Locked
                  </div>
                </div>

                <div className="rounded-xl border border-amber-200/10 bg-stone-950/70 p-3">
                  <div className="text-[11px] font-medium text-stone-400 uppercase">
                    Active Movement
                  </div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-amber-100">
                    {activeStage?.name}
                  </div>
                  <div className="font-mono text-[11px] text-stone-400">
                    {formatTime(telemetry.stageElapsedSec)} /{" "}
                    {formatTime(activeStage?.durationSec || 60)} (
                    {Math.round(telemetry.stageProgress * 100)}%)
                  </div>
                </div>

                <div className="rounded-xl border border-amber-200/10 bg-stone-950/70 p-3">
                  <div className="text-[11px] font-medium text-stone-400 uppercase">
                    Total Symphony Arc
                  </div>
                  <div className="mt-0.5 font-mono text-lg font-semibold text-stone-100">
                    {formatTime(telemetry.totalElapsedSec)}{" "}
                    <span className="text-xs text-stone-500">
                      / {formatTime(telemetry.totalDurationSec)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-stone-800">
                    <div
                      className="h-full rounded-full transition-all duration-150"
                      style={{
                        width: `${
                          (telemetry.totalElapsedSec /
                            Math.max(1, telemetry.totalDurationSec)) *
                          100
                        }%`,
                        backgroundColor: activeBandSpec.color,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Audio and visuals have independent lifecycles. */}
              {audioError && <p role="alert" className="mt-3 rounded-lg border border-rose-400/30 bg-rose-950/30 p-3 text-xs text-rose-200">{audioError}</p>}
              {isToneHeld && <p className="mt-3 text-xs text-amber-200">Beat held at {telemetry.beatHz.toFixed(2)} Hz · Resume the journey in Sound Lab.</p>}
              {visualsEnabled ? (
                <div className="mt-4 space-y-3">
                  <FrequencyTrajectoryChart
                    stages={stages}
                    telemetry={telemetry}
                    continuousGlide={continuousGlide}
                    onSeekSeconds={handleSeek}
                  />
                  <PhaseInterferenceCanvas telemetry={telemetry} readWaveforms={readWaveforms} />
                </div>
              ) : (
                <div className="mt-4 flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-teal-300/20 bg-[#101715] p-6 text-center">
                  <Headphones className="h-7 w-7 text-teal-300" />
                  <h3 className="font-medium text-teal-100">Audio only — renderers unmounted</h3>
                  <p className="text-xs text-stone-400">Synthesis continues on the audio clock; the chart and oscilloscope are fully unmounted for comparison.</p>
                  <button type="button" onClick={() => setVisualsEnabled(true)} className="rounded-lg border border-stone-600 px-3 py-2 text-xs text-stone-200">Re-enable visualizers</button>
                </div>
              )}
              <div className="mt-3">
                <AudioLabPanel
                  holding={isToneHeld}
                  visualsEnabled={visualsEnabled}
                  monitorMode={monitorMode}
                  diagnostics={audioDiagnostics}
                  onHoldChange={setIsToneHeld}
                  onVisualsChange={setVisualsEnabled}
                  onMonitorChange={handleMonitorChange}
                  onDownloadReference={handleDownloadReference}
                />
              </div>

              {/* Movement Intent Bar */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200/10 bg-stone-950/60 px-4 py-2.5 text-xs">
                <div className="flex items-center gap-2 text-stone-300">
                  <Activity
                    className="h-4 w-4 shrink-0"
                    style={{ color: activeBandSpec.color }}
                  />
                  <span>
                    <strong className="text-amber-100">Movement Intent:</strong>{" "}
                    {activeStage?.intent}
                  </span>
                </div>
                <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-amber-200">
                  <input
                    type="checkbox"
                    checked={continuousGlide}
                    onChange={(e) => setContinuousGlide(e.target.checked)}
                    className="rounded border-stone-600 accent-amber-500"
                  />
                  <span>SMOOTH INTER-STAGE FREQUENCY GLIDE</span>
                </label>
              </div>
            </div>

            {/* Movement Sequencer & Frequency Choreographer */}
            <div className="rounded-2xl border border-amber-200/15 bg-[#171310] p-5 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200/10 pb-4">
                <div>
                  <h2 className="text-base font-semibold text-amber-50">
                    Movement Sequencer & Frequency Choreography
                  </h2>
                  <p className="text-xs text-stone-400">
                    Enter exact Δf and carrier values in Hz and movement length in seconds, or use the sliders for quick tuning. Enter commits; time is also shown as mm:ss.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleAddStage}
                    className="flex items-center gap-1.5 rounded-xl border border-amber-400/35 bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-100 transition hover:bg-amber-500/25"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Movement</span>
                  </button>

                  <button
                    onClick={() => handleSaveCurrentSymphony(false)}
                    disabled={savingSymphony || isEditingCorePreset}
                    title={isEditingCorePreset ? "Save as new to customize this shared preset" : "Save changes to this symphony"}
                    className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-semibold text-stone-950 transition hover:bg-amber-400 disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>{isEditingCorePreset ? "Core preset · Save as New" : "Save Changes"}</span>
                  </button>

                  <button
                    onClick={() => handleSaveCurrentSymphony(true)}
                    disabled={savingSymphony}
                    className="flex items-center gap-1.5 rounded-xl border border-stone-700 bg-stone-900 px-3 py-2 text-xs font-medium text-stone-200 transition hover:border-amber-400/40"
                    title={`Save as a new symphony under ${activeStewardName}'s personal library`}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                    <span>Save to {activeStewardName}&apos;s Library</span>
                  </button>

                  {/* Export & Import File Buttons */}
                  <button
                    onClick={handleExportJson}
                    className="rounded-xl border border-stone-700 bg-stone-900 p-2 text-stone-300 transition hover:border-stone-500"
                    title="Export Symphony as .JSON"
                    aria-label="Export Symphony as JSON"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-xl border border-stone-700 bg-stone-900 p-2 text-stone-300 transition hover:border-stone-500"
                    title="Import Symphony .JSON file"
                    aria-label="Import Symphony JSON file"
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Band Reference Legend */}
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {(Object.keys(BRAINWAVE_BANDS) as BrainwaveBand[]).map((bKey) => {
                  const spec = BRAINWAVE_BANDS[bKey];
                  const isCurrent = telemetry.band === bKey;
                  return (
                    <div
                      key={bKey}
                      className={`rounded-xl border p-2.5 transition ${
                        isCurrent
                          ? "border-amber-300/40 bg-stone-900/95 shadow-md"
                          : "border-stone-800/80 bg-stone-950/50 opacity-80"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className="font-mono text-xs font-bold"
                          style={{ color: spec.color }}
                        >
                          {spec.symbol} {spec.name}
                        </span>
                        <span className="font-mono text-[10px] text-stone-400">
                          {spec.rangeLabel}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] leading-snug text-stone-300">
                        {spec.stateSummary}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Stage Cards */}
              <div className="mt-4 space-y-3">
                {stages.map((stage, idx) => {
                  const isCurrentStage = idx === telemetry.stageIndex;
                  const stageSpec = BRAINWAVE_BANDS[stage.band];
                  return (
                    <div
                      key={stage.id}
                      className={`rounded-xl border p-4 transition ${
                        isCurrentStage
                          ? "border-amber-400/45 bg-[#1F1915] shadow-lg"
                          : "border-stone-800/90 bg-stone-950/60 hover:border-stone-700"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-1 items-center gap-2.5">
                          <button
                            onClick={() => handleJumpToStage(idx)}
                            title="Jump playhead to this movement"
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold text-stone-950 transition hover:scale-105"
                            style={{ backgroundColor: stageSpec.color }}
                          >
                            {idx + 1}
                          </button>

                          <input
                            type="text"
                            value={stage.name}
                            onChange={(e) =>
                              handleStageChange(idx, { name: e.target.value })
                            }
                            aria-label={`Movement ${idx + 1} Name`}
                            className="w-full bg-transparent text-sm font-semibold text-amber-50 focus:border-b focus:border-amber-400 focus:outline-none"
                          />
                        </div>

                        {/* Band Preset Pills */}
                        <div className="flex flex-wrap items-center gap-1">
                          {(
                            Object.keys(BRAINWAVE_BANDS) as BrainwaveBand[]
                          ).map((bandKey) => {
                            const b = BRAINWAVE_BANDS[bandKey];
                            const selected = stage.band === bandKey;
                            return (
                              <button
                                key={bandKey}
                                type="button"
                                onClick={() =>
                                  handleBandPresetSelect(idx, bandKey)
                                }
                                className={`rounded-md border px-2 py-0.5 font-mono text-[10px] transition ${
                                  selected
                                    ? b.badgeClass
                                    : "border-stone-800 bg-stone-900 text-stone-400 hover:text-stone-200"
                                }`}
                              >
                                {b.symbol} {b.name}
                              </button>
                            );
                          })}

                          {stages.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteStage(idx)}
                              title="Remove Movement"
                              className="ml-1 rounded-lg p-1.5 text-stone-500 transition hover:bg-rose-950/50 hover:text-rose-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Sliders */}
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
                        {/* Direct binaural beat entry + quick slider */}
                        <div className="rounded-lg border border-stone-800/80 bg-stone-900/70 p-2.5">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <label htmlFor={`stage-${stage.id}-beat`} className="text-stone-400">Beat (Δf)</label>
                            <div className="flex items-center gap-1">
                              <StageNumberField
                                id={`stage-${stage.id}-beat`}
                                label={`Movement ${idx + 1} beat frequency Δf in hertz`}
                                value={stage.beatHz}
                                minimum={0.5}
                                maximum={50}
                                step={0.01}
                                precision={2}
                                onCommit={(value) => commitStageNumber(idx, "beatHz", value, 0.5, 50, 0.01)}
                              />
                              <span className="font-mono text-stone-400">Hz</span>
                            </div>
                          </div>
                          <input
                            type="range"
                            min={0.5}
                            max={50}
                            step={0.01}
                            value={stage.beatHz}
                            onChange={(e) => handleStageChange(idx, { beatHz: parseFloat(e.target.value) })}
                            aria-label={`Movement ${idx + 1} Beat Frequency Slider`}
                            className="mt-2 w-full accent-amber-500"
                          />
                        </div>

                        {/* Direct carrier entry + quick slider */}
                        <div className="rounded-lg border border-stone-800/80 bg-stone-900/70 p-2.5">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <label htmlFor={`stage-${stage.id}-carrier`} className="text-stone-400">Carrier (f_L)</label>
                            <div className="flex items-center gap-1">
                              <StageNumberField
                                id={`stage-${stage.id}-carrier`}
                                label={`Movement ${idx + 1} left carrier frequency f L in hertz`}
                                value={stage.carrierHz}
                                minimum={40}
                                maximum={900}
                                step={0.1}
                                precision={1}
                                onCommit={(value) => commitStageNumber(idx, "carrierHz", value, 40, 900, 0.1)}
                              />
                              <span className="font-mono text-stone-400">Hz</span>
                            </div>
                          </div>
                          <input
                            type="range"
                            min={40}
                            max={900}
                            step={0.1}
                            value={stage.carrierHz}
                            onChange={(e) => handleStageChange(idx, { carrierHz: parseFloat(e.target.value) })}
                            aria-label={`Movement ${idx + 1} Carrier Frequency Slider`}
                            className="mt-2 w-full accent-amber-500"
                          />
                        </div>

                        {/* Direct duration entry + quick slider */}
                        <div className="rounded-lg border border-stone-800/80 bg-stone-900/70 p-2.5">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <label htmlFor={`stage-${stage.id}-duration`} className="text-stone-400">Duration</label>
                            <div className="flex items-center gap-1">
                              <StageNumberField
                                id={`stage-${stage.id}-duration`}
                                label={`Movement ${idx + 1} duration in seconds`}
                                value={stage.durationSec}
                                minimum={5}
                                maximum={3600}
                                step={1}
                                precision={0}
                                onCommit={(value) => commitStageNumber(idx, "durationSec", value, 5, 3600, 1)}
                              />
                              <span className="font-mono text-stone-400">sec</span>
                            </div>
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[10px] text-stone-500">
                            <span>mm:ss</span>
                            <span className="font-mono text-stone-300">{formatTime(stage.durationSec)}</span>
                          </div>
                          <input
                            type="range"
                            min={5}
                            max={3600}
                            step={1}
                            value={stage.durationSec}
                            onChange={(e) => handleStageChange(idx, { durationSec: parseInt(e.target.value, 10) })}
                            aria-label={`Movement ${idx + 1} Duration Slider`}
                            className="mt-1.5 w-full accent-amber-500"
                          />
                        </div>

                        {/* Transition Mode */}
                        <div className="rounded-lg border border-stone-800/80 bg-stone-900/70 p-2.5">
                          <label className="block text-[11px] text-stone-400">
                            Transition
                          </label>
                          <select
                            value={stage.transitionType}
                            onChange={(e) =>
                              handleStageChange(idx, {
                                transitionType: e.target.value as TransitionMode,
                              })
                            }
                            aria-label={`Movement ${idx + 1} Transition`}
                            className="mt-1.5 w-full rounded border border-stone-700 bg-stone-950 px-2 py-1 font-mono text-xs text-stone-200"
                          >
                            <option value="step">Step Shift (Rollercoaster Jolt)</option>
                            <option value="cosine_glide">Cosine Glide (Smooth Curve)</option>
                            <option value="linear_ramp">Linear Steady Ramp</option>
                          </select>
                        </div>
                      </div>

                      {/* Intent */}
                      <div className="mt-2.5">
                        <input
                          type="text"
                          value={stage.intent}
                          onChange={(e) =>
                            handleStageChange(idx, { intent: e.target.value })
                          }
                          placeholder="Describe intention or subjective feel..."
                          aria-label={`Movement ${idx + 1} Intent`}
                          className="w-full rounded-lg border border-stone-800/80 bg-stone-900/40 px-3 py-1.5 text-xs text-stone-300 focus:border-amber-400/40 focus:outline-none"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column (4 cols): Personal Library Vault & Mixer Deck */}
          <div className="space-y-6 lg:col-span-4">
            {/* Library Vault & Profile Switcher */}
            <div className="rounded-2xl border border-amber-200/15 bg-[#171310] p-5 shadow-xl">
              <div className="flex items-center justify-between border-b border-amber-200/10 pb-3">
                <div className="flex items-center gap-2">
                  <Compass className="h-4 w-4 text-amber-300" />
                  <h2 className="text-sm font-semibold tracking-wide text-amber-50 uppercase">
                    Symphony Library
                  </h2>
                </div>
                <button
                  onClick={handleCreateNewBlankSymphony}
                  className="flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-200 transition hover:bg-amber-500/20"
                >
                  <Plus className="h-3 w-3" />
                  <span>New Blank</span>
                </button>
              </div>

              {/* Library Filter Pills */}
              <div className="mt-3 flex items-center gap-1 rounded-xl border border-stone-800 bg-stone-950/80 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setLibraryFilter("all")}
                  className={`flex-1 rounded-lg py-1 font-medium transition ${
                    libraryFilter === "all"
                      ? "bg-amber-500 text-stone-950 font-semibold"
                      : "text-stone-400 hover:text-stone-200"
                  }`}
                >
                  All ({filteredSymphonies.length})
                </button>
                <button
                  type="button"
                  onClick={() => setLibraryFilter("shared")}
                  className={`flex-1 rounded-lg py-1 font-medium transition ${
                    libraryFilter === "shared"
                      ? "bg-teal-500 text-stone-950 font-semibold"
                      : "text-stone-400 hover:text-stone-200"
                  }`}
                >
                  Presets
                </button>
                <button
                  type="button"
                  onClick={() => setLibraryFilter("personal")}
                  className={`flex-1 rounded-lg py-1 font-medium transition ${
                    libraryFilter === "personal"
                      ? "bg-amber-500 text-stone-950 font-semibold"
                      : "text-stone-400 hover:text-stone-200"
                  }`}
                >
                  Mine
                </button>
              </div>

              {/* List of Symphonies */}
              {loading ? (
                <div className="py-8 text-center text-xs text-stone-400">
                  Loading library...
                </div>
              ) : (
                <div className="mt-3 space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                  {filteredSymphonies.map((sym) => {
                    const isSelected = sym.id === activeSymphonyId;
                    const totalSec = sym.stages.reduce(
                      (a, b) => a + b.durationSec,
                      0
                    );
                    return (
                      <div
                        key={sym.id}
                        onClick={() => selectSymphonyRecord(sym)}
                        className={`cursor-pointer rounded-xl border p-3.5 transition ${
                          isSelected
                            ? "border-amber-400/50 bg-[#221B15] shadow-md"
                            : "border-stone-800/90 bg-stone-950/60 hover:border-stone-700"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <h3 className="text-xs font-semibold text-amber-100">
                                {sym.title}
                              </h3>
                              {sym.isPreset && (
                                <span className="rounded bg-teal-500/20 px-1 py-0.2 font-mono text-[9px] text-teal-300">
                                  PRESET
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-[11px] text-stone-400">
                              {sym.isPreset
                                ? "Shared Clearing • Core preset"
                                : `${sym.stewardName} • Personal library`}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleFavorite(sym);
                            }}
                            aria-label="Toggle Favorite"
                            className="rounded p-1 text-stone-400 hover:text-amber-300"
                          >
                            <Heart
                              className={`h-3.5 w-3.5 ${
                                sym.isFavorite
                                  ? "fill-amber-400 text-amber-400"
                                  : ""
                              }`}
                            />
                          </button>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {sym.stages.map((st, idx) => (
                            <span
                              key={st.id || idx}
                              className="rounded border border-stone-700/80 bg-stone-900 px-1.5 py-0.5 font-mono text-[10px]"
                              style={{ color: BRAINWAVE_BANDS[st.band].color }}
                            >
                              {BRAINWAVE_BANDS[st.band].symbol} {st.beatHz}Hz
                            </span>
                          ))}
                          <span className="ml-auto font-mono text-[10px] text-stone-400">
                            {formatTime(totalSec)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Acoustic Room & Ambient Layer Deck (0% Default Raw Sine Skull Mode!) */}
            <div className="rounded-2xl border border-amber-200/15 bg-[#171310] p-5 shadow-xl">
              <div className="flex items-center gap-2 border-b border-amber-200/10 pb-3">
                <Sliders className="h-4 w-4 text-amber-300" />
                <h2 className="text-sm font-semibold tracking-wide text-amber-50 uppercase">
                  Acoustic Room & Skull Mode
                </h2>
              </div>

              <div className="mt-4 space-y-4">
                {/* Master Volume */}
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-stone-300">
                      <Volume2 className="h-3.5 w-3.5 text-amber-300" />
                      <span>Master Headphone Gain</span>
                    </span>
                    <span className="font-mono text-amber-200">
                      {Math.round(masterVolume * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={masterVolume}
                    onChange={(e) =>
                      handleMasterVolumeChange(parseFloat(e.target.value))
                    }
                    aria-label="Master Headphone Gain"
                    className="mt-1.5 w-full accent-amber-500"
                  />
                </div>

                {/* Ambient Level (Default 0% raw sine) */}
                <div className="rounded-xl border border-stone-800 bg-stone-950/70 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-stone-300">
                      <Radio className="h-3.5 w-3.5 text-teal-300" />
                      <span>Room Texture Blend</span>
                    </span>
                    <span className="font-mono text-teal-200 font-semibold">
                      {ambientLevel === 0 ? "0% (Raw Sine Skull Mode)" : `${Math.round(ambientLevel * 100)}%`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.85}
                    step={0.01}
                    value={ambientLevel}
                    onChange={(e) =>
                      handleAmbientLevelChange(parseFloat(e.target.value))
                    }
                    aria-label="Room Texture Blend"
                    className="mt-2 w-full accent-teal-400"
                  />
                  <div className="mt-1.5 text-[11px] text-stone-400">
                    {ambientLevel === 0 ? (
                      <span className="text-teal-300/90">
                        ✓ <strong>Pure Raw Sine Waves:</strong> No scenery, just the ride. Add a little atmosphere whenever you feel like it.
                      </span>
                    ) : (
                      <span>
                        Dialed up to {Math.round(ambientLevel * 100)}% ambient room texture.
                      </span>
                    )}
                  </div>
                </div>

                {/* Texture Selector */}
                <div className="space-y-2 pt-1">
                  <div className="text-xs font-medium text-stone-400">
                    Optional Acoustic Accompaniment:
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {(
                      Object.keys(AMBIENT_TEXTURES) as AmbientTexture[]
                    ).map((texKey) => {
                      const tex = AMBIENT_TEXTURES[texKey];
                      const active = ambientTexture === texKey;
                      return (
                        <button
                          key={texKey}
                          type="button"
                          onClick={() => handleAmbientTextureChange(texKey)}
                          className={`rounded-xl border p-2.5 text-left transition ${
                            active
                              ? "border-amber-400/50 bg-amber-500/15"
                              : "border-stone-800 bg-stone-950/60 hover:border-stone-700"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-amber-100">
                              {tex.name}
                            </span>
                            {active && (
                              <span className="rounded bg-amber-400/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                                SELECTED
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[11px] text-stone-400">
                            {tex.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Session Field Notes */}
            <div className="rounded-2xl border border-amber-200/15 bg-[#171310] p-5 shadow-xl">
              <div className="flex items-center justify-between border-b border-amber-200/10 pb-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-teal-300" />
                  <h2 className="text-sm font-semibold tracking-wide text-amber-50 uppercase">
                    Field Observations
                  </h2>
                </div>
                <span className="font-mono text-[11px] text-teal-300">
                  {activeStewardName}&apos;s Logbook
                </span>
              </div>

              <form onSubmit={handleLogSession} className="mt-3 space-y-2.5">
                <textarea
                  value={sessionNote}
                  onChange={(e) => setSessionNote(e.target.value)}
                  rows={2}
                  placeholder={`Record a somatic observation as ${activeStewardName} (e.g. how the Step Shift vs. Cosine Glide felt)...`}
                  className="w-full rounded-xl border border-stone-800 bg-stone-950/90 p-2.5 text-xs text-stone-200 focus:border-amber-400/40 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={loggingSession}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-teal-400/35 bg-teal-500/15 px-3 py-2 text-xs font-medium text-teal-100 transition hover:bg-teal-500/25 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>
                    {loggingSession
                      ? "Recording..."
                      : `Log Field Note as ${activeStewardName}`}
                  </span>
                </button>
              </form>

              <div className="mt-4 max-h-56 space-y-2.5 overflow-y-auto pr-1">
                {sessionLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-xl border border-stone-800/80 bg-stone-950/60 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-amber-200">
                        {log.listenerNode}
                      </span>
                      <span className="font-mono text-stone-500">
                        Frame {log.frameNumber} •{" "}
                        {formatTime(log.durationCompletedSec)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] font-medium text-teal-300/90">
                      {log.symphonyTitle}
                    </div>
                    <p className="mt-1 leading-relaxed text-stone-300">
                      {log.notes}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Per-Message Ledger Regeneration Box (Axiom V — Ptolemy, F136) */}
        <section className="rounded-2xl border border-amber-300/25 bg-[#15120F] p-5 shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200/15 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-amber-500/20 px-2 py-0.5 font-mono text-xs font-semibold text-amber-200">
                  AXIOM V • PER-MESSAGE REGENERATION (PTOLEMY, 136)
                </span>
                <span className="font-mono text-xs text-stone-400">
                  FRAME 153 • ANCHOR {ledgerVersion}
                </span>
              </div>
              <h2 className="mt-1 text-sm font-semibold text-amber-50">
                Full Updated Continuity Ledger — Ready to Copy Forward to Frame 154
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleQuickCopyLedger}
                className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-stone-950 transition hover:bg-amber-400"
              >
                {quickCopied ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Copied to Clipboard!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>Copy Full Frame 146 Ledger</span>
                  </>
                )}
              </button>
              <button
                onClick={() => setLedgerDrawerOpen(true)}
                className="rounded-xl border border-stone-700 bg-stone-900 px-3 py-2 text-xs text-stone-200 transition hover:border-amber-400/40"
              >
                Open Editor Vault
              </button>
            </div>
          </div>

          <pre className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-stone-800 bg-[#0B0908] p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-amber-100/90">
            {ledgerText}
          </pre>
        </section>
      </main>

      {/* Modals & Drawers */}
      <OriginsArchiveDrawer
        isOpen={originsDrawerOpen}
        onClose={() => setOriginsDrawerOpen(false)}
      />

      <StewardManagerModal
        isOpen={stewardModalOpen}
        onClose={() => setStewardModalOpen(false)}
        stewardsList={stewardsList}
        activeStewardName={activeStewardName}
        onSelectSteward={(name) => setActiveStewardName(name)}
        onStewardCreated={(steward) =>
          setStewardsList((prev) => [...prev, steward])
        }
      />

      <LedgerVaultDrawer
        isOpen={ledgerDrawerOpen}
        onClose={() => setLedgerDrawerOpen(false)}
        initialContent={ledgerText}
        version={ledgerVersion}
        frameNumber={153}
        onLedgerSaved={(newContent, newVer) => {
          setLedgerText(newContent);
          setLedgerVersion(newVer);
        }}
      />
    </div>
  );
}
