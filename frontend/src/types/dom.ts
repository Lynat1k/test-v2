export interface DOMLevel {
  priceLevel: number
  bidSize: number
  askSize: number
}

export interface FNGData {
  value: string
  classification: string
  timestamp: number
}

export interface LiveDOMData {
  lastPrice: number
  levels: DOMLevel[]
}

export interface DOMUpdateMessage {
  type: 'dom_update'
  symbol: string
  market: string
  data: LiveDOMData
}
