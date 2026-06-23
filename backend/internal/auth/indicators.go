package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// AllTimeframeMarker is the special timeframe value used for scope=all-tf rows.
// A user_indicators or admin_indicator_defaults row with timeframe='*' applies
// to every concrete timeframe via the cascade resolver, unless a more specific
// per-tf row exists.
const AllTimeframeMarker = "*"

// IndicatorsSource identifies which layer of the cascade produced the result.
type IndicatorsSource string

const (
	SourceUserTF     IndicatorsSource = "user-tf"
	SourceUserAllTF  IndicatorsSource = "user-all-tf"
	SourceAdminTF    IndicatorsSource = "admin-tf"
	SourceAdminAllTF IndicatorsSource = "admin-all-tf"
	SourceSystem     IndicatorsSource = "system"
)

// AdminIndicatorDefaultRow is one (symbol, market, timeframe) admin default.
type AdminIndicatorDefaultRow struct {
	Symbol         string
	Market         string
	Timeframe      string
	IndicatorsJSON string
	UpdatedBy      string
	UpdatedAt      string
}

// --- user_indicators CRUD ---

// GetUserIndicator returns the raw JSON array stored for a specific
// (user_id, symbol, market, timeframe) tuple. exists is false when no row is
// found (caller should fall through the cascade). All inputs are expected to
// be already normalized to the canonical case (symbol upper, market/timeframe
// lower; AllTimeframeMarker for scope=all-tf).
func GetUserIndicator(ctx context.Context, db *sql.DB, userID, symbol, market, timeframe string) (string, bool, error) {
	var jsonStr string
	err := db.QueryRowContext(ctx,
		`SELECT indicators_json FROM user_indicators
		 WHERE user_id = ? AND symbol = ? AND market = ? AND timeframe = ?`,
		userID, symbol, market, timeframe,
	).Scan(&jsonStr)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("get user_indicators: %w", err)
	}
	return jsonStr, true, nil
}

// UpsertUserIndicator replaces the indicators_json for a row, or inserts a new
// row when none exists. The caller is responsible for validating indicatorsJSON
// shape and size limits before this call.
func UpsertUserIndicator(ctx context.Context, db *sql.DB, userID, symbol, market, timeframe, indicatorsJSON string) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO user_indicators (user_id, symbol, market, timeframe, indicators_json, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, symbol, market, timeframe) DO UPDATE SET
		   indicators_json = excluded.indicators_json,
		   updated_at = excluded.updated_at`,
		userID, symbol, market, timeframe, indicatorsJSON,
		time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("upsert user_indicators: %w", err)
	}
	return nil
}

// DeleteUserIndicator removes a per-(user,symbol,market,timeframe) row so the
// cascade falls through to the next layer (user-all-tf → admin-tf →
// admin-all-tf → system).
func DeleteUserIndicator(ctx context.Context, db *sql.DB, userID, symbol, market, timeframe string) error {
	res, err := db.ExecContext(ctx,
		`DELETE FROM user_indicators
		 WHERE user_id = ? AND symbol = ? AND market = ? AND timeframe = ?`,
		userID, symbol, market, timeframe,
	)
	if err != nil {
		return fmt.Errorf("delete user_indicators: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// MergeAddUserIndicator appends entries from newIndicatorsJSON to the existing
// row for (user_id, symbol, market, timeframe), skipping any whose "id" field
// is already present. The whole operation is wrapped in a transaction so a
// concurrent writer cannot interleave. If no row exists yet, the new array is
// written as-is.
//
// newIndicatorsJSON must be a JSON array of objects each containing a string
// "id" field; otherwise an error is returned. The existing row is validated
// the same way — if it is corrupt, the function fails rather than silently
// dropping the data.
func MergeAddUserIndicator(ctx context.Context, db *sql.DB, userID, symbol, market, timeframe, newIndicatorsJSON string) error {
	newItems, err := parseIndicatorsArray(newIndicatorsJSON)
	if err != nil {
		return fmt.Errorf("merge-add: parse new: %w", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("merge-add: begin tx: %w", err)
	}
	defer tx.Rollback()

	var existingJSON string
	err = tx.QueryRowContext(ctx,
		`SELECT indicators_json FROM user_indicators
		 WHERE user_id = ? AND symbol = ? AND market = ? AND timeframe = ?`,
		userID, symbol, market, timeframe,
	).Scan(&existingJSON)

	var merged []map[string]interface{}
	if err == sql.ErrNoRows {
		merged = newItems
	} else if err != nil {
		return fmt.Errorf("merge-add: read existing: %w", err)
	} else {
		existing, perr := parseIndicatorsArray(existingJSON)
		if perr != nil {
			return fmt.Errorf("merge-add: parse existing: %w", perr)
		}
		seen := make(map[string]bool, len(existing))
		for _, it := range existing {
			if id, ok := it["id"].(string); ok {
				seen[id] = true
			}
		}
		merged = existing
		for _, it := range newItems {
			id, ok := it["id"].(string)
			if !ok {
				continue
			}
			if seen[id] {
				continue
			}
			merged = append(merged, it)
			seen[id] = true
		}
	}

	mergedBytes, err := json.Marshal(merged)
	if err != nil {
		return fmt.Errorf("merge-add: marshal: %w", err)
	}

	_, err = tx.ExecContext(ctx,
		`INSERT INTO user_indicators (user_id, symbol, market, timeframe, indicators_json, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, symbol, market, timeframe) DO UPDATE SET
		   indicators_json = excluded.indicators_json,
		   updated_at = excluded.updated_at`,
		userID, symbol, market, timeframe, string(mergedBytes),
		time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("merge-add: upsert: %w", err)
	}
	return tx.Commit()
}

// PropagateUserIndicator upserts a single indicator (identified by its "id"
// field) into the (user, symbol, market, '*') row AND into every EXISTING
// per-tf row of the same (user, symbol, market). Within each target row the
// id slot is replace-or-appended: existing entries with the same id are
// overwritten, otherwise the new entry is appended. Sibling indicators in
// those rows are preserved bit-for-bit.
//
// Per-tf rows that do not already exist are NOT created — every per-tf query
// without its own row falls through the cascade to the just-written '*' row.
//
// oneJSON must be a JSON object containing a non-empty string "id". The
// whole object is stored verbatim, so settings/isActive/isVisible/etc.
// round-trip without lossy projection.
//
// All reads and writes happen inside a single transaction; any error
// rolls back the whole operation.
func PropagateUserIndicator(ctx context.Context, db *sql.DB, userID, symbol, market string, oneJSON json.RawMessage) error {
	var probe struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(oneJSON, &probe); err != nil {
		return fmt.Errorf("propagate: parse new: %w", err)
	}
	if probe.ID == "" {
		return fmt.Errorf("propagate: indicator id is required")
	}
	id := probe.ID

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("propagate: begin tx: %w", err)
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx,
		`SELECT timeframe, indicators_json FROM user_indicators
		 WHERE user_id = ? AND symbol = ? AND market = ?`,
		userID, symbol, market)
	if err != nil {
		return fmt.Errorf("propagate: list rows: %w", err)
	}
	type snap struct{ tf, body string }
	var snaps []snap
	for rows.Next() {
		var s snap
		if err := rows.Scan(&s.tf, &s.body); err != nil {
			rows.Close()
			return fmt.Errorf("propagate: scan: %w", err)
		}
		snaps = append(snaps, s)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("propagate: rows: %w", err)
	}
	rows.Close()

	now := time.Now().UTC().Format(time.RFC3339)
	upsert := `INSERT INTO user_indicators (user_id, symbol, market, timeframe, indicators_json, updated_at)
	           VALUES (?, ?, ?, ?, ?, ?)
	           ON CONFLICT(user_id, symbol, market, timeframe) DO UPDATE SET
	             indicators_json = excluded.indicators_json,
	             updated_at = excluded.updated_at`

	hasStar := false
	for _, s := range snaps {
		var arr []json.RawMessage
		if s.body != "" {
			if err := json.Unmarshal([]byte(s.body), &arr); err != nil {
				return fmt.Errorf("propagate: parse existing tf=%s: %w", s.tf, err)
			}
		}
		idx := -1
		for i, raw := range arr {
			var p struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(raw, &p); err != nil {
				continue
			}
			if p.ID == id {
				idx = i
				break
			}
		}
		if idx >= 0 {
			arr[idx] = oneJSON
		} else {
			arr = append(arr, oneJSON)
		}
		nextJSON, err := json.Marshal(arr)
		if err != nil {
			return fmt.Errorf("propagate: marshal tf=%s: %w", s.tf, err)
		}
		if _, err := tx.ExecContext(ctx, upsert,
			userID, symbol, market, s.tf, string(nextJSON), now); err != nil {
			return fmt.Errorf("propagate: upsert tf=%s: %w", s.tf, err)
		}
		if s.tf == AllTimeframeMarker {
			hasStar = true
		}
	}

	if !hasStar {
		starJSON, err := json.Marshal([]json.RawMessage{oneJSON})
		if err != nil {
			return fmt.Errorf("propagate: marshal '*': %w", err)
		}
		if _, err := tx.ExecContext(ctx, upsert,
			userID, symbol, market, AllTimeframeMarker, string(starJSON), now); err != nil {
			return fmt.Errorf("propagate: upsert '*': %w", err)
		}
	}

	return tx.Commit()
}

// --- admin_indicator_defaults CRUD ---

func GetAdminIndicatorDefault(ctx context.Context, db *sql.DB, symbol, market, timeframe string) (string, bool, error) {
	var jsonStr string
	err := db.QueryRowContext(ctx,
		`SELECT indicators_json FROM admin_indicator_defaults
		 WHERE symbol = ? AND market = ? AND timeframe = ?`,
		symbol, market, timeframe,
	).Scan(&jsonStr)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("get admin_indicator_defaults: %w", err)
	}
	return jsonStr, true, nil
}

// ListAdminIndicatorDefaultsForSymbol returns every (market, timeframe) admin
// default row for the given symbol, ordered by market then timeframe (with the
// AllTimeframeMarker row sorted last for a stable UI). Used by the admin
// panel listing endpoint.
func ListAdminIndicatorDefaultsForSymbol(ctx context.Context, db *sql.DB, symbol string) ([]AdminIndicatorDefaultRow, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT symbol, market, timeframe, indicators_json, updated_by, updated_at
		 FROM admin_indicator_defaults WHERE symbol = ?
		 ORDER BY market ASC, (timeframe = '*') ASC, timeframe ASC`,
		symbol,
	)
	if err != nil {
		return nil, fmt.Errorf("list admin_indicator_defaults: %w", err)
	}
	defer rows.Close()

	var result []AdminIndicatorDefaultRow
	for rows.Next() {
		var r AdminIndicatorDefaultRow
		if err := rows.Scan(&r.Symbol, &r.Market, &r.Timeframe, &r.IndicatorsJSON, &r.UpdatedBy, &r.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan admin_indicator_defaults: %w", err)
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

func UpsertAdminIndicatorDefault(ctx context.Context, db *sql.DB, adminUserID, symbol, market, timeframe, indicatorsJSON string) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO admin_indicator_defaults (symbol, market, timeframe, indicators_json, updated_by, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(symbol, market, timeframe) DO UPDATE SET
		   indicators_json = excluded.indicators_json,
		   updated_by = excluded.updated_by,
		   updated_at = excluded.updated_at`,
		symbol, market, timeframe, indicatorsJSON, adminUserID,
		time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("upsert admin_indicator_defaults: %w", err)
	}
	return nil
}

func DeleteAdminIndicatorDefault(ctx context.Context, db *sql.DB, symbol, market, timeframe string) error {
	res, err := db.ExecContext(ctx,
		`DELETE FROM admin_indicator_defaults
		 WHERE symbol = ? AND market = ? AND timeframe = ?`,
		symbol, market, timeframe,
	)
	if err != nil {
		return fmt.Errorf("delete admin_indicator_defaults: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// UpsertSingleAdminIndicatorDefault reads the existing admin_indicator_defaults
// row for (symbol, market, timeframe), replaces or appends the indicator
// (identified by its "id" field), and writes the merged array back. Whole
// operation runs in a transaction so concurrent writers on the same key cannot
// interleave. one must be a JSON object with a non-empty string "id"; sibling
// fields (settings/isActive/isVisible/...) are stored verbatim.
func UpsertSingleAdminIndicatorDefault(ctx context.Context, db *sql.DB, adminUserID, symbol, market, timeframe string, one json.RawMessage) error {
	var probe struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(one, &probe); err != nil {
		return fmt.Errorf("admin upsert-single: parse: %w", err)
	}
	if probe.ID == "" {
		return fmt.Errorf("admin upsert-single: indicator id is required")
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("admin upsert-single: begin tx: %w", err)
	}
	defer tx.Rollback()

	var existing string
	err = tx.QueryRowContext(ctx,
		`SELECT indicators_json FROM admin_indicator_defaults
		 WHERE symbol = ? AND market = ? AND timeframe = ?`,
		symbol, market, timeframe,
	).Scan(&existing)

	var arr []json.RawMessage
	if err == sql.ErrNoRows {
		arr = []json.RawMessage{one}
	} else if err != nil {
		return fmt.Errorf("admin upsert-single: read existing: %w", err)
	} else {
		if existing != "" {
			if err := json.Unmarshal([]byte(existing), &arr); err != nil {
				return fmt.Errorf("admin upsert-single: parse existing: %w", err)
			}
		}
		idx := -1
		for i, raw := range arr {
			var p struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(raw, &p); err != nil {
				continue
			}
			if p.ID == probe.ID {
				idx = i
				break
			}
		}
		if idx >= 0 {
			arr[idx] = one
		} else {
			arr = append(arr, one)
		}
	}

	mergedBytes, err := json.Marshal(arr)
	if err != nil {
		return fmt.Errorf("admin upsert-single: marshal: %w", err)
	}

	_, err = tx.ExecContext(ctx,
		`INSERT INTO admin_indicator_defaults (symbol, market, timeframe, indicators_json, updated_by, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(symbol, market, timeframe) DO UPDATE SET
		   indicators_json = excluded.indicators_json,
		   updated_by = excluded.updated_by,
		   updated_at = excluded.updated_at`,
		symbol, market, timeframe, string(mergedBytes), adminUserID,
		time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("admin upsert-single: upsert: %w", err)
	}
	return tx.Commit()
}

// DeleteSingleAdminIndicatorDefault removes the indicator identified by
// indicatorID from the admin_indicator_defaults row for (symbol, market,
// timeframe). If the resulting array is empty the whole row is dropped.
// Returns sql.ErrNoRows when no admin row exists for the key or the indicator
// id was not present.
func DeleteSingleAdminIndicatorDefault(ctx context.Context, db *sql.DB, symbol, market, timeframe, indicatorID string) error {
	if indicatorID == "" {
		return fmt.Errorf("admin delete-single: indicator id is required")
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("admin delete-single: begin tx: %w", err)
	}
	defer tx.Rollback()

	var existing string
	err = tx.QueryRowContext(ctx,
		`SELECT indicators_json FROM admin_indicator_defaults
		 WHERE symbol = ? AND market = ? AND timeframe = ?`,
		symbol, market, timeframe,
	).Scan(&existing)
	if err == sql.ErrNoRows {
		return sql.ErrNoRows
	}
	if err != nil {
		return fmt.Errorf("admin delete-single: read existing: %w", err)
	}

	var arr []json.RawMessage
	if existing != "" {
		if err := json.Unmarshal([]byte(existing), &arr); err != nil {
			return fmt.Errorf("admin delete-single: parse existing: %w", err)
		}
	}
	filtered := make([]json.RawMessage, 0, len(arr))
	found := false
	for _, raw := range arr {
		var p struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			filtered = append(filtered, raw)
			continue
		}
		if p.ID == indicatorID {
			found = true
			continue
		}
		filtered = append(filtered, raw)
	}
	if !found {
		return sql.ErrNoRows
	}

	if len(filtered) == 0 {
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM admin_indicator_defaults
			 WHERE symbol = ? AND market = ? AND timeframe = ?`,
			symbol, market, timeframe,
		); err != nil {
			return fmt.Errorf("admin delete-single: delete row: %w", err)
		}
		return tx.Commit()
	}

	mergedBytes, err := json.Marshal(filtered)
	if err != nil {
		return fmt.Errorf("admin delete-single: marshal: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE admin_indicator_defaults
		 SET indicators_json = ?, updated_at = ?
		 WHERE symbol = ? AND market = ? AND timeframe = ?`,
		string(mergedBytes), time.Now().UTC().Format(time.RFC3339),
		symbol, market, timeframe,
	); err != nil {
		return fmt.Errorf("admin delete-single: update: %w", err)
	}
	return tx.Commit()
}

// --- cascade resolver ---

// ResolveIndicators walks the cascade (user-tf → user-all-tf → admin-tf →
// admin-all-tf → system) and returns the highest-priority row that matches.
// userID == "" forces guest mode (only the admin and system tiers are
// considered). The returned jsonStr is the raw `indicators_json` column;
// callers are responsible for parsing it.
//
// Priority is enforced explicitly via an `ORDER BY prio` column inside the
// derived table — UNION ALL alone does NOT guarantee row order in SQLite, so
// `LIMIT 1` without `ORDER BY` would non-deterministically pick a tier.
func ResolveIndicators(ctx context.Context, db *sql.DB, userID, symbol, market, timeframe string) (string, IndicatorsSource, error) {
	if userID == "" {
		return resolveGuest(ctx, db, symbol, market, timeframe)
	}
	return resolveAuthed(ctx, db, userID, symbol, market, timeframe)
}

func resolveAuthed(ctx context.Context, db *sql.DB, userID, symbol, market, timeframe string) (string, IndicatorsSource, error) {
	const query = `
SELECT indicators_json, source FROM (
  SELECT indicators_json, 'user-tf'      AS source, 1 AS prio FROM user_indicators
    WHERE user_id = ? AND symbol = ? AND market = ? AND timeframe = ?
  UNION ALL
  SELECT indicators_json, 'user-all-tf'  AS source, 2 AS prio FROM user_indicators
    WHERE user_id = ? AND symbol = ? AND market = ? AND timeframe = '*'
  UNION ALL
  SELECT indicators_json, 'admin-tf'     AS source, 3 AS prio FROM admin_indicator_defaults
    WHERE symbol = ? AND market = ? AND timeframe = ?
  UNION ALL
  SELECT indicators_json, 'admin-all-tf' AS source, 4 AS prio FROM admin_indicator_defaults
    WHERE symbol = ? AND market = ? AND timeframe = '*'
) ORDER BY prio LIMIT 1`

	var jsonStr, source string
	err := db.QueryRowContext(ctx, query,
		userID, symbol, market, timeframe, // user-tf
		userID, symbol, market, // user-all-tf
		symbol, market, timeframe, // admin-tf
		symbol, market, // admin-all-tf
	).Scan(&jsonStr, &source)
	if err == sql.ErrNoRows {
		return "[]", SourceSystem, nil
	}
	if err != nil {
		return "", "", fmt.Errorf("resolve indicators (authed): %w", err)
	}
	return jsonStr, IndicatorsSource(source), nil
}

func resolveGuest(ctx context.Context, db *sql.DB, symbol, market, timeframe string) (string, IndicatorsSource, error) {
	const query = `
SELECT indicators_json, source FROM (
  SELECT indicators_json, 'admin-tf'     AS source, 3 AS prio FROM admin_indicator_defaults
    WHERE symbol = ? AND market = ? AND timeframe = ?
  UNION ALL
  SELECT indicators_json, 'admin-all-tf' AS source, 4 AS prio FROM admin_indicator_defaults
    WHERE symbol = ? AND market = ? AND timeframe = '*'
) ORDER BY prio LIMIT 1`

	var jsonStr, source string
	err := db.QueryRowContext(ctx, query,
		symbol, market, timeframe,
		symbol, market,
	).Scan(&jsonStr, &source)
	if err == sql.ErrNoRows {
		return "[]", SourceSystem, nil
	}
	if err != nil {
		return "", "", fmt.Errorf("resolve indicators (guest): %w", err)
	}
	return jsonStr, IndicatorsSource(source), nil
}

// parseIndicatorsArray decodes a JSON array of objects. Used by MergeAddUserIndicator
// to enforce the array-of-objects shape before merging. Each item is kept as
// map[string]interface{} so unknown fields (e.g. settings sub-trees) survive
// the round-trip without lossy projection onto a Go struct.
func parseIndicatorsArray(jsonStr string) ([]map[string]interface{}, error) {
	if jsonStr == "" {
		return nil, nil
	}
	var items []map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &items); err != nil {
		return nil, fmt.Errorf("not a JSON array of objects: %w", err)
	}
	return items, nil
}
