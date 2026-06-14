package auth

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite error: %v", err)
	}
	if err := Migrate(db); err != nil {
		t.Fatalf("Migrate error: %v", err)
	}
	return db
}

func TestMigrations(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('users', 'sessions', 'email_verifications')`).Scan(&count)
	if err != nil {
		t.Fatalf("query tables: %v", err)
	}
	if count != 3 {
		t.Errorf("expected 3 tables, got %d", count)
	}
}

func TestCreateAndGetUser(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	user := &User{
		Email:         "test@example.com",
		Nickname:      "TestUser",
		PasswordHash:  "$argon2id$v=19$m=65536,t=3,p=1$0000000000000000$00000000000000000000000000000000",
		Role:          "Free",
		EmailVerified: false,
	}

	err := CreateUser(ctx, db, user)
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}
	if user.ID == "" {
		t.Error("user ID should be set after creation")
	}

	fetched, err := GetUserByEmail(ctx, db, "test@example.com")
	if err != nil {
		t.Fatalf("GetUserByEmail error: %v", err)
	}
	if fetched.ID != user.ID {
		t.Errorf("expected ID %s, got %s", user.ID, fetched.ID)
	}
	if fetched.Email != "test@example.com" {
		t.Errorf("expected email test@example.com, got %s", fetched.Email)
	}
	if fetched.EmailVerified {
		t.Error("email should not be verified")
	}
}

func TestGetUserByEmailNotFound(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	_, err := GetUserByEmail(context.Background(), db, "nonexistent@example.com")
	if err != sql.ErrNoRows {
		t.Errorf("expected ErrNoRows, got %v", err)
	}
}

func TestSetEmailVerified(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	user := &User{
		Email:        "verify@example.com",
		Nickname:     "VerifyUser",
		PasswordHash: "$argon2id$v=19$m=65536,t=3,p=1$0000000000000000$00000000000000000000000000000000",
		Role:         "Free",
	}
	CreateUser(ctx, db, user)

	SetEmailVerified(ctx, db, user.ID)

	fetched, _ := GetUserByID(ctx, db, user.ID)
	if !fetched.EmailVerified {
		t.Error("email should be verified after SetEmailVerified")
	}
}

func TestSessionCRUD(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	user := &User{
		Email:        "session@example.com",
		Nickname:     "SessionUser",
		PasswordHash: "$argon2id$v=19$m=65536,t=3,p=1$0000000000000000$00000000000000000000000000000000",
		Role:         "Free",
	}
	CreateUser(ctx, db, user)

	session := &Session{
		UserID:           user.ID,
		RefreshTokenHash: "hash123",
		UserAgent:        "test-agent",
		IP:               "127.0.0.1",
		ExpiresAt:        time.Now().Add(24 * time.Hour),
	}

	err := CreateSession(ctx, db, session)
	if err != nil {
		t.Fatalf("CreateSession error: %v", err)
	}
	if session.ID == "" {
		t.Error("session ID should be set")
	}

	fetched, err := GetSessionByRefreshHash(ctx, db, "hash123")
	if err != nil {
		t.Fatalf("GetSessionByRefreshHash error: %v", err)
	}
	if fetched.UserID != user.ID {
		t.Errorf("expected user ID %s, got %s", user.ID, fetched.UserID)
	}

	DeleteSession(ctx, db, session.ID)
	_, err = GetSessionByRefreshHash(ctx, db, "hash123")
	if err != sql.ErrNoRows {
		t.Error("session should be deleted")
	}
}

func TestDeleteAllUserSessions(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	user := &User{
		Email:        "multi@example.com",
		Nickname:     "MultiUser",
		PasswordHash: "$argon2id$v=19$m=65536,t=3,p=1$0000000000000000$00000000000000000000000000000000",
		Role:         "Free",
	}
	CreateUser(ctx, db, user)

	for i := 0; i < 3; i++ {
		s := &Session{
			UserID:           user.ID,
			RefreshTokenHash: "hash" + string(rune('0'+i)),
			ExpiresAt:        time.Now().Add(24 * time.Hour),
		}
		CreateSession(ctx, db, s)
	}

	DeleteAllUserSessions(ctx, db, user.ID)

	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = ?`, user.ID).Scan(&count)
	if err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 sessions, got %d", count)
	}
}

func TestEmailVerificationCRUD(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	user := &User{
		Email:        "ev@example.com",
		Nickname:     "EVUser",
		PasswordHash: "$argon2id$v=19$m=65536,t=3,p=1$0000000000000000$00000000000000000000000000000000",
		Role:         "Free",
	}
	CreateUser(ctx, db, user)

	ev := &EmailVerification{
		UserID:    user.ID,
		Email:     user.Email,
		ExpiresAt: time.Now().Add(24 * time.Hour),
	}
	err := CreateEmailVerification(ctx, db, ev)
	if err != nil {
		t.Fatalf("CreateEmailVerification error: %v", err)
	}

	fetched, err := GetEmailVerification(ctx, db, ev.ID)
	if err != nil {
		t.Fatalf("GetEmailVerification error: %v", err)
	}
	if fetched.Used {
		t.Error("verification should not be used")
	}

	UseEmailVerification(ctx, db, ev.ID)
	fetched, _ = GetEmailVerification(ctx, db, ev.ID)
	if !fetched.Used {
		t.Error("verification should be used after UseEmailVerification")
	}
}
