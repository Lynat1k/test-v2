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
      className={`group relative flex items-center justify-center shrink-0 z-10 transition-all duration-150 select-none ${
        isHorizontal
          ? 'w-2.5 hover:w-3 cursor-col-resize h-full mx-1'
          : 'h-2.5 hover:h-3 cursor-row-resize w-full my-1'
      }`}
    >
      <div className={`transition-colors duration-150 rounded-full ${
        isHorizontal
          ? 'w-[2px] h-3/4 group-hover:bg-yellow-500'
          : 'h-[2px] w-3/4 group-hover:bg-yellow-500'
      } bg-slate-800 animate-pulse`} />
      <div className={`absolute w-1.5 h-1.5 rounded-full transition-transform scale-0 group-hover:scale-100 bg-yellow-500`} />
    </div>
  )
}
