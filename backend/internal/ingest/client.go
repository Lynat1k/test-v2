package ingest

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type WSClient struct {
	mu           sync.Mutex
	conn         *websocket.Conn
	url          string
	market       MarketType
	lastTradeID  int64
	reconnectSec int
	onMessage    func([]byte)
}

func NewWSClient(url string, market MarketType) *WSClient {
	return &WSClient{
		url:          url,
		market:       market,
		reconnectSec: 1,
	}
}

func (c *WSClient) SetOnMessage(fn func([]byte)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onMessage = fn
}

func (c *WSClient) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		if err := c.connect(ctx); err != nil {
			log.Printf("[ingest] ws error: %v, reconnecting in %ds", err, c.reconnectSec)
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Duration(c.reconnectSec) * time.Second):
			}
			c.mu.Lock()
			c.reconnectSec = min(c.reconnectSec*2, 30)
			c.mu.Unlock()
			continue
		}

		c.mu.Lock()
		c.reconnectSec = 1
		c.mu.Unlock()
	}
}

func (c *WSClient) connect(ctx context.Context) error {
	dialer := websocket.DefaultDialer

	conn, _, err := dialer.DialContext(ctx, c.url, nil)
	if err != nil {
		return fmt.Errorf("ws dial: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	log.Printf("[ingest] connected to %s", c.url)

	defer func() {
		conn.Close()
		c.mu.Lock()
		c.conn = nil
		c.mu.Unlock()
	}()

	go c.pingLoop(ctx)

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		_, message, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("ws read: %w", err)
		}

		c.mu.Lock()
		fn := c.onMessage
		c.mu.Unlock()

		if fn != nil {
			fn(message)
		}
	}
}

func (c *WSClient) pingLoop(ctx context.Context) {
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.mu.Lock()
			conn := c.conn
			c.mu.Unlock()

			if conn != nil {
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}
}

func (c *WSClient) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		c.conn.Close()
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
