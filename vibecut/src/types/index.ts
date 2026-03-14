export interface TranscriptSegment {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  embedding?: number[];
}

export interface TimelineClip {
  id: string;
  type: "video" | "image";
  startTime: number;
  endTime: number;
  duration: number;
  transcriptText?: string;
  imageSrc?: string;
}

export interface TimelineState {
  clips: TimelineClip[];
  totalDuration: number;
  originalVideoUrl: string;
  originalDuration: number;
}

export type TimelineAction =
  | { type: "SET_ORIGINAL"; url: string; duration: number }
  | { type: "REMOVE_SEGMENTS"; segments: TranscriptSegment[] }
  | { type: "INSERT_IMAGE"; afterClipId: string | null; imageSrc: string; duration: number }
  | { type: "APPLY_EDIT"; clips: TimelineClip[] }
  | { type: "SPLIT_CLIP"; clipId: string; splitTime: number }
  | { type: "TRIM_CLIP"; clipId: string; newStart: number; newEnd: number }
  | { type: "DELETE_CLIP"; clipId: string }
  | { type: "REORDER_CLIP"; fromIndex: number; toIndex: number }
  | { type: "SET_CLIPS"; clips: TimelineClip[] };

export interface EditOperation {
  type: string;
  startTime?: number;
  endTime?: number;
  fromStart?: number;
  fromEnd?: number;
  insertBeforeStart?: number;
  prompt?: string;
  duration?: number;
  afterTime?: number;
  reason?: string;
}

export interface EditCommandResponse {
  operations: EditOperation[];
  explanation: string;
}
