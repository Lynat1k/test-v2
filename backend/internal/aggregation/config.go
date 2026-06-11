package aggregation

type CompressionConfig struct {
	Symbol    string
	PriceTick float64
	BaseLevel float64
	MaxLevels int
}

func DefaultBTCFuturesConfig() CompressionConfig {
	return CompressionConfig{
		Symbol:    "BTCUSDT",
		PriceTick: 0.1,
		BaseLevel: 25,
		MaxLevels: 10,
	}
}

func DefaultBTCSpotConfig() CompressionConfig {
	return CompressionConfig{
		Symbol:    "BTCUSDT",
		PriceTick: 0.01,
		BaseLevel: 500,
		MaxLevels: 10,
	}
}
