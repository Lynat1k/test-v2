package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func GenerateAccessToken(cfg AuthConfig, userID, role string) (string, error) {
	now := time.Now()
	claims := &Claims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        uuid.New().String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(cfg.AccessTokenTTL)),
			Subject:   userID,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(cfg.JWTSecret)
	if err != nil {
		return "", fmt.Errorf("sign access token: %w", err)
	}
	return signed, nil
}

func ParseAccessToken(cfg AuthConfig, tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return cfg.JWTSecret, nil
	})
	if err != nil {
		return nil, fmt.Errorf("parse access token: %w", err)
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid access token")
	}

	return claims, nil
}
