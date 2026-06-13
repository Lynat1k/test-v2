import { useCallback, useRef, useEffect } from 'react'

interface SplitterProps {
  direction: 'horizontal' | 'vertical'
  onDrag: (delta: number) => void
  onDragEnd?: () => void
}

export function Splitter({ direction, onDrag, onDragEnd }: SplitterProps) {
  const draggingRef = useRef(false)
  const startRef = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    draggingRef.current = true
    startRef.current = direction === 'horizontal' ? e.clientX : e.clientY
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }, [direction])

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!draggingRef.current) return
      const current = direction === 'horizontal' ? e.clientX : e.clientY
      onDrag(current - startRef.current)
      startRef.current = current
    }

    function handleMouseUp() {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      onDragEnd?.()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [direction, onDrag, onDragEnd])

  const isHorizontal = direction === 'horizontal'

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`group relative flex items-center justify-center shrink-0 z-10 ${
        isHorizontal
          ? 'w-[5px] cursor-col-resize hover:bg-amber-500/30 active:bg-amber-500/50'
          : 'h-[5px] cursor-row-resize hover:bg-amber-500/30 active:bg-amber-500/50'
      }`}
      style={{
        background: 'rgba(255,255,255,0.06)',
      }}
    >
      <div className={`${
        isHorizontal
          ? 'w-px h-6 group-hover:h-8'
          : 'h-px w-6 group-hover:w-8'
      } rounded-full bg-white/20 group-hover:bg-amber-400/60 transition-all`} />
    </div>
  )
}
