import { useState, useEffect, useRef } from 'react'
import type { DOMLevel, FNGData } from '@/types/dom'

interface UseDOMOptions {
  symbol: string
  market: string
}

interface UseDOMResult {
  levels: DOMLevel[]
  lastPrice: number
  fng: FNGData | null
  connected: boolean
}

export function useDOM({ symbol, market }: UseDOMOptions): UseDOMResult {
  const [levels, setLevels] = useState<DOMLevel[]>([])
  const [lastPrice, setLastPrice] = useState(0)
  const [fng, setFng] = useState<FNGData | null>(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'dom_subscribe', symbol, market }))
      setConnected(true)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'dom_update' && msg.data) {
          setLevels(msg.data.levels || [])
          setLastPrice(msg.data.lastPrice || 0)
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => setConnected(false)
    ws.onerror = () => setConnected(false)

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'dom_unsubscribe' }))
      }
      ws.close()
      wsRef.current = null
    }
  }, [symbol, market])

  useEffect(() => {
    const fetchFNG = async () => {
      try {
        const resp = await fetch('/api/v1/fng')
        const json = await resp.json()
        if (json.ok && json.data) {
          setFng(json.data)
        }
      } catch {
        // ignore
      }
    }

    fetchFNG()
    const interval = setInterval(fetchFNG, 3600000)
    return () => clearInterval(interval)
  }, [])

  return { levels, lastPrice, fng, connected }
}
