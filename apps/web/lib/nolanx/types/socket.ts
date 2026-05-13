import { ExcalidrawImageElement } from '@excalidraw/excalidraw/element/types'
import { BinaryFileData } from '@excalidraw/excalidraw/types'
import { Message, ToolCallFunctionName } from './types'

export enum SessionEventType {
  Error = 'error',
  Done = 'done',
  Info = 'info',
  ImageGenerated = 'image_generated',
  VideoGenerated = 'video_generated',
  AudioGenerated = 'audio_generated',
  ScriptGenerated = 'script_generated',
  ImageEditStart = 'image_edit_start',
  ImageEditComplete = 'image_edit_complete',
  Delta = 'delta',
  ToolCall = 'tool_call',
  ToolCallArguments = 'tool_call_arguments',
  ToolResult = 'tool_result',
  AllMessages = 'all_messages',
  ToolCallProgress = 'tool_call_progress',
  ToolCallWorkflowState = 'tool_call_workflow_state',
  Review = 'review',
}

export interface SessionBaseEvent {
  session_id: string
}

export interface SessionErrorEvent extends SessionBaseEvent {
  type: SessionEventType.Error
  error: string
}
export interface SessionDoneEvent extends SessionBaseEvent {
  type: SessionEventType.Done
}
export interface SessionInfoEvent extends SessionBaseEvent {
  type: SessionEventType.Info
  info: string
  data?: any
}
export interface SessionImageGeneratedEvent extends SessionBaseEvent {
  type: SessionEventType.ImageGenerated
  canvas_id: string
  image_url: string
  source?: string
  tool_name?: ToolCallFunctionName | string
  asset?: any
  element?: ExcalidrawImageElement
  file?: BinaryFileData
}
export interface SessionVideoGeneratedEvent extends SessionBaseEvent {
  type: SessionEventType.VideoGenerated
  canvas_id: string
  video_url: string
  source?: string
  tool_name?: ToolCallFunctionName | string
  asset?: any
  element?: any // Video element type
  file?: BinaryFileData
}
export interface SessionAudioGeneratedEvent extends SessionBaseEvent {
  type: SessionEventType.AudioGenerated
  canvas_id: string
  audio_url: string
  source?: string
  tool_name?: ToolCallFunctionName | string
  asset?: any
  element?: any // Audio element type
  file?: BinaryFileData
}
export interface SessionScriptGeneratedEvent extends SessionBaseEvent {
  type: SessionEventType.ScriptGenerated
  canvas_id: string
  source?: string
  storyboardFingerprint?: string
}
export interface SessionImageEditStartEvent extends SessionBaseEvent {
  type: SessionEventType.ImageEditStart
  canvas_id: string
  image_id?: string
  edit_request?: string
  original_image_url?: string
  data?: any
}
export interface SessionImageEditCompleteEvent extends SessionBaseEvent {
  type: SessionEventType.ImageEditComplete
  canvas_id: string
  image_id?: string
  element?: ExcalidrawImageElement
  file?: BinaryFileData
  edited_image_url?: string
  original_image_url?: string
  data?: any
}
export interface SessionDeltaEvent extends SessionBaseEvent {
  type: SessionEventType.Delta
  text: string
}
export interface SessionToolCallEvent extends SessionBaseEvent {
  type: SessionEventType.ToolCall
  id: string
  name: ToolCallFunctionName
}
export interface SessionToolCallArgumentsEvent extends SessionBaseEvent {
  type: SessionEventType.ToolCallArguments
  id: string
  text: string
}
export interface SessionToolResultEvent extends SessionBaseEvent {
  type: SessionEventType.ToolResult
  tool_call_id: string
  content: string
}
export interface SessionAllMessagesEvent extends SessionBaseEvent {
  type: SessionEventType.AllMessages
  messages: Message[]
}
export interface SessionToolCallProgressEvent extends SessionBaseEvent {
  type: SessionEventType.ToolCallProgress
  tool_call_id: string
  update: string
}
export interface SessionToolCallWorkflowStateEvent extends SessionBaseEvent {
  type: SessionEventType.ToolCallWorkflowState
  tool_call_id: string
  workflow: any
}
export interface SessionReviewEvent extends SessionBaseEvent {
  type: SessionEventType.Review
  layer: string
  status: string
  score?: number
  summary: string
  detail?: string
  target_kind?: string
  target_id?: string
  prompt_excerpt?: string
}

export type SessionUpdateEvent =
  | SessionDeltaEvent
  | SessionToolCallEvent
  | SessionToolCallArgumentsEvent
  | SessionToolResultEvent
  | SessionToolCallProgressEvent
  | SessionToolCallWorkflowStateEvent
  | SessionImageGeneratedEvent
  | SessionVideoGeneratedEvent
  | SessionAudioGeneratedEvent
  | SessionScriptGeneratedEvent
  | SessionImageEditStartEvent
  | SessionImageEditCompleteEvent
  | SessionAllMessagesEvent
  | SessionDoneEvent
  | SessionErrorEvent
  | SessionInfoEvent
  | SessionReviewEvent
