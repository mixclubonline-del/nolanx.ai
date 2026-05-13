import { socketManager } from '@/lib/nolanx/utils/socket'
import React, { createContext, useEffect, useState } from 'react'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'

interface SocketContextType {
  connected: boolean
  socketId?: string
  connecting: boolean
  error?: string
}

const SocketContext = createContext<SocketContextType>({
  connected: false,
  connecting: false,
})

interface SocketProviderProps {
  children: React.ReactNode
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const { t } = useTranslation()
  const [connected, setConnected] = useState(false)
  const [socketId, setSocketId] = useState<string>()
  const [connecting, setConnecting] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    // 确保只在客户端运行
    if (typeof window === 'undefined') {
      return
    }

    let mounted = true

    const initializeSocket = async () => {
      try {
        setConnecting(true)
        setError(undefined)

        // 检查是否已经连接，避免重复连接
        if (socketManager.isConnected()) {
          if (mounted) {
            setConnected(true)
            setSocketId(socketManager.getSocketId())
            setConnecting(false)
            console.log('🔗 Socket.IO already connected, reusing connection')
          }
          return
        }

        await socketManager.connect()

        if (mounted) {
          setConnected(true)
          setSocketId(socketManager.getSocketId())
          setConnecting(false)
          console.log('🚀 Socket.IO initialized successfully')

          const socket = socketManager.getSocket()
          if (socket) {
            const handleConnect = () => {
              if (mounted) {
                setConnected(true)
                setSocketId(socketManager.getSocketId())
                setConnecting(false)
                setError(undefined)
              }
            }

            const handleDisconnect = () => {
              if (mounted) {
                setConnected(false)
                setSocketId(undefined)
                setConnecting(false)
              }
            }

            const handleConnectError = (error: Error) => {
              if (mounted) {
                setError(error.message || 'Connection error')
                setConnected(false)
                setConnecting(false)
              }
            }

            socket.on('connect', handleConnect)
            socket.on('disconnect', handleDisconnect)
            socket.on('connect_error', handleConnectError)

            return () => {
              socket.off('connect', handleConnect)
              socket.off('disconnect', handleDisconnect)
              socket.off('connect_error', handleConnectError)
            }
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setConnected(false)
          setConnecting(false)
          console.error('❌ Failed to initialize Socket.IO:', err)
        }
      }
    }

    initializeSocket()

    return () => {
      mounted = false
      // 组件卸载时断开socket连接
      console.log('🔌 SocketProvider unmounting, disconnecting socket')
      socketManager.disconnect()
    }
  }, [])

  useEffect(() => {
    console.log('📢 Notification manager initialized')
  }, [])

  const value: SocketContextType = {
    connected,
    socketId,
    connecting,
    error,
  }

  return (
    <SocketContext.Provider value={value}>
      {children}

      {error && (
        <div className="fixed top-4 right-4 z-50 bg-red-500 text-white px-3 py-2 rounded-md shadow-lg">
          {socketManager.isMaxReconnectAttemptsReached()
            ? t('socket.maxRetriesReached')
            : t('socket.connectionError', {
              current: socketManager.getReconnectAttempts(),
              max: 5,
              error
            })}
        </div>
      )}
    </SocketContext.Provider>
  )
}
