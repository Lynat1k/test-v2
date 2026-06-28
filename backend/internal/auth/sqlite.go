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
		{"last_login", "TEXT DEFAULT ''"},
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

	// Phase 12 Etapa 3: tickers, default_compressions, download_jobs tables
	etapa3Queries := []string{
		`CREATE TABLE IF NOT EXISTS tickers (
			id TEXT PRIMARY KEY,
			symbol TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			price_tick_spot REAL NOT NULL DEFAULT 0.01,
			price_tick_futures REAL NOT NULL DEFAULT 0.1,
			compression_spot INTEGER NOT NULL DEFAULT 500,
			compression_futures INTEGER NOT NULL DEFAULT 25,
			is_active INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS default_compressions (
			id TEXT PRIMARY KEY,
			symbol TEXT NOT NULL,
			market TEXT NOT NULL,
			timeframe TEXT NOT NULL,
			multiplier INTEGER NOT NULL,
			updated_at TEXT NOT NULL,
			UNIQUE(symbol, market, timeframe)
		)`,
		`CREATE TABLE IF NOT EXISTS download_jobs (
			id TEXT PRIMARY KEY,
			symbol TEXT NOT NULL,
			market TEXT NOT NULL,
			start_date TEXT NOT NULL,
			end_date TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			progress REAL NOT NULL DEFAULT 0,
			step_detail TEXT NOT NULL DEFAULT '',
			error TEXT NOT NULL DEFAULT '',
			total_ticks INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			completed_at TEXT
		)`,
	}
	for _, q := range etapa3Queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("migration etapa3: %w", err)
		}
	}

	// Phase 12 Etapa 2: tier_policies table
	tierPoliciesQueries := []string{
		`CREATE TABLE IF NOT EXISTS tier_policies (
			tier TEXT PRIMARY KEY,
			session_limit INTEGER NOT NULL,
			history_max_days INTEGER NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
	}
	for _, q := range tierPoliciesQueries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("migration tier_policies: %w", err)
		}
	}

	// Phase 13: idempotent UNIQUE index on nickname
	if err := ensureNicknameUnique(db); err != nil {
		return fmt.Errorf("migration nickname unique: %w", err)
	}

	// Phase 12 Step 2.3+: idempotent ALTER for tier_policies expanded columns
	tierCols := []struct {
		name string
		def  string
	}{
		{"chart_compression_locked", "INTEGER NOT NULL DEFAULT 0"},
		{"compression_max", "INTEGER NOT NULL DEFAULT 1"},
		{"max_indicators", "INTEGER NOT NULL DEFAULT 1"},
		{"custom_indicator_settings", "INTEGER NOT NULL DEFAULT 0"},
		{"telegram_enabled", "INTEGER NOT NULL DEFAULT 0"},
		{"workspaces_count", "INTEGER NOT NULL DEFAULT 1"},
		{"anomalies_enabled", "INTEGER NOT NULL DEFAULT 0"},
		{"history_days_per_tf", "TEXT NOT NULL DEFAULT '{\"1m\":1,\"5m\":1,\"15m\":1,\"30m\":1,\"1h\":1,\"4h\":1}'"},
		{"gated_indicators", "TEXT NOT NULL DEFAULT '[]'"},
	}
	tierExisting := make(map[string]bool)
	tierRows, err := db.Query("PRAGMA table_info(tier_policies)")
	if err != nil {
		return fmt.Errorf("migration pragma tier_policies: %w", err)
	}
	for tierRows.Next() {
		var cid int
		var name, ctype string
		var notnull int
		var dfltValue interface{}
		var pk int
		if err := tierRows.Scan(&cid, &name, &ctype, &notnull, &dfltValue, &pk); err != nil {
			tierRows.Close()
			return fmt.Errorf("migration scan tier_policies: %w", err)
		}
		tierExisting[name] = true
	}
	tierRows.Close()

	// Capture before the ALTER loop: true when gated_indicators does not yet
	// exist and is about to be created. Used to run the one-time backfill below
	// only on first creation (not on every start).
	gatedIndicatorsJustCreated := !tierExisting["gated_indicators"]

	for _, col := range tierCols {
		if !tierExisting[col.name] {
			stmt := fmt.Sprintf("ALTER TABLE tier_policies ADD COLUMN %s %s", col.name, col.def)
			if _, err := db.Exec(stmt); err != nil {
				return fmt.Errorf("migration alter tier_policies %s: %w", col.name, err)
			}
		}
	}

	// One-time backfill: when gated_indicators is first added, hide Buy/Sell
	// Zone for every non-admin tier (admin keeps '[]' = everything visible).
	// Runs only on column creation — on a fresh DB the table is empty here and
	// SeedTierPolicies sets the defaults instead.
	if gatedIndicatorsJustCreated {
		if _, err := db.Exec(
			`UPDATE tier_policies SET gated_indicators='["buySellZone"]' WHERE tier IN ('guest','free','pro','vip')`,
		); err != nil {
			return fmt.Errorf("migration backfill gated_indicators: %w", err)
		}
	}

	// Phase 14 Step 1: drawing_defaults table (per-user per-type drawing settings)
	drawingDefaultsQueries := []string{
		`CREATE TABLE IF NOT EXISTS drawing_defaults (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			drawing_type TEXT NOT NULL,
			settings TEXT NOT NULL DEFAULT '{}',
			updated_at TEXT NOT NULL,
			PRIMARY KEY (user_id, drawing_type)
		)`,
	}
	for _, q := range drawingDefaultsQueries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("migration drawing_defaults: %w", err)
		}
	}

	// Phase 14 Step 2: drawings table (saved drawing objects, scoped to symbol+interval+market_type)
	drawingsQueries := []string{
		`CREATE TABLE IF NOT EXISTS drawings (
			id TEXT NOT NULL,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			symbol TEXT NOT NULL,
			interval TEXT NOT NULL,
			market_type TEXT NOT NULL,
			drawing_type TEXT NOT NULL,
			payload TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (id, user_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_drawings_lookup ON drawings(user_id, symbol, interval, market_type)`,
	}
	for _, q := range drawingsQueries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("migration drawings: %w", err)
		}
	}

	// Phase 15: per-key indicators (user_indicators + admin_indicator_defaults)
	// Scope: (symbol, market, timeframe). timeframe='*' is the scope=all-tf marker.
	indicatorsQueries := []string{
		`CREATE TABLE IF NOT EXISTS user_indicators (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			symbol TEXT NOT NULL,
			market TEXT NOT NULL,
			timeframe TEXT NOT NULL,
			indicators_json TEXT NOT NULL DEFAULT '[]',
			updated_at TEXT NOT NULL,
			PRIMARY KEY (user_id, symbol, market, timeframe)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_user_indicators_lookup ON user_indicators(user_id, symbol, market, timeframe)`,
		`CREATE TABLE IF NOT EXISTS admin_indicator_defaults (
			symbol TEXT NOT NULL,
			market TEXT NOT NULL,
			timeframe TEXT NOT NULL,
			indicators_json TEXT NOT NULL DEFAULT '[]',
			updated_by TEXT NOT NULL REFERENCES users(id),
			updated_at TEXT NOT NULL,
			PRIMARY KEY (symbol, market, timeframe)
		)`,
	}
	for _, q := range indicatorsQueries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("migration indicators: %w", err)
		}
	}

	// User indicator presets (per-user named presets of one indicator type,
	// UNIQUE per (user, indicator_id, name)).
	// admin_preset_indicators dropped here as part of the procluster-preset
	// deprecation — replaced by admin_indicator_defaults (per-key defaults
	// driven by the "Дефолт" button in the indicator modal).
	if _, err := db.Exec(`DROP TABLE IF EXISTS admin_preset_indicators`); err != nil {
		return fmt.Errorf("migration drop admin_preset_indicators: %w", err)
	}
	presetQueries := []string{
		`CREATE TABLE IF NOT EXISTS user_indicator_presets (
			id            TEXT PRIMARY KEY,
			user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			indicator_id  TEXT NOT NULL,
			name          TEXT NOT NULL,
			settings_json TEXT NOT NULL,
			created_at    TEXT NOT NULL,
			updated_at    TEXT NOT NULL,
			UNIQUE (user_id, indicator_id, name)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_user_indicator_presets_user
			ON user_indicator_presets(user_id, indicator_id, updated_at DESC)`,
	}
	for _, q := range presetQueries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("migration presets: %w", err)
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

// UpdateLastLogin записывает время последнего визита (логин/refresh) с троттлом ~15 минут.
// Один UPDATE с условием, без отдельного чтения. Формат времени идентичен created_at
// (time.RFC3339, UTC) — строковое сравнение корректно. Ошибку только логируем,
// наверх не возвращаем, чтобы не ломать логин/refresh.
func UpdateLastLogin(ctx context.Context, db *sql.DB, userID string) {
	now := time.Now().UTC()
	throttle := now.Add(-15 * time.Minute)
	_, err := db.ExecContext(ctx,
		`UPDATE users SET last_login = ? WHERE id = ? AND (last_login = '' OR last_login < ?)`,
		now.Format(time.RFC3339), userID, throttle.Format(time.RFC3339),
	)
	if err != nil {
		log.Printf("[auth] update last_login user %s: %v", userID, err)
	}
}

func GetUserByNickname(ctx context.Context, db *sql.DB, nickname string) (*User, error) {
	row := db.QueryRowContext(ctx,
		`SELECT id, email, nickname, password_hash, role, email_verified, created_at, updated_at, avatar, subscription_status, subscription_paid_at, subscription_expires_at
		 FROM users WHERE LOWER(nickname) = LOWER(?)`, nickname,
	)
	return scanUser(row)
}

// --- Drawing Defaults (Phase 14 Step 1) ---

func GetDrawingDefaults(ctx context.Context, db *sql.DB, userID string) (map[string]string, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT drawing_type, settings FROM drawing_defaults WHERE user_id = ?`, userID)
	if err != nil {
		return nil, fmt.Errorf("get drawing defaults: %w", err)
	}
	defer rows.Close()

	result := make(map[string]string)
	for rows.Next() {
		var drawingType, settings string
		if err := rows.Scan(&drawingType, &settings); err != nil {
			return nil, fmt.Errorf("scan drawing default: %w", err)
		}
		result[drawingType] = settings
	}
	return result, rows.Err()
}

func UpsertDrawingDefault(ctx context.Context, db *sql.DB, userID, drawingType, settings string) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO drawing_defaults (user_id, drawing_type, settings, updated_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(user_id, drawing_type) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
		userID, drawingType, settings, time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("upsert drawing default: %w", err)
	}
	return nil
}

// --- Drawings (Phase 14 Step 2) ---

type DrawingRow struct {
	ID          string
	UserID      string
	Symbol      string
	Interval    string
	MarketType  string
	DrawingType string
	Payload     string
	CreatedAt   string
	UpdatedAt   string
}

func GetDrawings(ctx context.Context, db *sql.DB, userID, symbol, interval, marketType string) ([]DrawingRow, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, user_id, symbol, interval, market_type, drawing_type, payload, created_at, updated_at
		 FROM drawings WHERE user_id = ? AND symbol = ? AND interval = ? AND market_type = ?
		 ORDER BY created_at ASC`, userID, symbol, interval, marketType)
	if err != nil {
		return nil, fmt.Errorf("get drawings: %w", err)
	}
	defer rows.Close()

	var result []DrawingRow
	for rows.Next() {
		var r DrawingRow
		if err := rows.Scan(&r.ID, &r.UserID, &r.Symbol, &r.Interval, &r.MarketType,
			&r.DrawingType, &r.Payload, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan drawing: %w", err)
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

func BatchReplaceDrawings(ctx context.Context, db *sql.DB, userID, symbol, interval, marketType string, drawings []DrawingRow) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	// Delete all existing drawings for this combo
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM drawings WHERE user_id = ? AND symbol = ? AND interval = ? AND market_type = ?`,
		userID, symbol, interval, marketType); err != nil {
		return fmt.Errorf("delete existing drawings: %w", err)
	}

	// Insert new batch
	now := time.Now().UTC().Format(time.RFC3339)
	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO drawings (id, user_id, symbol, interval, market_type, drawing_type, payload, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare insert: %w", err)
	}
	defer stmt.Close()

	for _, d := range drawings {
		if _, err := stmt.ExecContext(ctx, d.ID, d.UserID, d.Symbol, d.Interval,
			d.MarketType, d.DrawingType, d.Payload, now, now); err != nil {
			return fmt.Errorf("insert drawing %s: %w", d.ID, err)
		}
	}

	return tx.Commit()
}

func DeleteDrawing(ctx context.Context, db *sql.DB, id, userID string) error {
	res, err := db.ExecContext(ctx,
		`DELETE FROM drawings WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return fmt.Errorf("delete drawing: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func ensureNicknameUnique(db *sql.DB) error {
	rows, err := db.Query(`SELECT nickname, COUNT(*) as cnt FROM users GROUP BY nickname HAVING cnt > 1`)
	if err != nil {
		return fmt.Errorf("check nickname duplicates: %w", err)
	}
	defer rows.Close()
	if rows.Next() {
		var nick string
		var cnt int
		if err := rows.Scan(&nick, &cnt); err != nil {
			return fmt.Errorf("scan duplicate nickname: %w", err)
		}
		log.Printf("[auth] WARNING: duplicate nickname %q appears %d times, skipping UNIQUE index", nick, cnt)
		return nil
	}
	_, err = db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname)`)
	if err != nil {
		return fmt.Errorf("create unique index on nickname: %w", err)
	}
	log.Println("[auth] unique index on nickname created/verified")
	return nil
}
