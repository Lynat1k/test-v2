package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/procluster/procluster/internal/auth"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Hub struct {
	clients    map[string]*Client
	channels   map[string]map[*Client]struct{}
	register   chan *Client
	unregister chan *Client
	broadcast  chan *ChannelMessage
	mu         sync.RWMutex
	done       chan struct{}
}

type Client struct {
	id            string
	userId        string
	userRole      string
	sessionID     string
	conn          *websocket.Conn
	hub           *Hub
	send          chan []byte
	subscribed    string
	domSubscribed string
	sessionActive bool
	mu            sync.Mutex
}

type ChannelMessage struct {
	ChannelKey string
	Data       []byte
}

type WSMessage struct {
	Type      string `json:"type"`
	Symbol    string `json:"symbol,omitempty"`
	Market    string `json:"market,omitempty"`
	Timeframe string `json:"timeframe,omitempty"`
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[string]*Client),
		channels:   make(map[string]map[*Client]struct{}),
		register:   make(chan *Client, 64),
		unregister: make(chan *Client, 64),
		broadcast:  make(chan *ChannelMessage, 256),
		done:       make(chan struct{}),
	}
}

func (h *Hub) Run(ctx context.Context) {
	defer close(h.done)

	for {
		select {
		case <-ctx.Done():
			h.mu.Lock()
			for _, client := range h.clients {
				close(client.send)
			}
			h.clients = make(map[string]*Client)
			h.channels = make(map[string]map[*Client]struct{})
			h.mu.Unlock()
			return

		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.id] = client
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.id]; ok {
				close(client.send)
				delete(h.clients, client.id)
				for ch, set := range h.channels {
					delete(set, client)
					if len(set) == 0 {
						delete(h.channels, ch)
					}
				}
			}
			h.mu.Unlock()

		case msg := <-h.broadcast:
			h.mu.RLock()
			subscribers := h.channels[msg.ChannelKey]
			for client := range subscribers {
				select {
				case client.send <- msg.Data:
				default:
					go func(c *Client) {
						h.unregister <- c
					}(client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) Register(client *Client) {
	h.register <- client
}

func (h *Hub) Unregister(client *Client) {
	h.unregister <- client
}

func (h *Hub) Subscribe(client *Client, channelKey string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.channels[channelKey] == nil {
		h.channels[channelKey] = make(map[*Client]struct{})
	}
	h.channels[channelKey][client] = struct{}{}
}

func (h *Hub) Unsubscribe(client *Client, channelKey string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if set, ok := h.channels[channelKey]; ok {
		delete(set, client)
		if len(set) == 0 {
			delete(h.channels, channelKey)
		}
	}
}

func (h *Hub) Broadcast(channelKey string, data []byte) {
	select {
	case h.broadcast <- &ChannelMessage{ChannelKey: channelKey, Data: data}:
	default:
		log.Printf("[hub] broadcast channel full, dropping message for %s", channelKey)
	}
}

func (h *Hub) Shutdown() {
	h.mu.Lock()
	for _, client := range h.clients {
		close(client.send)
	}
	h.clients = make(map[string]*Client)
	h.channels = make(map[string]map[*Client]struct{})
	h.mu.Unlock()
}

func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[ws] upgrade error: %v", err)
		return
	}

	userID, role := s.extractUserID(r)

	client := &Client{
		id:       generateID(),
		userId:   userID,
		userRole: role,
		conn:     conn,
		hub:      s.hub,
		send:     make(chan []byte, 256),
	}

	s.hub.Register(client)

	go client.writePump()
	go client.readPump(s)
}

func (c *Client) readPump(s *Server) {
	defer func() {
		if c.sessionID != "" && c.userId != "" {
			s.sessionManager.RemoveSession(context.Background(), c.userId, c.sessionID)
		}
		c.hub.Unregister(c)
		c.conn.Close()
	}()

	c.conn.SetReadLimit(4096)
	c.conn.SetReadDeadline(readDeadline())
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(readDeadline())
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		s.handleWSMessage(c, message)
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			c.conn.WriteMessage(websocket.TextMessage, message)

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (s *Server) handleWSMessage(c *Client, raw []byte) {
	var msg WSMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		s.sendWSError(c, "invalid message format")
		return
	}

	switch msg.Type {
	case "chart_subscribe":
		s.handleChartSubscribe(c, msg)
	case "heartbeat":
		s.handleHeartbeat(c)
	case "chart_unsubscribe":
		s.handleChartUnsubscribe(c)
	case "dom_subscribe":
		s.handleDOMSubscribe(c, msg)
	case "dom_unsubscribe":
		s.handleDOMUnsubscribe(c)
	default:
		s.sendWSError(c, "unknown message type: "+msg.Type)
	}
}

func (s *Server) handleChartSubscribe(c *Client, msg WSMessage) {
	if msg.Symbol == "" || msg.Market == "" || msg.Timeframe == "" {
		s.sendWSError(c, "symbol, market, timeframe are required")
		return
	}

	if c.subscribed != "" {
		c.hub.Unsubscribe(c, c.subscribed)
	}

	channelKey := buildChannelKey(msg.Symbol, msg.Market, msg.Timeframe)

	result, err := s.sessionManager.RegisterSession(
		context.Background(),
		c.userId,
		c.userRole,
		c.sessionID,
	)
	if err != nil {
		log.Printf("[ws] session register error: %v", err)
		s.sendWSError(c, "session error")
		return
	}

	c.sessionID = result.SessionID

	if !result.Accepted {
		s.sendWSJSON(c, SessionRejectedMsg{
			Type:    "session_rejected",
			Reason:  "limit",
			Message: "Превышен лимит тарифа",
		})
		return
	}

	if result.EvictedID != "" {
		s.hub.mu.RLock()
		for _, client := range s.hub.clients {
			if client.sessionID == result.EvictedID {
				client.sessionActive = false
				s.hub.Unsubscribe(client, client.subscribed)
				client.subscribed = ""
				s.sendWSJSON(client, SessionEvictedMsg{
					Type:    "session_evicted",
					Reason:  "limit",
					Message: "График открыт в другом окне",
				})
				break
			}
		}
		s.hub.mu.RUnlock()
	}

	c.subscribed = channelKey
	c.sessionActive = true
	c.hub.Subscribe(c, channelKey)

	s.sendWSJSON(c, SessionActiveMsg{
		Type:      "session_active",
		SessionID: result.SessionID,
	})
}

func (s *Server) handleHeartbeat(c *Client) {
	if c.sessionID == "" || c.userId == "" {
		return
	}

	ok := s.sessionManager.Heartbeat(context.Background(), c.userId, c.sessionID)
	if !ok {
		c.sessionActive = false
		if c.subscribed != "" {
			s.hub.Unsubscribe(c, c.subscribed)
			c.subscribed = ""
		}
		s.sendWSJSON(c, SessionEvictedMsg{
			Type:    "session_evicted",
			Reason:  "expired",
			Message: "Сессия истекла",
		})
	}
}

func (s *Server) handleChartUnsubscribe(c *Client) {
	if c.subscribed != "" {
		s.hub.Unsubscribe(c, c.subscribed)
		c.subscribed = ""
	}
	if c.sessionID != "" && c.userId != "" {
		s.sessionManager.RemoveSession(context.Background(), c.userId, c.sessionID)
		c.sessionID = ""
	}
	c.sessionActive = false
}

type SessionActiveMsg struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
}

type SessionEvictedMsg struct {
	Type    string `json:"type"`
	Reason  string `json:"reason"`
	Message string `json:"message"`
}

type SessionRejectedMsg struct {
	Type    string `json:"type"`
	Reason  string `json:"reason"`
	Message string `json:"message"`
}

func (s *Server) sendWSJSON(c *Client, v interface{}) {
	data, err := json.Marshal(v)
	if err != nil {
		log.Printf("[ws] marshal error: %v", err)
		return
	}
	select {
	case c.send <- data:
	default:
	}
}

func (s *Server) sendWSError(c *Client, message string) {
	s.sendWSJSON(c, map[string]string{
		"type":    "error",
		"message": message,
	})
}

func readDeadline() time.Time {
	return time.Now().Add(60 * time.Second)
}

func generateID() string {
	return "client-" + time.Now().Format("20060102150405.000000000")
}

func (s *Server) extractUserID(r *http.Request) (string, string) {
	userID, role, err := auth.ExtractUserFromRequest(s.authCfg, r)
	if err != nil {
		ip := r.Header.Get("X-Forwarded-For")
		if ip == "" {
			ip = r.Header.Get("X-Real-IP")
		}
		if ip == "" {
			ip = r.RemoteAddr
		}
		return "guest:" + ip, "guest"
	}
	return userID, role
}
