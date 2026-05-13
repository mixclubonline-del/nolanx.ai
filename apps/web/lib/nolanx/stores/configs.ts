import type { Model } from '@/lib/nolanx/types/types'
import { create } from 'zustand'

type ConfigsStore = {
  initCanvas: boolean
  setInitCanvas: (initCanvas: boolean) => void

  textModels: Model[]
  imageModels: Model[]
  setTextModels: (models: Model[]) => void
  setImageModels: (models: Model[]) => void

  textModel?: Model
  imageModel?: Model
  setTextModel: (model?: Model) => void
  setImageModel: (model?: Model) => void

}

const useConfigsStore = create<ConfigsStore>((set) => ({
  initCanvas: false,
  setInitCanvas: (initCanvas) => set({ initCanvas }),

  textModels: [],
  imageModels: [],
  setTextModels: (models) => set({ textModels: models }),
  setImageModels: (models) => set({ imageModels: models }),

  textModel: undefined,
  imageModel: undefined,
  setTextModel: (model) => set({ textModel: model }),
  setImageModel: (model) => set({ imageModel: model }),

}))

export default useConfigsStore
