package api

import (
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/procluster/procluster/internal/auth"
	"github.com/redis/go-redis/v9"
)

func trackGuest(rdb *redis.Client, authCfg auth.AuthConfig, w http.ResponseWriter, r *http.Request) {
	_, _, err := auth.ExtractUserFromRequest(authCfg, r)
	if err == nil {
		return
	}

	anonID, err := r.Cookie("anon_id")
	var anonIDValue string
	if err != nil {
		anonIDValue = uuid.New().String()
		http.SetCookie(w, &http.Cookie{
			Name:     "anon_id",
			Value:    anonIDValue,
			Path:     "/",
			HttpOnly: true,
			MaxAge:   int(24 * time.Hour.Seconds()),
			SameSite: http.SameSiteLaxMode,
		})
	} else {
		anonIDValue = anonID.Value
	}

	if err := rdb.Set(r.Context(), "guest:online:"+anonIDValue, "1", 5*time.Minute).Err(); err != nil {
		log.Printf("[guest] redis set error: %v", err)
	}
}
