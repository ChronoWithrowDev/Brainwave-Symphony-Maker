"use client";

import React, { useState } from "react";
import { User, Plus, Check, X, Shield, Users } from "lucide-react";
import type { StewardRecord } from "@/db/schema";

interface StewardManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  stewardsList: StewardRecord[];
  activeStewardName: string;
  onSelectSteward: (name: string) => void;
  onStewardCreated: (steward: StewardRecord) => void;
}

const PRESET_COLORS = [
  "#F59E0B", // Amber
  "#14B8A6", // Teal
  "#6366F1", // Indigo
  "#38BDF8", // Sky
  "#EC4899", // Pink
  "#10B981", // Emerald
  "#8B5CF6", // Purple
];

export function StewardManagerModal({
  isOpen,
  onClose,
  stewardsList,
  activeStewardName,
  onSelectSteward,
  onStewardCreated,
}: StewardManagerModalProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("Explorer & Symphony Creator");
  const [newColor, setNewColor] = useState("#F59E0B");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/stewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: newName.trim(),
          role: newRole.trim(),
          color: newColor,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to create steward");
      }

      const data = await res.json();
      onStewardCreated(data.steward);
      onSelectSteward(data.steward.name);
      setNewName("");
      setIsAdding(false);
    } catch {
      setErrorMsg("Failed to create profile. Name might already exist.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-amber-300/25 bg-[#14110E] text-stone-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-amber-200/15 bg-stone-950/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-500/10 text-amber-300">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-amber-100 sm:text-lg">
                Steward Profiles & Personal Libraries
              </h2>
              <p className="text-xs text-stone-400">
                Switch profiles or create a new library for custom symphonies
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg border border-stone-700 bg-stone-900 p-2 text-stone-400 transition hover:text-stone-100"
            aria-label="Close Steward Manager"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="rounded-xl border border-stone-800 bg-stone-950/60 p-4 text-xs text-stone-300">
            <div className="flex items-center gap-2 font-medium text-amber-200">
              <Shield className="h-4 w-4 text-teal-400" />
              <span>Profile-based library organization:</span>
            </div>
            <p className="mt-1">
              <strong>Shared Clearing</strong> hosts the canonical presets. Profiles organize custom symphonies by name, but they are not sign-in accounts and do not provide privacy between people using a shared deployment. Account access controls would be needed before hosting private libraries for the public.
            </p>
          </div>

          {/* List of Stewards */}
          <div className="space-y-2.5">
            <label className="block text-xs font-semibold tracking-wider text-stone-400 uppercase">
              Current Profiles:
            </label>
            <div className="grid grid-cols-1 gap-2.5">
              {stewardsList.map((steward) => {
                const isActive = steward.name === activeStewardName;
                return (
                  <div
                    key={steward.id}
                    onClick={() => {
                      onSelectSteward(steward.name);
                      onClose();
                    }}
                    className={`flex cursor-pointer items-center justify-between rounded-xl border p-3.5 transition ${
                      isActive
                        ? "border-amber-400/50 bg-amber-500/10"
                        : "border-stone-800 bg-stone-950/60 hover:border-stone-700"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-lg font-mono text-sm font-bold text-stone-950"
                        style={{ backgroundColor: steward.color }}
                      >
                        {steward.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-amber-100">
                            {steward.name}
                          </span>
                          {steward.isSystem && (
                            <span className="rounded bg-teal-500/20 px-1.5 py-0.2 font-mono text-[10px] text-teal-300">
                              SHARED PRESETS
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-stone-400">
                          {steward.role}
                        </div>
                      </div>
                    </div>

                    {isActive && (
                      <span className="flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-1 text-xs font-medium text-amber-300">
                        <Check className="h-3.5 w-3.5" />
                        <span>Active</span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add New Steward Section */}
          {!isAdding ? (
            <button
              onClick={() => setIsAdding(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-stone-700 p-3 text-xs font-medium text-stone-300 transition hover:border-amber-400/40 hover:text-amber-200"
            >
              <Plus className="h-4 w-4" />
              <span>Add New Steward Profile</span>
            </button>
          ) : (
            <form
              onSubmit={handleCreate}
              className="space-y-4 rounded-xl border border-amber-300/20 bg-stone-950/80 p-4 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-amber-200 uppercase">
                  New Steward Profile
                </span>
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="text-stone-400 hover:text-stone-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {errorMsg && (
                <div className="rounded-lg bg-rose-950/50 p-2 text-rose-300">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="mb-1 block text-stone-400">Name / Handle</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Guest Explorer, My Studio, or a chosen handle"
                  required
                  className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-stone-100 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-stone-400">Role / Tagline</label>
                <input
                  type="text"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  placeholder="e.g. Synth explorer, deep sleep researcher"
                  className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-stone-100 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-stone-400">Color Badge</label>
                <div className="flex items-center gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewColor(c)}
                      className={`h-6 w-6 rounded-full transition ${
                        newColor === c
                          ? "ring-2 ring-white ring-offset-2 ring-offset-stone-950 scale-110"
                          : "opacity-75 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="rounded-lg border border-stone-700 px-3 py-1.5 text-stone-400 hover:text-stone-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-amber-500 px-4 py-1.5 font-semibold text-stone-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  {submitting ? "Creating..." : "Save Profile"}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-amber-200/15 bg-stone-950/90 px-6 py-4 text-right">
          <button
            onClick={onClose}
            className="rounded-lg bg-stone-800 px-4 py-2 text-xs font-semibold text-stone-200 transition hover:bg-stone-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
