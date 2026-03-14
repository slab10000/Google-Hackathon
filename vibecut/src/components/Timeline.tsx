"use client";
import { useState, useRef, useCallback, useMemo } from "react";
import { TimelineClip, TimelineAction } from "@/types";

interface TimelineProps {
  clips: TimelineClip[];
  totalDuration: number;
  currentTime: number;
  playheadPosition: number;
  onSeek: (time: number) => void;
  dispatch: React.Dispatch<TimelineAction>;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function Timeline({
  clips,
  totalDuration,
  currentTime,
  playheadPosition,
  onSeek,
  dispatch,
  selectedClipId,
  onSelectClip,
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [dragState, setDragState] = useState<{
    type: "move" | "trim-start" | "trim-end";
    clipId: string;
    startX: number;
    originalClip: TimelineClip;
    clipIndex: number;
  } | null>(null);

  const timelineWidth = useMemo(() => Math.max(totalDuration * 80 * zoom, 600), [totalDuration, zoom]);

  const getTimeFromX = useCallback(
    (clientX: number): number => {
      const container = containerRef.current;
      if (!container) return 0;
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left + container.scrollLeft;
      return Math.max(0, (x / timelineWidth) * totalDuration);
    },
    [timelineWidth, totalDuration]
  );

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent) => {
      if (dragState) return;
      if ((e.target as HTMLElement).closest("[data-clip]")) return;
      const time = getTimeFromX(e.clientX);
      onSeek(time);
    },
    [getTimeFromX, onSeek, dragState]
  );

  const handleClipMouseDown = useCallback(
    (e: React.MouseEvent, clip: TimelineClip, type: "move" | "trim-start" | "trim-end", index: number) => {
      e.stopPropagation();
      onSelectClip(clip.id);
      setDragState({
        type,
        clipId: clip.id,
        startX: e.clientX,
        originalClip: { ...clip },
        clipIndex: index,
      });
    },
    [onSelectClip]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dt = (dx / timelineWidth) * totalDuration;
      const orig = dragState.originalClip;

      if (dragState.type === "trim-start" && orig.type === "video") {
        const newStart = Math.max(0, Math.min(orig.startTime + dt, orig.endTime - 0.1));
        dispatch({ type: "TRIM_CLIP", clipId: dragState.clipId, newStart, newEnd: orig.endTime });
      } else if (dragState.type === "trim-end" && orig.type === "video") {
        const newEnd = Math.max(orig.startTime + 0.1, orig.endTime + dt);
        dispatch({ type: "TRIM_CLIP", clipId: dragState.clipId, newStart: orig.startTime, newEnd });
      } else if (dragState.type === "move") {
        const newIndex = Math.max(
          0,
          Math.min(clips.length - 1, dragState.clipIndex + Math.round(dx / 100))
        );
        if (newIndex !== dragState.clipIndex) {
          dispatch({ type: "REORDER_CLIP", fromIndex: dragState.clipIndex, toIndex: newIndex });
          setDragState({ ...dragState, clipIndex: newIndex });
        }
      }
    },
    [dragState, timelineWidth, totalDuration, dispatch, clips.length]
  );

  const handleMouseUp = useCallback(() => {
    setDragState(null);
  }, []);

  const handleSplit = useCallback(() => {
    if (!selectedClipId) return;
    const clip = clips.find((c) => c.id === selectedClipId);
    if (!clip || clip.type !== "video") return;
    // Calculate split time based on playhead position relative to clip
    let accTime = 0;
    for (const c of clips) {
      if (c.id === selectedClipId) {
        const splitTime = clip.startTime + (playheadPosition - accTime);
        if (splitTime > clip.startTime && splitTime < clip.endTime) {
          dispatch({ type: "SPLIT_CLIP", clipId: selectedClipId, splitTime });
        }
        break;
      }
      accTime += c.duration;
    }
  }, [selectedClipId, clips, playheadPosition, dispatch]);

  const handleDelete = useCallback(() => {
    if (selectedClipId) {
      dispatch({ type: "DELETE_CLIP", clipId: selectedClipId });
      onSelectClip(null);
    }
  }, [selectedClipId, dispatch, onSelectClip]);

  // Calculate playhead X position
  const playheadX = totalDuration > 0 ? (playheadPosition / totalDuration) * timelineWidth : 0;

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2">
        <button
          onClick={handleSplit}
          disabled={!selectedClipId}
          className="px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs rounded-lg transition-colors flex items-center gap-1"
          title="Split at playhead"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={2} d="M12 2v20M4 12h4M16 12h4" />
          </svg>
          Split
        </button>
        <button
          onClick={handleDelete}
          disabled={!selectedClipId}
          className="px-3 py-1.5 bg-red-600/50 hover:bg-red-500/70 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs rounded-lg transition-colors flex items-center gap-1"
          title="Delete selected clip"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Delete
        </button>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.max(0.25, z / 1.5))}
            className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white text-xs rounded transition-colors"
          >
            -
          </button>
          <span className="text-xs text-white/40 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(4, z * 1.5))}
            className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white text-xs rounded transition-colors"
          >
            +
          </button>
        </div>
      </div>

      {/* Timeline track */}
      <div
        ref={containerRef}
        className="relative overflow-x-auto bg-white/5 rounded-xl border border-white/10"
        style={{ height: 80 }}
        onClick={handleTimelineClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div className="relative h-full" style={{ width: timelineWidth }}>
          {/* Time markers */}
          {Array.from({ length: Math.ceil(totalDuration / 5) + 1 }).map((_, i) => {
            const t = i * 5;
            const x = (t / totalDuration) * timelineWidth;
            return (
              <div
                key={i}
                className="absolute top-0 h-full border-l border-white/5"
                style={{ left: x }}
              >
                <span className="absolute top-1 left-1 text-[9px] text-white/20 font-mono">
                  {formatTime(t)}
                </span>
              </div>
            );
          })}

          {/* Clips */}
          {clips.map((clip, idx) => {
            const widthPercent = totalDuration > 0 ? (clip.duration / totalDuration) * 100 : 0;
            let leftPercent = 0;
            for (let i = 0; i < idx; i++) {
              leftPercent += (clips[i].duration / totalDuration) * 100;
            }

            const isSelected = clip.id === selectedClipId;

            return (
              <div
                key={clip.id}
                data-clip
                className={`absolute top-3 bottom-3 rounded-lg flex items-center overflow-hidden transition-shadow ${
                  clip.type === "video"
                    ? isSelected
                      ? "bg-violet-600/60 ring-2 ring-violet-400"
                      : "bg-violet-600/30 hover:bg-violet-600/40"
                    : isSelected
                    ? "bg-amber-500/60 ring-2 ring-amber-400"
                    : "bg-amber-500/30 hover:bg-amber-500/40"
                }`}
                style={{
                  left: `${leftPercent}%`,
                  width: `${widthPercent}%`,
                  minWidth: 4,
                }}
              >
                {/* Trim start handle */}
                {clip.type === "video" && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-white/30 rounded-l-lg"
                    onMouseDown={(e) => handleClipMouseDown(e, clip, "trim-start", idx)}
                  />
                )}

                {/* Clip body (draggable to reorder) */}
                <div
                  className="flex-1 h-full flex items-center px-2 cursor-grab active:cursor-grabbing"
                  onMouseDown={(e) => handleClipMouseDown(e, clip, "move", idx)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectClip(clip.id);
                  }}
                >
                  <span className="text-[10px] text-white/60 truncate">
                    {clip.type === "image"
                      ? "IMG"
                      : `${formatTime(clip.startTime)}-${formatTime(clip.endTime)}`}
                  </span>
                </div>

                {/* Trim end handle */}
                {clip.type === "video" && (
                  <div
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-white/30 rounded-r-lg"
                    onMouseDown={(e) => handleClipMouseDown(e, clip, "trim-end", idx)}
                  />
                )}
              </div>
            );
          })}

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
            style={{ left: playheadX }}
          >
            <div className="absolute -top-1 -left-1.5 w-3.5 h-3 bg-red-500 rounded-sm" />
          </div>
        </div>
      </div>
    </div>
  );
}
