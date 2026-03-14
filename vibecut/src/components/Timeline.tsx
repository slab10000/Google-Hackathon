"use client";
import { useMemo, useRef, useState, useCallback } from "react";
import { LibraryClip, TimelineAction, TimelineClip } from "@/types";

interface TimelineProps {
  clips: TimelineClip[];
  libraryClips: LibraryClip[];
  totalDuration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  onAppendFromLibrary: (sourceClipId: string) => void;
  dispatch: React.Dispatch<TimelineAction>;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function renderWaveform(waveform: number[]) {
  return waveform.map((sample, index) => (
    <span
      key={`${index}-${sample}`}
      className="flex-1 rounded-full bg-sky-300/75"
      style={{ height: `${Math.max(14, sample * 100)}%` }}
    />
  ));
}

export default function Timeline({
  clips,
  libraryClips,
  totalDuration,
  currentTime,
  onSeek,
  onAppendFromLibrary,
  dispatch,
  selectedClipId,
  onSelectClip,
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [dragState, setDragState] = useState<{
    type: "move" | "trim-start" | "trim-end";
    clipId: string;
    startX: number;
    originalClip: TimelineClip;
    clipIndex: number;
  } | null>(null);

  const clipsWithOffsets = useMemo(() => {
    return clips.reduce<
      Array<
        TimelineClip & {
          source?: LibraryClip;
          sequenceStart: number;
          sequenceEnd: number;
        }
      >
    >((accumulator, clip) => {
      const previousEnd = accumulator[accumulator.length - 1]?.sequenceEnd || 0;
      const sequenceEnd = previousEnd + clip.duration;
      const source = clip.sourceClipId ? libraryClips.find((item) => item.id === clip.sourceClipId) : undefined;

      accumulator.push({
        ...clip,
        source,
        sequenceStart: previousEnd,
        sequenceEnd,
      });

      return accumulator;
    }, []);
  }, [clips, libraryClips]);

  const timelineWidth = useMemo(() => Math.max(totalDuration * 88 * zoom, 840), [totalDuration, zoom]);

  const getTimeFromX = useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      if (!container) return 0;
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left + container.scrollLeft;
      return clamp((x / timelineWidth) * totalDuration, 0, totalDuration);
    },
    [timelineWidth, totalDuration]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!dragState) return;

      const deltaX = event.clientX - dragState.startX;
      const deltaTime = (deltaX / timelineWidth) * totalDuration;
      const original = dragState.originalClip;

      if (dragState.type === "trim-start" && original.type === "video") {
        const newStart = clamp(original.sourceStartTime + deltaTime, 0, original.sourceEndTime - 0.1);
        dispatch({ type: "TRIM_CLIP", clipId: dragState.clipId, newStart, newEnd: original.sourceEndTime });
        return;
      }

      if (dragState.type === "trim-end" && original.type === "video") {
        const maxEnd = original.sourceClipId
          ? libraryClips.find((clip) => clip.id === original.sourceClipId)?.duration ?? original.sourceEndTime
          : original.sourceEndTime;
        const newEnd = clamp(original.sourceEndTime + deltaTime, original.sourceStartTime + 0.1, maxEnd);
        dispatch({ type: "TRIM_CLIP", clipId: dragState.clipId, newStart: original.sourceStartTime, newEnd });
        return;
      }

      const newIndex = clamp(dragState.clipIndex + Math.round(deltaX / 140), 0, Math.max(clips.length - 1, 0));
      if (newIndex !== dragState.clipIndex) {
        dispatch({ type: "REORDER_CLIP", fromIndex: dragState.clipIndex, toIndex: newIndex });
        setDragState((state) => (state ? { ...state, clipIndex: newIndex } : state));
      }
    },
    [clips.length, dispatch, dragState, libraryClips, timelineWidth, totalDuration]
  );

  const handleMouseUp = useCallback(() => {
    setDragState(null);
  }, []);

  const handleSplit = useCallback(() => {
    if (!selectedClipId) return;

    const activeClip = clipsWithOffsets.find((clip) => clip.id === selectedClipId);
    if (!activeClip || activeClip.type !== "video") return;

    const localOffset = currentTime - activeClip.sequenceStart;
    const splitTime = activeClip.sourceStartTime + localOffset;
    if (splitTime <= activeClip.sourceStartTime || splitTime >= activeClip.sourceEndTime) return;

    dispatch({ type: "SPLIT_CLIP", clipId: activeClip.id, splitTime });
  }, [clipsWithOffsets, currentTime, dispatch, selectedClipId]);

  const handleDelete = useCallback(() => {
    if (!selectedClipId) return;
    dispatch({ type: "DELETE_CLIP", clipId: selectedClipId });
    onSelectClip(null);
  }, [dispatch, onSelectClip, selectedClipId]);

  const playheadX = totalDuration > 0 ? (currentTime / totalDuration) * timelineWidth : 0;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#111215]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.22em] text-white/32">Sequence</p>
          <p className="mt-1 text-sm text-white/80">Build the cut by dragging clips from the media bin.</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={handleSplit}
            disabled={!selectedClipId}
            className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-[11px] font-medium text-white/82 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-35"
          >
            Split
          </button>
          <button
            onClick={handleDelete}
            disabled={!selectedClipId}
            className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[11px] font-medium text-red-200 transition hover:bg-red-500/16 disabled:cursor-not-allowed disabled:opacity-35"
          >
            Delete
          </button>
          <div className="ml-2 flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1.5">
            <button
              onClick={() => setZoom((value) => Math.max(0.35, value / 1.25))}
              className="text-xs text-white/55 transition hover:text-white/85"
            >
              -
            </button>
            <span className="w-12 text-center text-[11px] font-medium text-white/55">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom((value) => Math.min(4, value * 1.25))}
              className="text-xs text-white/55 transition hover:text-white/85"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="w-16 shrink-0 border-r border-white/8 bg-[#0f1013]">
          <div className="h-12 border-b border-white/8" />
          <div className="flex h-[92px] items-center justify-center border-b border-white/8 text-xs font-medium uppercase tracking-[0.18em] text-white/42">
            V1
          </div>
          <div className="flex h-[92px] items-center justify-center text-xs font-medium uppercase tracking-[0.18em] text-white/42">
            A1
          </div>
        </div>

        <div
          ref={containerRef}
          className={`relative min-h-0 min-w-0 flex-1 overflow-auto ${
            isDropTarget ? "bg-sky-400/[0.03]" : "bg-[#15171b]"
          }`}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("[data-clip]")) return;
            onSeek(getTimeFromX(event.clientX));
          }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDropTarget(true);
          }}
          onDragLeave={() => setIsDropTarget(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDropTarget(false);
            const sourceClipId = event.dataTransfer.getData("application/x-vibecut-library-clip");
            if (sourceClipId) onAppendFromLibrary(sourceClipId);
          }}
        >
          <div className="relative" style={{ width: timelineWidth }}>
            <div className="relative h-12 border-b border-white/8 bg-[#121418]">
              {Array.from({ length: Math.ceil((totalDuration || 30) / 5) + 1 }).map((_, index) => {
                const markerTime = index * 5;
                const markerX = totalDuration > 0 ? (markerTime / totalDuration) * timelineWidth : index * 88 * zoom;
                return (
                  <div key={markerTime} className="absolute inset-y-0 border-l border-white/6" style={{ left: markerX }}>
                    <span className="absolute left-1 top-2 text-[10px] uppercase tracking-[0.16em] text-white/24">
                      {formatTime(markerTime)}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="relative h-[92px] border-b border-white/8 bg-[linear-gradient(180deg,_rgba(255,255,255,0.02),_transparent)]">
              {clipsWithOffsets.map((clip, index) => {
                const widthPercent = totalDuration > 0 ? (clip.duration / totalDuration) * 100 : 0;
                const leftPercent = totalDuration > 0 ? (clip.sequenceStart / totalDuration) * 100 : 0;
                const isSelected = clip.id === selectedClipId;
                const title = clip.label || clip.source?.fileName || "Still";

                return (
                  <div
                    key={clip.id}
                    data-clip
                    className={`absolute inset-y-3 overflow-hidden rounded-xl border transition ${
                      isSelected
                        ? "border-sky-400/55 bg-sky-400/20 shadow-[0_0_0_1px_rgba(56,189,248,0.15)]"
                        : "border-white/8 bg-[#2c4668] hover:border-white/18"
                    }`}
                    style={{ left: `${leftPercent}%`, width: `${widthPercent}%`, minWidth: 78 }}
                  >
                    {clip.type === "video" && (
                      <div
                        className="absolute inset-y-0 left-0 w-2 cursor-col-resize bg-black/10 hover:bg-white/18"
                        onMouseDown={(event) => {
                          event.stopPropagation();
                          onSelectClip(clip.id);
                          setDragState({
                            type: "trim-start",
                            clipId: clip.id,
                            startX: event.clientX,
                            originalClip: clip,
                            clipIndex: index,
                          });
                        }}
                      />
                    )}

                    <button
                      type="button"
                      className="flex h-full w-full items-end justify-between px-3 py-2 text-left"
                      onMouseDown={(event) => {
                        event.stopPropagation();
                        onSelectClip(clip.id);
                        setDragState({
                          type: "move",
                          clipId: clip.id,
                          startX: event.clientX,
                          originalClip: clip,
                          clipIndex: index,
                        });
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectClip(clip.id);
                      }}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium text-white/92">{title}</p>
                        <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-white/44">
                          {clip.type === "image"
                            ? `still ${formatTime(clip.duration)}`
                            : `${formatTime(clip.sourceStartTime)} - ${formatTime(clip.sourceEndTime)}`}
                        </p>
                      </div>
                      <span className="ml-3 rounded-md bg-black/18 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-white/54">
                        {formatTime(clip.duration)}
                      </span>
                    </button>

                    {clip.type === "video" && (
                      <div
                        className="absolute inset-y-0 right-0 w-2 cursor-col-resize bg-black/10 hover:bg-white/18"
                        onMouseDown={(event) => {
                          event.stopPropagation();
                          onSelectClip(clip.id);
                          setDragState({
                            type: "trim-end",
                            clipId: clip.id,
                            startX: event.clientX,
                            originalClip: clip,
                            clipIndex: index,
                          });
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="relative h-[92px] bg-[linear-gradient(180deg,_rgba(56,189,248,0.04),_transparent)]">
              {clipsWithOffsets.map((clip) => {
                const widthPercent = totalDuration > 0 ? (clip.duration / totalDuration) * 100 : 0;
                const leftPercent = totalDuration > 0 ? (clip.sequenceStart / totalDuration) * 100 : 0;
                const waveform = clip.source?.waveform || [];
                const isSelected = clip.id === selectedClipId;

                return (
                  <div
                    key={`${clip.id}-audio`}
                    className={`absolute inset-y-3 rounded-xl border ${
                      isSelected
                        ? "border-sky-400/45 bg-sky-500/10"
                        : "border-white/8 bg-[#17303f]"
                    }`}
                    style={{ left: `${leftPercent}%`, width: `${widthPercent}%`, minWidth: 78 }}
                  >
                    <div className="flex h-full items-center gap-[2px] overflow-hidden px-3 py-3">
                      {waveform.length > 0 ? (
                        renderWaveform(waveform)
                      ) : (
                        <div className="h-px w-full bg-sky-200/28" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {clips.length === 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-20 flex justify-center">
                <div className="rounded-full border border-dashed border-white/10 bg-white/[0.03] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-white/34">
                  Drop ready clips here to start the sequence
                </div>
              </div>
            )}

            <div
              className="pointer-events-none absolute inset-y-0 z-10 w-px bg-sky-400"
              style={{ left: playheadX }}
            >
              <div className="absolute left-1/2 top-2 h-3 w-3 -translate-x-1/2 rotate-45 bg-sky-400" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
