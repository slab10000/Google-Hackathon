"use client";
import { RefObject } from "react";

interface VideoPlayerProps {
  videoUrl: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VideoPlayer({
  videoUrl,
  videoRef,
  isPlaying,
  currentTime,
  duration,
  onTogglePlay,
  onSeek,
}: VideoPlayerProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 bg-black rounded-xl overflow-hidden relative flex items-center justify-center">
        <video
          ref={videoRef}
          src={videoUrl}
          className="max-w-full max-h-full object-contain"
          onClick={onTogglePlay}
        />
        {!isPlaying && (
          <button
            onClick={onTogglePlay}
            className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/20 transition-colors"
          >
            <div className="w-16 h-16 bg-white/90 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-black ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </button>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={onTogglePlay}
          className="w-10 h-10 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
        >
          {isPlaying ? (
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <div className="flex-1 relative h-1.5 bg-white/10 rounded-full group cursor-pointer">
          <div
            className="absolute h-full bg-violet-500 rounded-full"
            style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </div>
        <span className="text-xs text-white/50 font-mono tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}
