package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	argon2Memory  = 64 * 1024
	argon2Time    = 3
	argon2Threads = 1
	argon2SaltLen = 16
	argon2KeyLen  = 32
)

func HashPassword(password string) (string, error) {
	salt := make([]byte, argon2SaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}

	hash := argon2.IDKey([]byte(password), salt, argon2Time, argon2Memory, argon2Threads, argon2KeyLen)

	encoded := fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argon2Memory, argon2Time, argon2Threads,
		hex.EncodeToString(salt), hex.EncodeToString(hash))

	return encoded, nil
}

func CheckPassword(encodedHash, password string) bool {
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 {
		return false
	}

	var mem, t, p int
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &mem, &t, &p); err != nil {
		return false
	}

	salt, err := hex.DecodeString(parts[4])
	if err != nil {
		return false
	}

	expectedHash, err := hex.DecodeString(parts[5])
	if err != nil {
		return false
	}

	hash := argon2.IDKey([]byte(password), salt, uint32(t), uint32(mem), uint8(p), uint32(len(expectedHash)))
	return sha256.Sum256(hash) == sha256.Sum256(expectedHash)
}

func HashRefreshToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

func GenerateRefreshToken() (string, error) {
	b := make([]byte, 64)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate refresh token: %w", err)
	}
	return hex.EncodeToString(b), nil
}
