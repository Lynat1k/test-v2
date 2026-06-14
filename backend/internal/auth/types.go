package auth

import (
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID string `json:"uid"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

type User struct {
	ID            string    `json:"id"`
	Email         string    `json:"email"`
	Nickname      string    `json:"nickname"`
	PasswordHash  string    `json:"-"`
	Role          string    `json:"role"`
	EmailVerified bool      `json:"emailVerified"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type Session struct {
	ID               string    `json:"id"`
	UserID           string    `json:"userId"`
	RefreshTokenHash string    `json:"-"`
	UserAgent        string    `json:"userAgent"`
	IP               string    `json:"ip"`
	CreatedAt        time.Time `json:"createdAt"`
	ExpiresAt        time.Time `json:"expiresAt"`
}

type EmailVerification struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Email     string    `json:"email"`
	ExpiresAt time.Time `json:"expiresAt"`
	Used      bool      `json:"used"`
	CreatedAt time.Time `json:"createdAt"`
}

type UserIDExtractor interface {
	Extract(r *http.Request) (userID string, role string, err error)
}
