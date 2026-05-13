import * as ISocket from '@/lib/nolanx/types/socket'
import mitt from 'mitt'

export type TCanvasAddImagesToChatEvent = {
  fileId: string
  base64?: string
  url?: string
  width: number
  height: number
}[]

export type TEvents = {
  // ********** Socket events - Start **********
  'Socket::Session::Error': ISocket.SessionErrorEvent
  'Socket::Session::Done': ISocket.SessionDoneEvent
  'Socket::Session::Info': ISocket.SessionInfoEvent
  'Socket::Session::ImageGenerated': ISocket.SessionImageGeneratedEvent
  'Socket::Session::VideoGenerated': ISocket.SessionVideoGeneratedEvent
  'Socket::Session::AudioGenerated': ISocket.SessionAudioGeneratedEvent
  'Socket::Session::ScriptGenerated': ISocket.SessionScriptGeneratedEvent
  'Socket::Session::ImageEditStart': ISocket.SessionImageEditStartEvent
  'Socket::Session::ImageEditComplete': ISocket.SessionImageEditCompleteEvent
  'Socket::Session::Delta': ISocket.SessionDeltaEvent
  'Socket::Session::ToolCall': ISocket.SessionToolCallEvent
  'Socket::Session::ToolCallArguments': ISocket.SessionToolCallArgumentsEvent
  'Socket::Session::ToolResult': ISocket.SessionToolResultEvent
  'Socket::Session::AllMessages': ISocket.SessionAllMessagesEvent
  'Socket::Session::ToolCallProgress': ISocket.SessionToolCallProgressEvent
  'Socket::Session::ToolCallWorkflowState': ISocket.SessionToolCallWorkflowStateEvent
  'Socket::Session::Review': ISocket.SessionReviewEvent
  // ********** Socket events - End **********

  // ********** Canvas events - Start **********
  'Canvas::AddImagesToChat': TCanvasAddImagesToChatEvent
  'Canvas::DataUpdated': { canvasId: string; trigger: string }
  'Canvas::Preview::ExportFullscreen': { canvasId: string }
  'Runtime::OpenSettings': { source?: 'image' | 'video' | 'text' | 'general'; reason?: string }
  // ********** Canvas events - End **********
}

export const eventBus = mitt<TEvents>()
