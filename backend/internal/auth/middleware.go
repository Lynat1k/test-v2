package auth

import (
	"context"
	"net/http"
	"strings"
)

type contextKey string

const (
	UserIDKey contextKey = "user_id"
	RoleKey   contextKey = "role"
)

func RequireAuth(cfg AuthConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, role, err := ExtractUserFromRequest(cfg, r)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
				return
			}

			ctx := context.WithValue(r.Context(), UserIDKey, userID)
			ctx = context.WithValue(ctx, RoleKey, role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			role, ok := r.Context().Value(RoleKey).(string)
			if !ok {
				writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
				return
			}

			allowed := false
			for _, allowedRole := range roles {
				if role == allowedRole {
					allowed = true
					break
				}
			}
			if !allowed {
				writeError(w, http.StatusForbidden, "FORBIDDEN", "insufficient permissions")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func ExtractUserFromRequest(cfg AuthConfig, r *http.Request) (userID string, role string, err error) {
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
			claims, err := ParseAccessToken(cfg, parts[1])
			if err != nil {
				return "", "", err
			}
			return claims.UserID, claims.Role, nil
		}
	}

	if token := r.URL.Query().Get("token"); token != "" {
		claims, err := ParseAccessToken(cfg, token)
		if err != nil {
			return "", "", err
		}
		return claims.UserID, claims.Role, nil
	}

	return "", "", ErrNoToken
}

func BetaGate(cfg AuthConfig, betaEnabled func() bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !betaEnabled() {
				next.ServeHTTP(w, r)
				return
			}
			_, _, err := ExtractUserFromRequest(cfg, r)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

var ErrNoToken = &AuthError{"NO_TOKEN", "no access token provided"}

type AuthError struct {
	Code    string
	Message string
}

func (e *AuthError) Error() string {
	return e.Message
}
