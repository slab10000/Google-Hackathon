"use client";
import { useMemo, useState } from "react";
import { TranscriptSegment } from "@/types";

interface TranscriptPanelProps {
  clipName?: string;
  segments: TranscriptSegment[];
  currentTime: number;
  selectedIds: Set<string>;
  activeRange?: { startTime: number; endTime: number } | null;
  onSeek: (time: number) => void;
  onToggleSelect: (id: string) => void;
  onRemoveSelected: () => void;
  onSearch: (query: string) => void;
  searchResults: { id: string; score: number }[] | null;
  isSearching: boolean;
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function TranscriptPanel({
  clipName,
  segments,
  currentTime,
  selectedIds,
  activeRange,
  onSeek,
  onToggleSelect,
  onRemoveSelected,
  onSearch,
  searchResults,
  isSearching,
}: TranscriptPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const activeSegmentId = useMemo(() => {
    const active = segments.find((segment) => currentTime >= segment.startTime && currentTime < segment.endTime);
    return active?.id || null;
  }, [segments, currentTime]);

  const searchScoreMap = useMemo(() => {
    if (!searchResults) return null;
    const map = new Map<string, number>();
    for (const result of searchResults) map.set(result.id, result.score);
    return map;
  }, [searchResults]);

  const handleSearch = () => {
    if (searchQuery.trim()) onSearch(searchQuery.trim());
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/8 px-4 py-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-white/32">Transcript</p>
        <p className="mt-1 truncate text-sm text-white/82">{clipName || "Select a clip"}</p>
      </div>

      <div className="border-b border-white/8 px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search clips by meaning..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && handleSearch()}
            className="flex-1 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-white/26 focus:border-sky-400/40 focus:outline-none"
          />
          <button
            onClick={handleSearch}
            disabled={isSearching || !searchQuery.trim()}
            className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-medium text-white/82 transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSearching ? "..." : "Search"}
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-2.5">
          <span className="text-[11px] text-white/42">{selectedIds.size} segments selected</span>
          <button
            onClick={onRemoveSelected}
            className="rounded-md border border-red-400/20 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-medium text-red-200 transition hover:bg-red-500/16"
          >
            Remove From Sequence
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {segments.length === 0 ? (
          <div className="px-4 py-8 text-sm leading-6 text-white/36">
            Select a processed clip to view its transcript and search results.
          </div>
        ) : (
          segments.map((segment) => {
            const isActive = segment.id === activeSegmentId;
            const isSelected = selectedIds.has(segment.id);
            const searchScore = searchScoreMap?.get(segment.id);
            const isHighlighted = searchScore !== undefined && searchScore > 0.5;
            const inSelectedRange =
              activeRange &&
              segment.endTime > activeRange.startTime &&
              segment.startTime < activeRange.endTime;

            return (
              <div
                key={segment.id}
                className={`flex gap-3 border-b border-white/[0.05] px-4 py-3 transition ${
                  isActive
                    ? "bg-sky-400/10"
                    : inSelectedRange
                    ? "bg-white/[0.035]"
                    : isHighlighted
                    ? "bg-amber-400/8"
                    : isSelected
                    ? "bg-red-400/8"
                    : "hover:bg-white/[0.03]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect(segment.id)}
                  className="mt-1 shrink-0 accent-sky-400"
                />

                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSeek(segment.startTime)}>
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-white/28">
                    <span>
                      {formatTime(segment.startTime)} - {formatTime(segment.endTime)}
                    </span>
                    {searchScore !== undefined && (
                      <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-amber-300">
                        {Math.round(searchScore * 100)}%
                      </span>
                    )}
                    {inSelectedRange && (
                      <span className="rounded-full bg-sky-400/10 px-2 py-0.5 text-sky-200">
                        in sequence clip
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-white/78">{segment.text}</p>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
