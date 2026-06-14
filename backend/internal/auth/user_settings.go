package auth

import (
	"context"
	"database/sql"
	"time"
)

type UserSettings struct {
	UserID       string    `json:"userId"`
	SettingsJSON string    `json:"settingsJson"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

func GetUserSettings(ctx context.Context, db *sql.DB, userID string) (*UserSettings, error) {
	s := &UserSettings{}
	err := db.QueryRowContext(ctx,
		`SELECT user_id, settings_json, updated_at FROM user_settings WHERE user_id = ?`, userID,
	).Scan(&s.UserID, &s.SettingsJSON, &s.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return s, nil
}

func UpsertUserSettings(ctx context.Context, db *sql.DB, userID, settingsJSON string) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO user_settings (user_id, settings_json, updated_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
		userID, settingsJSON, time.Now().UTC(),
	)
	return err
}
