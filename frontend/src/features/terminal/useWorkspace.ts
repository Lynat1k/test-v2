import { useState, useCallback, useRef } from 'react'

type WorkspaceLayout = '1' | '2h' | '2v'

export function useWorkspace() {
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayout>('1')
  const [activeChartIndex, setActiveChartIndex] = useState<0 | 1>(0)
  const [resizeRatio, setResizeRatio] = useState(50)
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false)
  const splitterRef = useRef<HTMLDivElement>(null)

  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startRatio = resizeRatio
    const container = splitterRef.current?.parentElement
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    const isHorizontal = workspaceLayout === '2h'

    const handleMove = (moveEvent: MouseEvent) => {
      if (isHorizontal) {
        const delta = moveEvent.clientX - startX
        const newRatio = Math.min(85, Math.max(15, startRatio + (delta / containerRect.width) * 100))
        setResizeRatio(newRatio)
      } else {
        const delta = moveEvent.clientY - startY
        const newRatio = Math.min(85, Math.max(15, startRatio + (delta / containerRect.height) * 100))
        setResizeRatio(newRatio)
      }
    }

    let startY = e.clientY

    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [resizeRatio, workspaceLayout])

  const handleSplitterTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    const startX = e.touches[0]!.clientX
    const startY = e.touches[0]!.clientY
    const startRatio = resizeRatio
    const container = splitterRef.current?.parentElement
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    const isHorizontal = workspaceLayout === '2h'

    const handleMove = (moveEvent: TouchEvent) => {
      if (isHorizontal) {
        const delta = moveEvent.touches[0]!.clientX - startX
        const newRatio = Math.min(85, Math.max(15, startRatio + (delta / containerRect.width) * 100))
        setResizeRatio(newRatio)
      } else {
        const delta = moveEvent.touches[0]!.clientY - startY
        const newRatio = Math.min(85, Math.max(15, startRatio + (delta / containerRect.height) * 100))
        setResizeRatio(newRatio)
      }
    }

    const handleEnd = () => {
      document.removeEventListener('touchmove', handleMove)
      document.removeEventListener('touchend', handleEnd)
    }

    document.addEventListener('touchmove', handleMove)
    document.addEventListener('touchend', handleEnd)
  }, [resizeRatio, workspaceLayout])

  return {
    workspaceLayout, setWorkspaceLayout,
    activeChartIndex, setActiveChartIndex,
    resizeRatio, setResizeRatio,
    showWorkspaceMenu, setShowWorkspaceMenu,
    splitterRef,
    handleSplitterMouseDown,
    handleSplitterTouchStart,
  }
}
