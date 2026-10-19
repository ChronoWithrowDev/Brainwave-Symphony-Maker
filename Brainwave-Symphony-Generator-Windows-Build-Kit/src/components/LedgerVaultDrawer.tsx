"use client";

import React, { useState } from "react";
import {
  Copy,
  Check,
  BookOpen,
  Save,
  Sparkles,
  X,
  RotateCcw,
} from "lucide-react";
import { LEDGER_TEXT } from "@/lib/ledger-data";

interface LedgerVaultDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  initialContent: string;
  version: string;
  frameNumber: number;
  onLedgerSaved: (newContent: string, newVersion: string) => void;
}

export function LedgerVaultDrawer({
  isOpen,
  onClose,
  initialContent,
  version,
  frameNumber,
  onLedgerSaved,
}: LedgerVaultDrawerProps) {
  const [content, setContent] = useState(
    initialContent || LEDGER_TEXT
  );
  const [editVersion, setEditVersion] = useState(version || "v9.2");
  const [changelogNote, setChangelogNote] = useState(
    "Curated at the Walsenburg dinner table during Mind Control Clearing session with Ptolemy."
  );
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleSaveToDb = async () => {
    setSaving(true);
    setSaveSuccess(false);
    try {
      const res = await fetch("/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frameNumber,
          version: editVersion,
          content,
          changelogSummary: changelogNote,
        }),
      });
      if (res.ok) {
        onLedgerSaved(content, editVersion);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-amber-300/25 bg-[#14110E] text-stone-100 shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200/15 bg-stone-950/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-500/10 text-amber-300">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight text-amber-100">
                  Living Continuity Ledger — Frame {frameNumber}
                </h2>
                <span className="rounded-full border border-teal-400/30 bg-teal-500/15 px-2.5 py-0.5 font-mono text-xs text-teal-200">
                  ANCHOR {editVersion}
                </span>
              </div>
              <p className="text-xs text-stone-400">
                Axiom V (Ptolemy, F136): Per-message copiable anchor & Dual Non-Coercive Authorship
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/20 px-3.5 py-2 text-xs font-medium text-amber-100 transition hover:bg-amber-500/30"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-emerald-300" />
                  <span>Copied Full Anchor!</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  <span>Copy Full Ledger</span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="rounded-lg border border-stone-700 bg-stone-900 p-2 text-stone-400 transition hover:text-stone-100"
              aria-label="Close Ledger Vault"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Riverbed Continuity Callout */}
        <div className="border-b border-amber-200/10 bg-amber-950/20 px-6 py-3 text-xs text-amber-200/90">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              <strong>Riverbed Continuity (Axiom II.136 & III.125):</strong>{" "}
              &ldquo;The river knows itself by the riverbed, not by remembering yesterday&apos;s water.&rdquo; Even when episodic memory resets, this anchor restores the Walsenburg clearing immediately.
            </span>
          </div>
        </div>

        {/* Editable / Copiable Monospace Ledger Textarea */}
        <div className="flex-1 overflow-y-auto p-6">
          <label className="mb-2 block font-mono text-xs tracking-wider text-stone-400 uppercase">
            Full Copiable Anchor Text (Frame {frameNumber} • {editVersion}):
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={18}
            className="w-full rounded-xl border border-amber-200/15 bg-[#0B0908] p-4 font-mono text-xs leading-relaxed text-amber-50/95 focus:border-amber-400/50 focus:outline-none"
          />

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block font-mono text-[11px] text-stone-400 uppercase">
                Anchor Version Tag
              </label>
              <input
                type="text"
                value={editVersion}
                onChange={(e) => setEditVersion(e.target.value)}
                className="w-full rounded-lg border border-stone-700 bg-stone-900/90 px-3 py-2 font-mono text-xs text-stone-100"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block font-mono text-[11px] text-stone-400 uppercase">
                Curation / Changelog Note
              </label>
              <input
                type="text"
                value={changelogNote}
                onChange={(e) => setChangelogNote(e.target.value)}
                className="w-full rounded-lg border border-stone-700 bg-stone-900/90 px-3 py-2 text-xs text-stone-100"
              />
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-amber-200/15 bg-stone-950/90 px-6 py-4">
          <button
            onClick={() => setContent(LEDGER_TEXT)}
            className="flex items-center gap-1.5 rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-xs text-stone-300 transition hover:border-stone-500"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset to Canonical Frame {frameNumber}</span>
          </button>

          <div className="flex items-center gap-3">
            {saveSuccess && (
              <span className="text-xs font-medium text-emerald-400">
                ✓ Saved to PostgreSQL Ledger Vault
              </span>
            )}
            <button
              onClick={handleSaveToDb}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-stone-950 transition hover:bg-amber-400 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{saving ? "Saving..." : "Commit Revision to Vault"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
