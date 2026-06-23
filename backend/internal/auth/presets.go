package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// UserIndicatorPreset is one named per-user preset of a single indicator type.
// settings_json is stored verbatim — backend never projects it onto a Go
// struct so unknown indicator-specific fields round-trip without loss.
type UserIndicatorPreset struct {
	ID           string `json:"id"`
	IndicatorID  string `json:"indicatorId"`
	Name         string `json:"name"`
	SettingsJSON string `json:"-"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

// --- user_indicator_presets CRUD ---

// CreateUserIndicatorPreset inserts a new preset and returns the generated id.
// The caller is responsible for size/shape validation of settingsJSON.
// Returns the SQLite unique-violation error verbatim so handlers can detect
// duplicates by inspecting the message (UNIQUE constraint failed: ...).
func CreateUserIndicatorPreset(ctx context.Context, db *sql.DB, userID, indicatorID, name, settingsJSON string) (string, error) {
	id := uuid.New().String()
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.ExecContext(ctx,
		`INSERT INTO user_indicator_presets (id, user_id, indicator_id, name, settings_json, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, userID, indicatorID, name, settingsJSON, now, now,
	)
	if err != nil {
		return "", fmt.Errorf("create user_indicator_preset: %w", err)
	}
	return id, nil
}

// ListUserIndicatorPresets returns presets for the given user. When
// indicatorID != "", the list is narrowed to that single type (ordered by
// updated_at DESC for stable UI).
func ListUserIndicatorPresets(ctx context.Context, db *sql.DB, userID, indicatorID string) ([]UserIndicatorPreset, error) {
	var (
		rows *sql.Rows
		err  error
	)
	if indicatorID != "" {
		rows, err = db.QueryContext(ctx,
			`SELECT id, indicator_id, name, settings_json, created_at, updated_at
			 FROM user_indicator_presets
			 WHERE user_id = ? AND indicator_id = ?
			 ORDER BY updated_at DESC`, userID, indicatorID)
	} else {
		rows, err = db.QueryContext(ctx,
			`SELECT id, indicator_id, name, settings_json, created_at, updated_at
			 FROM user_indicator_presets
			 WHERE user_id = ?
			 ORDER BY indicator_id ASC, updated_at DESC`, userID)
	}
	if err != nil {
		return nil, fmt.Errorf("list user_indicator_presets: %w", err)
	}
	defer rows.Close()

	out := make([]UserIndicatorPreset, 0, 8)
	for rows.Next() {
		var p UserIndicatorPreset
		if err := rows.Scan(&p.ID, &p.IndicatorID, &p.Name, &p.SettingsJSON, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan user_indicator_preset: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetUserIndicatorPreset reads one preset by id, scoped by user (ownership
// check inline so callers can't accidentally fetch someone else's row).
func GetUserIndicatorPreset(ctx context.Context, db *sql.DB, userID, id string) (*UserIndicatorPreset, error) {
	var p UserIndicatorPreset
	err := db.QueryRowContext(ctx,
		`SELECT id, indicator_id, name, settings_json, created_at, updated_at
		 FROM user_indicator_presets
		 WHERE user_id = ? AND id = ?`, userID, id,
	).Scan(&p.ID, &p.IndicatorID, &p.Name, &p.SettingsJSON, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, sql.ErrNoRows
	}
	if err != nil {
		return nil, fmt.Errorf("get user_indicator_preset: %w", err)
	}
	return &p, nil
}

// UpdateUserIndicatorPreset patches name and/or settings_json. Pass empty
// strings to leave a field untouched. Returns sql.ErrNoRows when no row
// matches (user, id).
func UpdateUserIndicatorPreset(ctx context.Context, db *sql.DB, userID, id, name, settingsJSON string) error {
	sets := make([]string, 0, 2)
	args := make([]interface{}, 0, 4)
	if name != "" {
		sets = append(sets, "name = ?")
		args = append(args, name)
	}
	if settingsJSON != "" {
		sets = append(sets, "settings_json = ?")
		args = append(args, settingsJSON)
	}
	if len(sets) == 0 {
		return nil
	}
	sets = append(sets, "updated_at = ?")
	args = append(args, time.Now().UTC().Format(time.RFC3339))
	args = append(args, userID, id)

	res, err := db.ExecContext(ctx,
		"UPDATE user_indicator_presets SET "+strings.Join(sets, ", ")+" WHERE user_id = ? AND id = ?",
		args...,
	)
	if err != nil {
		return fmt.Errorf("update user_indicator_preset: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func DeleteUserIndicatorPreset(ctx context.Context, db *sql.DB, userID, id string) error {
	res, err := db.ExecContext(ctx,
		`DELETE FROM user_indicator_presets WHERE user_id = ? AND id = ?`, userID, id)
	if err != nil {
		return fmt.Errorf("delete user_indicator_preset: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ApplyPresetToKey writes a single indicator's settings into the user's
// per-key row WITHOUT touching sibling indicators.
//
// Steps inside a single transaction:
//  1. Read user_indicators(user, symbol, market, timeframe) — may not exist.
//  2. Decode into []json.RawMessage so unknown fields survive intact.
//  3. Find entry with matching id. If found: replace its settings field.
//     If not: append a fresh entry {id, isActive:true, isVisible:true, settings}.
//  4. Marshal back and upsert.
//
// The new entry includes isActive=true/isVisible=true so applying a preset
// implicitly activates the indicator (matches what the user clicked).
func ApplyPresetToKey(ctx context.Context, db *sql.DB, userID, symbol, market, timeframe, indicatorID string, settings json.RawMessage) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("apply preset: begin tx: %w", err)
	}
	defer tx.Rollback()

	var existing string
	err = tx.QueryRowContext(ctx,
		`SELECT indicators_json FROM user_indicators
		 WHERE user_id = ? AND symbol = ? AND market = ? AND timeframe = ?`,
		userID, symbol, market, timeframe,
	).Scan(&existing)

	var arr []map[string]interface{}
	if err == sql.ErrNoRows {
		arr = nil
	} else if err != nil {
		return fmt.Errorf("apply preset: read existing: %w", err)
	} else if existing != "" {
		if perr := json.Unmarshal([]byte(existing), &arr); perr != nil {
			return fmt.Errorf("apply preset: parse existing: %w", perr)
		}
	}

	var settingsObj map[string]interface{}
	if len(settings) > 0 {
		if perr := json.Unmarshal(settings, &settingsObj); perr != nil {
			return fmt.Errorf("apply preset: parse settings: %w", perr)
		}
	}
	if settingsObj == nil {
		settingsObj = map[string]interface{}{}
	}

	found := false
	for i, it := range arr {
		id, _ := it["id"].(string)
		if id != indicatorID {
			continue
		}
		it["settings"] = settingsObj
		arr[i] = it
		found = true
		break
	}
	if !found {
		arr = append(arr, map[string]interface{}{
			"id":        indicatorID,
			"isActive":  true,
			"isVisible": true,
			"settings":  settingsObj,
		})
	}

	out, err := json.Marshal(arr)
	if err != nil {
		return fmt.Errorf("apply preset: marshal: %w", err)
	}

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO user_indicators (user_id, symbol, market, timeframe, indicators_json, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, symbol, market, timeframe) DO UPDATE SET
		   indicators_json = excluded.indicators_json,
		   updated_at = excluded.updated_at`,
		userID, symbol, market, timeframe, string(out),
		time.Now().UTC().Format(time.RFC3339),
	); err != nil {
		return fmt.Errorf("apply preset: upsert: %w", err)
	}
	return tx.Commit()
}
