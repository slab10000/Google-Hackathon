"use client";
import { useState, useMemo } from "react";
import { TranscriptSegment } from "@/types";
import { cosineSimilarity } from "@/lib/embeddings";

interface TranscriptPanelProps {
  segments: TranscriptSegment[];
  currentTime: number;
  selectedIds: Set<string>;
  onSeek: (time: number) => void;
  onToggleSelect: (id: string) => void;
  onRemoveSelected: () => void;
  onSearch: (query: string) => void;
  searchResults: { id: string; score: number }[] | null;
  isSearching: boolean;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function TranscriptPanel({
  segments,
  currentTime,
  selectedIds,
  onSeek,
  onToggleSelect,
  onRemoveSelected,
  onSearch,
  searchResults,
  isSearching,
}: TranscriptPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const activeSegmentId = useMemo(() => {
    const active = segments.find((s) => currentTime >= s.startTime && currentTime < s.endTime);
    return active?.id || null;
  }, [segments, currentTime]);

  const searchScoreMap = useMemo(() => {
    if (!searchResults) return null;
    const map = new Map<string, number>();
    for (const r of searchResults) map.set(r.id, r.score);
    return map;
  }, [searchResults]);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      onSearch(searchQuery.trim());
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b border-white/10">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search by meaning..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50"
          />
          <button
            onClick={handleSearch}
            disabled={isSearching || !searchQuery.trim()}
            className="px-3 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
          >
            {isSearching ? "..." : "Search"}
          </button>
        </div>
      </div>

      {/* Actions */}
      {selectedIds.size > 0 && (
        <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
          <span className="text-xs text-white/50">{selectedIds.size} selected</span>
          <button
            onClick={onRemoveSelected}
            className="px-3 py-1.5 bg-red-600/80 hover:bg-red-500 text-white text-xs rounded-lg transition-colors"
          >
            Remove Selected
          </button>
        </div>
      )}

      {/* Segments */}
      <div className="flex-1 overflow-y-auto">
        {segments.length === 0 ? (
          <div className="p-4 text-center text-white/30 text-sm">
            Upload a video to see the transcript
          </div>
        ) : (
          segments.map((seg) => {
            const isActive = seg.id === activeSegmentId;
            const isSelected = selectedIds.has(seg.id);
            const searchScore = searchScoreMap?.get(seg.id);
            const isTopResult = searchScore !== undefined && searchScore > 0.5;

            return (
              <div
                key={seg.id}
                className={`flex gap-2 px-3 py-2 border-b border-white/5 cursor-pointer transition-colors ${
                  isActive
                    ? "bg-violet-600/20 border-l-2 border-l-violet-500"
                    : isTopResult
                    ? "bg-amber-500/10 border-l-2 border-l-amber-400"
                    : isSelected
                    ? "bg-red-500/10"
                    : "hover:bg-white/5"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect(seg.id)}
                  className="mt-1 accent-violet-500 shrink-0"
                />
                <div className="flex-1 min-w-0" onClick={() => onSeek(seg.startTime)}>
                  <div className="text-[10px] text-white/30 font-mono mb-0.5">
                    {formatTime(seg.startTime)} - {formatTime(seg.endTime)}
                    {searchScore !== undefined && (
                      <span className="ml-2 text-amber-400">
                        {Math.round(searchScore * 100)}% match
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-white/80 leading-relaxed">{seg.text}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
