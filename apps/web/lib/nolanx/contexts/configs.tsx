
import useConfigsStore from '@/lib/nolanx/stores/configs'
import { createContext, useContext } from 'react'

export const ConfigsContext = createContext<{
  configsStore: typeof useConfigsStore
  // refreshModels: () => void
} | null>(null)

export const ConfigsProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const configsStore = useConfigsStore()
  const { setTextModels, setImageModels, setTextModel, setImageModel } =
    configsStore
  // merge default models with the models from the server config to get the latest default models

  return (
    <ConfigsContext.Provider
      value={{ configsStore: useConfigsStore }}
    >
      {children}
    </ConfigsContext.Provider>
  )
}

export const useConfigs = () => {
  const context = useContext(ConfigsContext)
  if (!context) {
    throw new Error('useConfigs must be used within a ConfigsProvider')
  }
  return context.configsStore()
}
