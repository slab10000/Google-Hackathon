import { TimelineClip, TimelineState, TimelineAction, TranscriptSegment } from "@/types";
import { v4 as uuid } from "uuid";

function computeTotalDuration(clips: TimelineClip[]): number {
  return clips.reduce((sum, clip) => sum + clip.duration, 0);
}

export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  switch (action.type) {
    case "SET_ORIGINAL": {
      const clip: TimelineClip = {
        id: uuid(),
        type: "video",
        startTime: 0,
        endTime: action.duration,
        duration: action.duration,
      };
      return {
        clips: [clip],
        totalDuration: action.duration,
        originalVideoUrl: action.url,
        originalDuration: action.duration,
      };
    }

    case "REMOVE_SEGMENTS": {
      const removeRanges = action.segments
        .map((s) => ({ start: s.startTime, end: s.endTime }))
        .sort((a, b) => a.start - b.start);

      const newClips: TimelineClip[] = [];
      for (const clip of state.clips) {
        if (clip.type === "image") {
          newClips.push(clip);
          continue;
        }
        let currentStart = clip.startTime;
        for (const range of removeRanges) {
          if (range.end <= clip.startTime || range.start >= clip.endTime) continue;
          const cutStart = Math.max(range.start, clip.startTime);
          const cutEnd = Math.min(range.end, clip.endTime);
          if (cutStart > currentStart) {
            newClips.push({
              id: uuid(),
              type: "video",
              startTime: currentStart,
              endTime: cutStart,
              duration: cutStart - currentStart,
              transcriptText: clip.transcriptText,
            });
          }
          currentStart = cutEnd;
        }
        if (currentStart < clip.endTime) {
          newClips.push({
            id: uuid(),
            type: "video",
            startTime: currentStart,
            endTime: clip.endTime,
            duration: clip.endTime - currentStart,
            transcriptText: clip.transcriptText,
          });
        }
      }
      return { ...state, clips: newClips, totalDuration: computeTotalDuration(newClips) };
    }

    case "INSERT_IMAGE": {
      const newClip: TimelineClip = {
        id: uuid(),
        type: "image",
        startTime: 0,
        endTime: action.duration,
        duration: action.duration,
        imageSrc: action.imageSrc,
      };
      const clips = [...state.clips];
      if (action.afterClipId) {
        const idx = clips.findIndex((c) => c.id === action.afterClipId);
        clips.splice(idx + 1, 0, newClip);
      } else {
        clips.unshift(newClip);
      }
      return { ...state, clips, totalDuration: computeTotalDuration(clips) };
    }

    case "SPLIT_CLIP": {
      const clips = [...state.clips];
      const idx = clips.findIndex((c) => c.id === action.clipId);
      if (idx === -1) return state;
      const clip = clips[idx];
      if (clip.type !== "video") return state;
      if (action.splitTime <= clip.startTime || action.splitTime >= clip.endTime) return state;
      const left: TimelineClip = {
        id: uuid(),
        type: "video",
        startTime: clip.startTime,
        endTime: action.splitTime,
        duration: action.splitTime - clip.startTime,
        transcriptText: clip.transcriptText,
      };
      const right: TimelineClip = {
        id: uuid(),
        type: "video",
        startTime: action.splitTime,
        endTime: clip.endTime,
        duration: clip.endTime - action.splitTime,
        transcriptText: clip.transcriptText,
      };
      clips.splice(idx, 1, left, right);
      return { ...state, clips, totalDuration: computeTotalDuration(clips) };
    }

    case "TRIM_CLIP": {
      const clips = state.clips.map((c) => {
        if (c.id !== action.clipId) return c;
        const newDuration = action.newEnd - action.newStart;
        return { ...c, startTime: action.newStart, endTime: action.newEnd, duration: newDuration };
      });
      return { ...state, clips, totalDuration: computeTotalDuration(clips) };
    }

    case "DELETE_CLIP": {
      const clips = state.clips.filter((c) => c.id !== action.clipId);
      return { ...state, clips, totalDuration: computeTotalDuration(clips) };
    }

    case "REORDER_CLIP": {
      const clips = [...state.clips];
      const [moved] = clips.splice(action.fromIndex, 1);
      clips.splice(action.toIndex, 0, moved);
      return { ...state, clips };
    }

    case "APPLY_EDIT": {
      return { ...state, clips: action.clips, totalDuration: computeTotalDuration(action.clips) };
    }

    case "SET_CLIPS": {
      return { ...state, clips: action.clips, totalDuration: computeTotalDuration(action.clips) };
    }

    default:
      return state;
  }
}

export const initialTimelineState: TimelineState = {
  clips: [],
  totalDuration: 0,
  originalVideoUrl: "",
  originalDuration: 0,
};
