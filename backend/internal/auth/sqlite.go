package auth

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

func OpenSQLite(dsn string) (*sql.DB, error) {
	dir := filepath.Dir(dsn)
	if dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("create sqlite dir %s: %w", dir, err)
		}
	}

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=ON",
	} {
		if _, err := db.Exec(pragma); err != nil {
			db.Close()
			return nil, fmt.Errorf("set pragma: %w", err)
		}
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	return db, nil
}

func Migrate(db *sql.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			email TEXT UNIQUE NOT NULL,
			nickname TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'Free',
			email_verified INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			refresh_token_hash TEXT NOT NULL,
			user_agent TEXT NOT NULL DEFAULT '',
			ip TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			rotated INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_refresh_hash ON sessions(refresh_token_hash)`,
		`CREATE TABLE IF NOT EXISTS email_verifications (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			email TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			used INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(id, used)`,
		`CREATE TABLE IF NOT EXISTS user_settings (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			settings_json TEXT NOT NULL DEFAULT '{}',
			updated_at TEXT NOT NULL
		)`,
	}

	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("migration: %w", err)
		}
	}

	// Phase 10: idempotent ALTER TABLE for new columns
	profileCols := []struct {
		name string
		def  string
	}{
		{"avatar", "TEXT DEFAULT ''"},
		{"subscription_status", "TEXT DEFAULT 'none'"},
		{"subscription_paid_at", "TEXT DEFAULT ''"},
		{"subscription_expires_at", "TEXT DEFAULT ''"},
	}
	existingCols := make(map[string]bool)
	rows, err := db.Query("PRAGMA table_info(users)")
	if err != nil {
		return fmt.Errorf("migration pragma: %w", err)
	}
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull int
		var dfltValue interface{}
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dfltValue, &pk); err != nil {
			rows.Close()
			return fmt.Errorf("migration scan: %w", err)
		}
		existingCols[name] = true
	}
	rows.Close()

	for _, col := range profileCols {
		if !existingCols[col.name] {
			stmt := fmt.Sprintf("ALTER TABLE users ADD COLUMN %s %s", col.name, col.def)
			if _, err := db.Exec(stmt); err != nil {
				return fmt.Errorf("migration alter %s: %w", col.name, err)
			}
		}
	}

	// Phase 12: admin_actions table
	adminQueries := []string{
		`CREATE TABLE IF NOT EXISTS admin_actions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			action TEXT NOT NULL,
			target TEXT NOT NULL DEFAULT '',
			detail TEXT NOT NULL DEFAULT '',
			ip TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_admin_actions_user ON admin_actions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON admin_actions(created_at)`,
	}
	for _, q := range adminQueries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("migration admin_actions: %w", err)
		}
	}

	log.Println("[auth] sqlite migrations applied")
	return nil
}

// --- Users ---

func CreateUser(ctx context.Context, db *sql.DB, u *User) error {
	u.ID = uuid.New().String()
	now := time.Now().UTC()
	u.CreatedAt = now
	u.UpdatedAt = now

	_, err := db.ExecContext(ctx,
		`INSERT INTO users (id, email, nickname, password_hash, role, email_verified, created_at, updated_at, avatar, subscription_status, subscription_paid_at, subscription_expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		u.ID, u.Email, u.Nickname, u.PasswordHash, u.Role, boolToInt(u.EmailVerified),
		u.CreatedAt.Format(time.RFC3339), u.UpdatedAt.Format(time.RFC3339),
		u.Avatar, u.SubscriptionStatus, u.SubscriptionPaidAt, u.SubscriptionExpiresAt,
	)
	if err != nil {
		return fmt.Errorf("create user: %w", err)
	}
	return nil
}

func GetUserByEmail(ctx context.Context, db *sql.DB, email string) (*User, error) {
	row := db.QueryRowContext(ctx,
		`SELECT id, email, nickname, password_hash, role, email_verified, created_at, updated_at, avatar, subscription_status, subscription_paid_at, subscription_expires_at
		 FROM users WHERE email = ?`, email,
	)
	return scanUser(row)
}

func GetUserByID(ctx context.Context, db *sql.DB, id string) (*User, error) {
	row := db.QueryRowContext(ctx,
		`SELECT id, email, nickname, password_hash, role, email_verified, created_at, updated_at, avatar, subscription_status, subscription_paid_at, subscription_expires_at
		 FROM users WHERE id = ?`, id,
	)
	return scanUser(row)
}

func SetEmailVerified(ctx context.Context, db *sql.DB, userID string) error {
	_, err := db.ExecContext(ctx,
		`UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?`,
		time.Now().UTC().Format(time.RFC3339), userID,
	)
	return err
}

func scanUser(row *sql.Row) (*User, error) {
	u := &User{}
	var verified int
	var createdAt, updatedAt string
	var avatar, subStatus, subPaid, subExpires sql.NullString
	err := row.Scan(&u.ID, &u.Email, &u.Nickname, &u.PasswordHash, &u.Role, &verified, &createdAt, &updatedAt,
		&avatar, &subStatus, &subPaid, &subExpires)
	if err != nil {
		return nil, err
	}
	u.EmailVerified = verified == 1
	u.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	u.UpdatedAt, _ = time.Parse(time.RFC3339, updatedAt)
	u.Avatar = nullStr(avatar)
	u.SubscriptionStatus = nullStrDef(subStatus, "none")
	u.SubscriptionPaidAt = nullStr(subPaid)
	u.SubscriptionExpiresAt = nullStr(subExpires)
	return u, nil
}

func nullStr(n sql.NullString) string {
	if n.Valid {
		return n.String
	}
	return ""
}

func nullStrDef(n sql.NullString, def string) string {
	if n.Valid && n.String != "" {
		return n.String
	}
	return def
}

// --- Sessions ---

func CreateSession(ctx context.Context, db *sql.DB, s *Session) error {
	s.ID = uuid.New().String()
	now := time.Now().UTC()
	s.CreatedAt = now

	_, err := db.ExecContext(ctx,
		`INSERT INTO sessions (id, user_id, refresh_token_hash, user_agent, ip, created_at, expires_at, rotated)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
		s.ID, s.UserID, s.RefreshTokenHash, s.UserAgent, s.IP,
		s.CreatedAt.Format(time.RFC3339), s.ExpiresAt.Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	return nil
}

func GetSessionByRefreshHash(ctx context.Context, db *sql.DB, refreshTokenHash string) (*Session, error) {
	row := db.QueryRowContext(ctx,
		`SELECT id, user_id, refresh_token_hash, user_agent, ip, created_at, expires_at
		 FROM sessions WHERE refresh_token_hash = ? AND rotated = 0`, refreshTokenHash,
	)
	return scanSession(row)
}

func GetSessionByRefreshHashAny(ctx context.Context, db *sql.DB, refreshTokenHash string) (*Session, error) {
	row := db.QueryRowContext(ctx,
		`SELECT id, user_id, refresh_token_hash, user_agent, ip, created_at, expires_at
		 FROM sessions WHERE refresh_token_hash = ?`, refreshTokenHash,
	)
	return scanSession(row)
}

func MarkSessionRotated(ctx context.Context, db *sql.DB, sessionID string) error {
	_, err := db.ExecContext(ctx, `UPDATE sessions SET rotated = 1 WHERE id = ?`, sessionID)
	return err
}

func DeleteSession(ctx context.Context, db *sql.DB, sessionID string) error {
	_, err := db.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, sessionID)
	return err
}

func DeleteAllUserSessions(ctx context.Context, db *sql.DB, userID string) error {
	_, err := db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID)
	return err
}

func scanSession(row *sql.Row) (*Session, error) {
	s := &Session{}
	var createdAt, expiresAt string
	err := row.Scan(&s.ID, &s.UserID, &s.RefreshTokenHash, &s.UserAgent, &s.IP, &createdAt, &expiresAt)
	if err != nil {
		return nil, err
	}
	s.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	s.ExpiresAt, _ = time.Parse(time.RFC3339, expiresAt)
	return s, nil
}

// --- Email Verifications ---

func CreateEmailVerification(ctx context.Context, db *sql.DB, ev *EmailVerification) error {
	ev.ID = uuid.New().String()
	now := time.Now().UTC()
	ev.CreatedAt = now

	_, err := db.ExecContext(ctx,
		`INSERT INTO email_verifications (id, user_id, email, expires_at, used, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		ev.ID, ev.UserID, ev.Email,
		ev.ExpiresAt.Format(time.RFC3339), boolToInt(ev.Used),
		ev.CreatedAt.Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("create email verification: %w", err)
	}
	return nil
}

func GetEmailVerification(ctx context.Context, db *sql.DB, tokenID string) (*EmailVerification, error) {
	row := db.QueryRowContext(ctx,
		`SELECT id, user_id, email, expires_at, used, created_at
		 FROM email_verifications WHERE id = ?`, tokenID,
	)
	return scanEmailVerification(row)
}

func UseEmailVerification(ctx context.Context, db *sql.DB, tokenID string) error {
	_, err := db.ExecContext(ctx,
		`UPDATE email_verifications SET used = 1 WHERE id = ? AND used = 0`, tokenID,
	)
	return err
}

func scanEmailVerification(row *sql.Row) (*EmailVerification, error) {
	ev := &EmailVerification{}
	var expiresAt, createdAt string
	var used int
	err := row.Scan(&ev.ID, &ev.UserID, &ev.Email, &expiresAt, &used, &createdAt)
	if err != nil {
		return nil, err
	}
	ev.ExpiresAt, _ = time.Parse(time.RFC3339, expiresAt)
	ev.Used = used == 1
	ev.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	return ev, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// --- Profile updates (Phase 10) ---

func UpdateUserProfile(ctx context.Context, db *sql.DB, userID, nickname, avatar string) error {
	_, err := db.ExecContext(ctx,
		`UPDATE users SET nickname = ?, avatar = ?, updated_at = ? WHERE id = ?`,
		nickname, avatar, time.Now().UTC().Format(time.RFC3339), userID,
	)
	return err
}

func UpdateUserPasswordHash(ctx context.Context, db *sql.DB, userID, passwordHash string) error {
	_, err := db.ExecContext(ctx,
		`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
		passwordHash, time.Now().UTC().Format(time.RFC3339), userID,
	)
	return err
}
