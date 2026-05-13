import * as ISocket from '@/lib/nolanx/types/socket'
import { getSiteConfig } from '@/lib/site'
import { io, Socket } from 'socket.io-client'
import { eventBus } from './event'

export interface SocketConfig {
  serverUrl?: string
  autoConnect?: boolean
}

export class SocketIOManager {
  private socket: Socket | null = null
  private connected = false
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000

  constructor(private config: SocketConfig = {}) {
    if (config.autoConnect !== false) {
      this.connect()
    }
  }

  async connect(serverUrl?: string): Promise<boolean> {
    // 确保只在客户端运行
    if (typeof window === 'undefined') {
      console.warn('Socket connection attempted on server side, skipping')
      return false
    }

    return new Promise(async (resolve, reject) => {
      const url = serverUrl || this.config.serverUrl

      // 如果已经连接，直接返回
      if (this.socket && this.connected) {
        console.log('🔗 Socket already connected, reusing existing connection')
        resolve(true)
        return
      }

      // 断开现有连接
      if (this.socket) {
        this.socket.disconnect()
      }

      // 获取认证token
      const authToken = await this.getAuthToken()
      console.log(url)
      this.socket = io(url, {
        transports: ['websocket'],
        upgrade: false,
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay,
        auth: {
          token: authToken
        }
      })

      this.socket.on('connect', () => {
        console.log('✅ Socket.IO connected:', this.socket?.id)
        this.connected = true
        this.reconnectAttempts = 0
        resolve(true)
      })

      this.socket.on('connect_error', (error) => {
        console.error('❌ Socket.IO connection error:', error)
        this.connected = false
        this.reconnectAttempts++

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          reject(
            new Error(
              `Failed to connect after ${this.maxReconnectAttempts} attempts`
            )
          )
        }
      })

      this.socket.on('disconnect', (reason) => {
        console.log('🔌 Socket.IO disconnected:', reason)
        this.connected = false
      })

      this.registerEventHandlers()
    })
  }

  private registerEventHandlers() {
    if (!this.socket) return

    this.socket.on('connected', (data) => {
      console.log('🔗 Socket.IO connection confirmed:', data)
    })

    this.socket.on('init_done', (data) => {
      console.log('🔗 Server initialization done:', data)
    })

    this.socket.on('session_update', (data) => {
      this.handleSessionUpdate(data)
    })

    this.socket.on('pong', (data) => {
      console.log('🔗 Pong received:', data)
    })

    this.socket.on('auth_error', (data) => {
      console.error('🔐 WebSocket authentication error:', data)
      this.handleAuthError(data)
    })

    this.socket.on('connection_error', (data) => {
      console.error('🔌 WebSocket connection error:', data)
    })

    this.socket.on('rate_limit_error', (data) => {
      console.error('⚡ WebSocket rate limit error:', data)
      this.handleRateLimitError(data)
    })

    this.socket.on('rate_limit_warning', (data) => {
      console.warn('⚡ WebSocket rate limit warning:', data)
    })
  }

  private handleSessionUpdate(data: ISocket.SessionUpdateEvent) {
    const { session_id, type } = data

    if (!session_id) {
      console.warn('⚠️ Session update missing session_id:', data)
      return
    }

    switch (type) {
      case ISocket.SessionEventType.Delta:
        eventBus.emit('Socket::Session::Delta', data)
        break
      case ISocket.SessionEventType.ToolCall:
        eventBus.emit('Socket::Session::ToolCall', data)
        break
      case ISocket.SessionEventType.ToolCallArguments:
        eventBus.emit('Socket::Session::ToolCallArguments', data)
        break
      case ISocket.SessionEventType.ToolResult:
        eventBus.emit('Socket::Session::ToolResult', data)
        break
      case ISocket.SessionEventType.ToolCallProgress:
        eventBus.emit('Socket::Session::ToolCallProgress', data)
        break
      case ISocket.SessionEventType.ToolCallWorkflowState:
        eventBus.emit('Socket::Session::ToolCallWorkflowState', data)
        break
      case ISocket.SessionEventType.ImageGenerated:
        eventBus.emit('Socket::Session::ImageGenerated', data)
        break
      case ISocket.SessionEventType.VideoGenerated:
        eventBus.emit('Socket::Session::VideoGenerated', data)
        break
      case ISocket.SessionEventType.AudioGenerated:
        eventBus.emit('Socket::Session::AudioGenerated', data)
        break
      case ISocket.SessionEventType.ScriptGenerated:
        eventBus.emit('Socket::Session::ScriptGenerated', data)
        break
      case ISocket.SessionEventType.ImageEditStart:
        eventBus.emit('Socket::Session::ImageEditStart', data)
        break
      case ISocket.SessionEventType.ImageEditComplete:
        eventBus.emit('Socket::Session::ImageEditComplete', data)
        break
      case ISocket.SessionEventType.AllMessages:
        eventBus.emit('Socket::Session::AllMessages', data)
        break
      case ISocket.SessionEventType.Done:
        eventBus.emit('Socket::Session::Done', data)
        break
      case ISocket.SessionEventType.Error:
        eventBus.emit('Socket::Session::Error', data)
        break
      case ISocket.SessionEventType.Info:
        eventBus.emit('Socket::Session::Info', data)
        break
      case ISocket.SessionEventType.Review:
        eventBus.emit('Socket::Session::Review', data)
        break
      default:
        console.log('⚠️ Unknown session update type:', type)
    }
  }

  ping(data: unknown) {
    if (this.socket && this.connected) {
      this.socket.emit('ping', data)
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
      this.connected = false
      console.log('🔌 Socket.IO manually disconnected')
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  getSocketId(): string | undefined {
    return this.socket?.id
  }

  getSocket(): Socket | null {
    return this.socket
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts
  }

  isMaxReconnectAttemptsReached(): boolean {
    return this.reconnectAttempts >= this.maxReconnectAttempts
  }

  /**
   * 获取认证token
   */
  private async getAuthToken(): Promise<string | null> {
    try {
      if (typeof window === 'undefined') {
        return null;
      }
      return 'nolanx-local-dev-token';
    } catch (error) {
      console.error('Error getting auth token for WebSocket:', error);
      return null;
    }
  }

  /**
   * 处理认证错误
   */
  private async handleAuthError(data: any) {
    try {
      console.error('WebSocket authentication failed:', data);

      // 断开连接
      this.disconnect();

      // 触发认证错误事件
      eventBus.emit('Socket::AuthError', data);

      // 可以在这里触发重新登录流程
      // 例如：显示登录弹窗或重定向到登录页面

    } catch (error) {
      console.error('Error handling WebSocket auth error:', error);
    }
  }

  /**
   * 处理速率限制错误
   */
  private async handleRateLimitError(data: any) {
    try {
      console.error('WebSocket rate limit exceeded:', data);

      // 断开连接
      this.disconnect();

      // 触发速率限制错误事件
      eventBus.emit('Socket::RateLimitError', data);

      // 可以在这里显示用户友好的错误消息

    } catch (error) {
      console.error('Error handling WebSocket rate limit error:', error);
    }
  }
}

// 获取WebSocket服务器URL的安全函数
function getWebSocketServerUrl(): string {
  // 服务端渲染时返回空字符串
  if (typeof window === 'undefined') {
    return '';
  }

  // 直连架构: 前端直接连接Python WebSocket服务
  if (process.env.NODE_ENV === 'development') {
    return 'http://127.0.0.1:52178';
  }

  return getSiteConfig().websocketUrl;
}

export const socketManager = new SocketIOManager({
  serverUrl: getWebSocketServerUrl(),
  autoConnect: false, // 禁用自动连接，由SocketProvider控制
})
