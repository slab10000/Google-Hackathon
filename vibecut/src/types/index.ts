export type ClipProcessingStatus = "queued" | "processing" | "ready" | "error";
export type MonitorMode = "source" | "program";
export type DockTab = "ai" | "transcript" | "inspector";

export interface TranscriptSegment {
  id: string;
  sourceClipId: string;
  startTime: number;
  endTime: number;
  text: string;
  embedding?: number[];
}

export interface LibraryClip {
  id: string;
  file: File;
  fileName: string;
  objectUrl: string;
  duration: number;
  status: ClipProcessingStatus;
  transcriptSegments: TranscriptSegment[];
  embeddingsReady: boolean;
  waveform: number[];
  error?: string;
}

export interface TimelineClip {
  id: string;
  type: "video" | "image";
  sourceClipId?: string;
  sourceStartTime: number;
  sourceEndTime: number;
  duration: number;
  label?: string;
  imageSrc?: string;
}

export interface TimelineState {
  clips: TimelineClip[];
  totalDuration: number;
}

export type TimelineAction =
  | { type: "ADD_SOURCE_CLIP"; sourceClipId: string; duration: number; label?: string }
  | { type: "REMOVE_SEGMENTS"; segments: TranscriptSegment[] }
  | { type: "INSERT_IMAGE"; afterClipId: string | null; imageSrc: string; duration: number; label?: string }
  | { type: "APPLY_EDIT"; clips: TimelineClip[] }
  | { type: "SPLIT_CLIP"; clipId: string; splitTime: number }
  | { type: "TRIM_CLIP"; clipId: string; newStart: number; newEnd: number }
  | { type: "DELETE_CLIP"; clipId: string }
  | { type: "REORDER_CLIP"; fromIndex: number; toIndex: number }
  | { type: "SET_CLIPS"; clips: TimelineClip[] };

export interface EditRange {
  sourceClipId?: string;
  startTime: number;
  endTime: number;
}

export interface EditOperation {
  type: string;
  sourceClipId?: string;
  startTime?: number;
  endTime?: number;
  fromIndex?: number;
  toIndex?: number;
  ranges?: EditRange[];
  prompt?: string;
  duration?: number;
  afterTime?: number;
  reason?: string;
}

export interface EditCommandResponse {
  operations: EditOperation[];
  explanation: string;
}
