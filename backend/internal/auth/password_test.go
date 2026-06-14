package auth

import (
	"strings"
	"testing"
)

func TestHashPassword(t *testing.T) {
	hash, err := HashPassword("testpassword123")
	if err != nil {
		t.Fatalf("HashPassword error: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Errorf("hash should start with $argon2id$, got %s", hash)
	}
}

func TestCheckPasswordCorrect(t *testing.T) {
	hash, err := HashPassword("mypassword")
	if err != nil {
		t.Fatalf("HashPassword error: %v", err)
	}
	if !CheckPassword(hash, "mypassword") {
		t.Error("CheckPassword should return true for correct password")
	}
}

func TestCheckPasswordWrong(t *testing.T) {
	hash, err := HashPassword("mypassword")
	if err != nil {
		t.Fatalf("HashPassword error: %v", err)
	}
	if CheckPassword(hash, "wrongpassword") {
		t.Error("CheckPassword should return false for wrong password")
	}
}

func TestCheckPasswordInvalidHash(t *testing.T) {
	if CheckPassword("invalidhash", "password") {
		t.Error("CheckPassword should return false for invalid hash")
	}
}

func TestCheckPasswordDifferentHashes(t *testing.T) {
	hash1, _ := HashPassword("password")
	hash2, _ := HashPassword("password")
	if hash1 == hash2 {
		t.Error("different hashes should be produced for same password (different salts)")
	}
	if !CheckPassword(hash1, "password") || !CheckPassword(hash2, "password") {
		t.Error("both hashes should validate the same password")
	}
}

func TestHashRefreshToken(t *testing.T) {
	token := "abc123def456"
	hash1 := HashRefreshToken(token)
	hash2 := HashRefreshToken(token)
	if hash1 != hash2 {
		t.Error("same token should produce same hash")
	}
	if hash1 == token {
		t.Error("hash should not equal raw token")
	}
	if len(hash1) != 64 {
		t.Errorf("hash should be 64 hex chars, got %d", len(hash1))
	}
}

func TestGenerateRefreshToken(t *testing.T) {
	token1, err := GenerateRefreshToken()
	if err != nil {
		t.Fatalf("GenerateRefreshToken error: %v", err)
	}
	token2, err := GenerateRefreshToken()
	if err != nil {
		t.Fatalf("GenerateRefreshToken error: %v", err)
	}
	if token1 == token2 {
		t.Error("generated tokens should be unique")
	}
	if len(token1) != 128 {
		t.Errorf("token should be 128 hex chars, got %d", len(token1))
	}
}
