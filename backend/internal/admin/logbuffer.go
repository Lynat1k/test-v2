package admin

import (
	"sync"
)

const defaultLogBufferCap = 200

type LogBuffer struct {
	mu    sync.RWMutex
	lines []string
	cap   int
}

func NewLogBuffer(cap int) *LogBuffer {
	if cap <= 0 {
		cap = defaultLogBufferCap
	}
	return &LogBuffer{
		lines: make([]string, 0, cap),
		cap:   cap,
	}
}

func (b *LogBuffer) Write(p []byte) (int, error) {
	line := string(p)
	b.mu.Lock()
	defer b.mu.Unlock()

	if len(b.lines) >= b.cap {
		copy(b.lines, b.lines[1:])
		b.lines[len(b.lines)-1] = line
	} else {
		b.lines = append(b.lines, line)
	}
	return len(p), nil
}

func (b *LogBuffer) GetLogs() []string {
	b.mu.RLock()
	defer b.mu.RUnlock()

	out := make([]string, len(b.lines))
	copy(out, b.lines)
	return out
}

func (b *LogBuffer) Len() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.lines)
}
