import { ExcalidrawImageElement } from '@excalidraw/excalidraw/element/types'

export interface ImageBounds {
  x: number
  y: number
  width: number
  height: number
  id?: string
}

export interface CanvasSize {
  width: number
  height: number
}

export interface MagneticPosition {
  x: number
  y: number
  snapDirection?: 'left' | 'right' | 'top' | 'bottom' | 'center'
  targetImageId?: string
}

const DEFAULT_GAP = 20
const CANVAS_CENTER_X = 400 // 默认画布中心X
const CANVAS_CENTER_Y = 300 // 默认画布中心Y

/**
 * 计算图片的磁吸位置
 */
export function calculateMagneticPosition(
  newImage: Omit<ImageBounds, 'id'>,
  existingImages: ImageBounds[],
  canvasSize?: CanvasSize,
  gap: number = DEFAULT_GAP
): MagneticPosition {
  // 如果没有现有图片，放在画布中央
  if (existingImages.length === 0) {
    const centerX = canvasSize?.width ? canvasSize.width / 2 - newImage.width / 2 : CANVAS_CENTER_X
    const centerY = canvasSize?.height ? canvasSize.height / 2 - newImage.height / 2 : CANVAS_CENTER_Y
    return {
      x: centerX,
      y: centerY,
      snapDirection: 'center'
    }
  }

  // 找到最后添加的图片（通常是最右边的）
  const lastImage = existingImages[existingImages.length - 1]
  
  // 计算可能的吸附位置
  const possiblePositions: Array<MagneticPosition & { distance: number }> = []

  existingImages.forEach(image => {
    // 右侧吸附
    const rightPos = {
      x: image.x + image.width + gap,
      y: image.y,
      snapDirection: 'right' as const,
      targetImageId: image.id
    }
    
    // 左侧吸附
    const leftPos = {
      x: image.x - newImage.width - gap,
      y: image.y,
      snapDirection: 'left' as const,
      targetImageId: image.id
    }
    
    // 下方吸附
    const bottomPos = {
      x: image.x,
      y: image.y + image.height + gap,
      snapDirection: 'bottom' as const,
      targetImageId: image.id
    }
    
    // 上方吸附
    const topPos = {
      x: image.x,
      y: image.y - newImage.height - gap,
      snapDirection: 'top' as const,
      targetImageId: image.id
    }

    // 计算距离（如果newImage有当前位置的话）
    const currentX = newImage.x || lastImage.x + lastImage.width + gap
    const currentY = newImage.y || lastImage.y
    
    const positions = [rightPos, leftPos, bottomPos, topPos]
    positions.forEach(pos => {
      // 检查是否与其他图片重叠
      if (!isPositionValid(pos, newImage, existingImages)) {
        return
      }
      
      const distance = Math.sqrt(
        Math.pow(pos.x - currentX, 2) + Math.pow(pos.y - currentY, 2)
      )
      
      possiblePositions.push({
        ...pos,
        distance
      })
    })
  })

  // 如果没有有效位置，默认放在最后一张图片的右侧
  if (possiblePositions.length === 0) {
    return {
      x: lastImage.x + lastImage.width + gap,
      y: lastImage.y,
      snapDirection: 'right',
      targetImageId: lastImage.id
    }
  }

  // 优先选择右侧吸附，其次是距离最近的
  const rightSnapPositions = possiblePositions.filter(p => p.snapDirection === 'right')
  if (rightSnapPositions.length > 0) {
    // 选择最近的右侧位置
    rightSnapPositions.sort((a, b) => a.distance - b.distance)
    return rightSnapPositions[0]
  }

  // 选择距离最近的位置
  possiblePositions.sort((a, b) => a.distance - b.distance)
  return possiblePositions[0]
}

/**
 * 检查位置是否有效（不与其他图片重叠）
 */
function isPositionValid(
  position: { x: number; y: number },
  newImage: Omit<ImageBounds, 'id'>,
  existingImages: ImageBounds[]
): boolean {
  const newBounds = {
    x: position.x,
    y: position.y,
    width: newImage.width,
    height: newImage.height
  }

  return !existingImages.some(image => 
    isOverlapping(newBounds, image)
  )
}

/**
 * 检查两个矩形是否重叠
 */
function isOverlapping(rect1: ImageBounds, rect2: ImageBounds): boolean {
  return !(
    rect1.x + rect1.width <= rect2.x ||
    rect2.x + rect2.width <= rect1.x ||
    rect1.y + rect1.height <= rect2.y ||
    rect2.y + rect2.height <= rect1.y
  )
}

/**
 * 应用磁吸到图片元素
 */
export function applyMagneticSnap(
  imageElement: ExcalidrawImageElement,
  existingImages: ImageBounds[],
  canvasSize?: CanvasSize,
  gap: number = DEFAULT_GAP
): ExcalidrawImageElement {
  const newImage = {
    x: imageElement.x,
    y: imageElement.y,
    width: imageElement.width,
    height: imageElement.height
  }

  const magneticPos = calculateMagneticPosition(newImage, existingImages, canvasSize, gap)
  
  return {
    ...imageElement,
    x: magneticPos.x,
    y: magneticPos.y
  }
}

/**
 * 重新排列所有图片，消除空隙
 */
export function applyDragMagneticSnap(
  allImageElements: ExcalidrawImageElement[],
  gap: number = DEFAULT_GAP
): ExcalidrawImageElement[] {
  console.log('🔥 applyDragMagneticSnap called with:', allImageElements.map(img => ({ id: img.id, x: img.x })))

  if (allImageElements.length <= 1) {
    return allImageElements
  }

  // 按X坐标排序
  const sortedImages = [...allImageElements].sort((a, b) => a.x - b.x)
  console.log('🔥 sorted images:', sortedImages.map(img => ({ id: img.id, x: img.x })))

  // 重新排列，从第一张图片的位置开始
  const startX = sortedImages[0].x
  const commonY = sortedImages[0].y

  const rearrangedImages: ExcalidrawImageElement[] = []
  let currentX = startX

  sortedImages.forEach((img) => {
    rearrangedImages.push({
      ...img,
      x: currentX,
      y: commonY
    })
    console.log(`🔥 image ${img.id} positioned at x=${currentX}`)
    currentX += img.width + gap
  })

  console.log('🔥 final rearranged images:', rearrangedImages.map(img => ({ id: img.id, x: img.x })))
  return rearrangedImages
}

/**
 * 验证并调整历史数据的磁吸布局
 */
export function validateAndAdjustMagneticLayout(
  images: ExcalidrawImageElement[],
  canvasSize?: CanvasSize,
  gap: number = DEFAULT_GAP
): ExcalidrawImageElement[] {
  if (images.length <= 1) {
    return images
  }

  const adjustedImages: ExcalidrawImageElement[] = []

  images.forEach((image, index) => {
    if (index === 0) {
      // 第一张图片保持原位置或放在中央
      if (images.length === 1) {
        const centerX = canvasSize?.width ? canvasSize.width / 2 - image.width / 2 : CANVAS_CENTER_X
        const centerY = canvasSize?.height ? canvasSize.height / 2 - image.height / 2 : CANVAS_CENTER_Y
        adjustedImages.push({
          ...image,
          x: centerX,
          y: centerY
        })
      } else {
        adjustedImages.push(image)
      }
    } else {
      // 后续图片应用磁吸
      const existingBounds = adjustedImages.map(img => ({
        x: img.x,
        y: img.y,
        width: img.width,
        height: img.height,
        id: img.id
      }))

      const adjustedImage = applyMagneticSnap(image, existingBounds, canvasSize, gap)
      adjustedImages.push(adjustedImage)
    }
  })

  return adjustedImages
}

/**
 * 检查图片是否需要磁吸调整
 */
export function needsMagneticAdjustment(
  image: ExcalidrawImageElement,
  existingImages: ImageBounds[],
  gap: number = DEFAULT_GAP,
  tolerance: number = 5
): boolean {
  if (existingImages.length === 0) {
    return false
  }

  const currentBounds = {
    x: image.x,
    y: image.y,
    width: image.width,
    height: image.height
  }

  const idealPosition = calculateMagneticPosition(currentBounds, existingImages, undefined, gap)
  
  const distance = Math.sqrt(
    Math.pow(image.x - idealPosition.x, 2) + Math.pow(image.y - idealPosition.y, 2)
  )

  return distance > tolerance
}
