import { useState, useEffect } from 'react'
import type { CryptoPair } from '@/types'
import { AVAILABLE_PAIRS } from '@/lib/data/dataGenerator'

type CandleType = 'auto' | 'japanese' | 'footprint' | 'clusters'
type CandleDataType = 'all' | 'delta' | 'imbalances' | 'volume'

const STORAGE_PREFIX = 'procluster_chart_config_'

interface ChartConfig {
  activePair?: string
  interval?: string
  marketType?: 'futures' | 'spot'
  candleType?: CandleType
  candleDataType?: CandleDataType
  compression?: number
}

function loadConfig(index: 0 | 1): ChartConfig {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${index}`)
    return stored ? JSON.parse(stored) as ChartConfig : {}
  } catch {
    return {}
  }
}

function saveConfig(index: 0 | 1, config: ChartConfig) {
  localStorage.setItem(`${STORAGE_PREFIX}${index}`, JSON.stringify(config))
}

export function useChartConfig() {
  const config0 = loadConfig(0)
  const config1 = loadConfig(1)

  const [activePair0, setActivePair0] = useState<CryptoPair>(
    () => AVAILABLE_PAIRS.find(p => p.symbol === config0.activePair) ?? AVAILABLE_PAIRS[0]!
  )
  const [activePair1, setActivePair1] = useState<CryptoPair>(
    () => AVAILABLE_PAIRS.find(p => p.symbol === config1.activePair) ?? AVAILABLE_PAIRS[0]!
  )
  const [interval0, setInterval0] = useState<string>(() => config0.interval ?? '1m')
  const [interval1, setInterval1] = useState<string>(() => config1.interval ?? '1m')
  const [marketType0, setMarketType0] = useState<'futures' | 'spot'>(() => config0.marketType ?? 'futures')
  const [marketType1, setMarketType1] = useState<'futures' | 'spot'>(() => config1.marketType ?? 'futures')
  const [candleType0, setCandleType0] = useState<CandleType>(() => config0.candleType ?? 'auto')
  const [candleType1, setCandleType1] = useState<CandleType>(() => config1.candleType ?? 'auto')
  const [candleDataType0, setCandleDataType0] = useState<CandleDataType>(() => config0.candleDataType ?? 'all')
  const [candleDataType1, setCandleDataType1] = useState<CandleDataType>(() => config1.candleDataType ?? 'all')
  const [compressionMultiplier0, setCompressionMultiplier0] = useState<number>(() => config0.compression ?? 50)
  const [compressionMultiplier1, setCompressionMultiplier1] = useState<number>(() => config1.compression ?? 50)

  useEffect(() => { saveConfig(0, { activePair: activePair0.symbol, interval: interval0, marketType: marketType0, candleType: candleType0, candleDataType: candleDataType0, compression: compressionMultiplier0 }) }, [activePair0, interval0, marketType0, candleType0, candleDataType0, compressionMultiplier0])
  useEffect(() => { saveConfig(1, { activePair: activePair1.symbol, interval: interval1, marketType: marketType1, candleType: candleType1, candleDataType: candleDataType1, compression: compressionMultiplier1 }) }, [activePair1, interval1, marketType1, candleType1, candleDataType1, compressionMultiplier1])

  const getActivePair = (idx: 0 | 1) => idx === 0 ? activePair0 : activePair1
  const setPair = (idx: 0 | 1, val: CryptoPair) => { if (idx === 0) setActivePair0(val); else setActivePair1(val) }
  const setInterval = (idx: 0 | 1, val: string) => { if (idx === 0) setInterval0(val); else setInterval1(val) }
  const setMarketType = (idx: 0 | 1, val: 'futures' | 'spot') => { if (idx === 0) setMarketType0(val); else setMarketType1(val) }
  const setCandleType = (idx: 0 | 1, val: CandleType) => { if (idx === 0) setCandleType0(val); else setCandleType1(val) }
  const setCandleDataType = (idx: 0 | 1, val: CandleDataType) => { if (idx === 0) setCandleDataType0(val); else setCandleDataType1(val) }
  const setCompressionMultiplier = (idx: 0 | 1, val: number) => { if (idx === 0) setCompressionMultiplier0(val); else setCompressionMultiplier1(val) }

  return {
    pairs: AVAILABLE_PAIRS,
    activePair0, activePair1, setActivePair0, setActivePair1,
    interval0, interval1,
    marketType0, marketType1,
    candleType0, candleType1,
    candleDataType0, candleDataType1,
    compressionMultiplier0, compressionMultiplier1,
    getActivePair, setPair, setInterval, setMarketType, setCandleType, setCandleDataType, setCompressionMultiplier,
  }
}
