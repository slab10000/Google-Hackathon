"use client";
import { useCallback, useMemo } from "react";
import { PauseRange, TranscriptSegment } from "@/types";

interface TranscriptPanelProps {
  clipName?: string;
  segments: TranscriptSegment[];
  pauses: PauseRange[];
  currentTime: number;
  selectedWordIds: Set<string>;
  activeRange?: { startTime: number; endTime: number } | null;
  onSeek: (time: number) => void;
  onWordSelectionChange: (wordIds: string[]) => void;
  onRemoveSelectedWords: () => void;
  onRemovePause: (pauseId: string) => void;
  onRemoveLongPauses: (minimumDuration?: number) => void;
  activeSearchQuery?: string;
  searchResults: { id: string; score: number }[] | null;
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function TranscriptPanel({
  clipName,
  segments,
  pauses,
  currentTime,
  selectedWordIds,
  activeRange,
  onSeek,
  onWordSelectionChange,
  onRemoveSelectedWords,
  onRemovePause,
  onRemoveLongPauses,
  activeSearchQuery,
  searchResults,
}: TranscriptPanelProps) {
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

  const toggleWord = useCallback(
    (wordId: string) => {
      const next = new Set(selectedWordIds);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      onWordSelectionChange(Array.from(next));
    },
    [onWordSelectionChange, selectedWordIds]
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="border-b border-white/8 px-4 py-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-white/32">Transcript</p>
        <p className="mt-1 truncate text-sm text-white/82">{clipName || "Select a clip"}</p>
      </div>

      {activeSearchQuery && (
        <div className="border-b border-white/8 px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/28">Search Context</p>
          <p className="mt-1 text-xs leading-5 text-white/58">
            Showing semantic matches for &quot;{activeSearchQuery}&quot;. Matching sections are highlighted below.
          </p>
        </div>
      )}

      <div className="border-b border-white/8 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">Word Selection</p>
            <p className="mt-1 text-xs leading-5 text-white/46">
              Click words to mark precise removals, or jump by segment timestamps.
            </p>
          </div>
          <button
            onClick={onRemoveSelectedWords}
            disabled={selectedWordIds.size === 0}
            className="rounded-md border border-red-400/20 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-medium text-red-200 transition hover:bg-red-500/16 disabled:cursor-not-allowed disabled:opacity-35"
          >
            Remove {selectedWordIds.size || ""} {selectedWordIds.size === 1 ? "word" : "words"}
          </button>
        </div>
      </div>

      {pauses.length > 0 && (
        <div className="border-b border-white/8 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">Pause Cleanup</p>
              <p className="mt-1 text-xs leading-5 text-white/46">
                Trim dead air with room tone preserved at the edges.
              </p>
            </div>
            <button
              onClick={() => onRemoveLongPauses()}
              className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-200 transition hover:bg-amber-500/16"
            >
              Remove Long Pauses
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {pauses.slice(0, 10).map((pause) => (
              <button
                key={pause.id}
                onClick={() => onRemovePause(pause.id)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] text-white/60 transition hover:bg-white/[0.08] hover:text-white/82"
              >
                {formatTime(pause.startTime)} - {formatTime(pause.endTime)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {segments.length === 0 ? (
          <div className="px-4 py-8 text-sm leading-6 text-white/36">
            Select a processed clip to inspect its transcript, search hits, and pauses.
          </div>
        ) : (
          segments.map((segment) => {
            const isActive = segment.id === activeSegmentId;
            const searchScore = searchScoreMap?.get(segment.id);
            const isHighlighted = searchScore !== undefined && searchScore > 0.5;
            const inSelectedRange =
              activeRange &&
              segment.endTime > activeRange.startTime &&
              segment.startTime < activeRange.endTime;

            return (
              <div
                key={segment.id}
                className={`border-b border-white/[0.05] px-4 py-3 transition ${
                  isActive
                    ? "bg-sky-400/10"
                    : inSelectedRange
                    ? "bg-white/[0.035]"
                    : isHighlighted
                    ? "bg-amber-400/8"
                    : "hover:bg-white/[0.03]"
                }`}
              >
                <button type="button" className="min-w-0 text-left" onClick={() => onSeek(segment.startTime)}>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-white/28">
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
                </button>

                {segment.words.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {segment.words.map((word) => {
                      const isSelected = selectedWordIds.has(word.id);
                      return (
                        <button
                          key={word.id}
                          type="button"
                          onClick={() => toggleWord(word.id)}
                          className={`rounded-md px-2 py-1 text-sm leading-5 transition ${
                            isSelected
                              ? "bg-red-500/18 text-red-100"
                              : "bg-white/[0.04] text-white/72 hover:bg-white/[0.08]"
                          }`}
                        >
                          {word.text}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-sm leading-6 text-white/78">{segment.text}</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
