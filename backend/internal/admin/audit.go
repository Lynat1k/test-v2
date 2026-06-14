package admin

import (
	"context"
	"database/sql"
	"log"
	"time"

	"github.com/google/uuid"
)

func LogAdminAction(ctx context.Context, db *sql.DB, userID, action, target, detail, ip string) {
	_, err := db.ExecContext(ctx,
		`INSERT INTO admin_actions (id, user_id, action, target, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		uuid.New().String(), userID, action, target, detail, ip, time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		log.Printf("[admin-audit] failed to log action: %v (user=%s action=%s target=%s)", err, userID, action, target)
	}
}
