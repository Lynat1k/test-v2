package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

type UserSettings struct {
	UserID       string    `json:"userId"`
	SettingsJSON string    `json:"settingsJson"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

func GetUserSettings(ctx context.Context, db *sql.DB, userID string) (*UserSettings, error) {
	s := &UserSettings{}
	// updated_at is a TEXT column (project convention): scan into a string and
	// parse, never directly into time.Time — modernc returns TEXT as string and
	// database/sql cannot convert string -> time.Time on Scan (that was the 500).
	var updatedAt string
	err := db.QueryRowContext(ctx,
		`SELECT user_id, settings_json, updated_at FROM user_settings WHERE user_id = ?`, userID,
	).Scan(&s.UserID, &s.SettingsJSON, &updatedAt)
	if err != nil {
		return nil, err
	}
	s.UpdatedAt, _ = time.Parse(time.RFC3339, updatedAt) // legacy rows may not parse — non-fatal
	return s, nil
}

func UpsertUserSettings(ctx context.Context, db *sql.DB, userID, settingsJSON string) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO user_settings (user_id, settings_json, updated_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
		userID, settingsJSON, time.Now().UTC().Format(time.RFC3339),
	)
	return err
}

// SetUserSettingsField atomically updates a single field inside the
// user_settings.settings_json JSON blob. It read-modifies-writes inside one
// SQLite transaction so it cannot race with another partial update of the same
// blob (e.g. drawings/favorites/etc. each touching a different key).
//
// If the row does not exist yet it is created with just {field: value}. If the
// stored JSON is corrupt we replace it with {field: value} rather than fail —
// the alternative would leave the user permanently unable to write any setting.
func SetUserSettingsField(ctx context.Context, db *sql.DB, userID, field string, value interface{}) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("set user_settings field: begin: %w", err)
	}
	defer tx.Rollback()

	var existing string
	err = tx.QueryRowContext(ctx,
		`SELECT settings_json FROM user_settings WHERE user_id = ?`, userID,
	).Scan(&existing)

	settings := make(map[string]interface{})
	if err == nil {
		if jerr := json.Unmarshal([]byte(existing), &settings); jerr != nil {
			settings = make(map[string]interface{})
		}
	} else if err != sql.ErrNoRows {
		return fmt.Errorf("set user_settings field: read: %w", err)
	}

	settings[field] = value
	encoded, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("set user_settings field: marshal: %w", err)
	}

	_, err = tx.ExecContext(ctx,
		`INSERT INTO user_settings (user_id, settings_json, updated_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
		userID, string(encoded), time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("set user_settings field: write: %w", err)
	}
	return tx.Commit()
}
