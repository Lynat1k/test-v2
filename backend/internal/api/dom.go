package api

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/procluster/procluster/internal/fng"
)

type FNGResponse struct {
	OK   bool         `json:"ok"`
	Data *fng.FNGData `json:"data"`
}

func (s *Server) handleFNG(w http.ResponseWriter, r *http.Request) {
	data, err := s.fngFetcher.GetCached(r.Context())
	if err != nil {
		data, err = s.fngFetcher.Fetch(r.Context())
		if err != nil {
			sendJSON(w, http.StatusOK, map[string]interface{}{
				"ok":    false,
				"error": map[string]string{"code": "FNG_UNAVAILABLE", "message": "Fear & Greed index unavailable"},
			})
			return
		}
	}

	sendJSON(w, http.StatusOK, FNGResponse{OK: true, Data: data})
}

func sendJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func (s *Server) handleDOMSubscribe(c *Client, msg WSMessage) {
	if msg.Symbol == "" || msg.Market == "" {
		s.sendWSError(c, "symbol and market are required for dom_subscribe")
		return
	}

	channelKey := "dom:" + msg.Symbol + ":" + msg.Market

	if c.domSubscribed != "" {
		c.hub.Unsubscribe(c, c.domSubscribed)
	}

	c.domSubscribed = channelKey
	c.hub.Subscribe(c, channelKey)

	log.Printf("[ws] client %s subscribed to DOM %s", c.id, channelKey)
}

func (s *Server) handleDOMUnsubscribe(c *Client) {
	if c.domSubscribed != "" {
		c.hub.Unsubscribe(c, c.domSubscribed)
		c.domSubscribed = ""
	}
}
