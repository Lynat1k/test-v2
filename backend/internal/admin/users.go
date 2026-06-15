package admin

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"math/big"
	"time"

	"github.com/procluster/procluster/internal/auth"
)

type UserListItem struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Nickname  string `json:"nickname"`
	Role      string `json:"role"`
	CreatedAt string `json:"createdAt"`
}

var validRoles = map[string]bool{
	"free":  true,
	"pro":   true,
	"vip":   true,
	"admin": true,
}

func ListUsers(ctx context.Context, db *sql.DB, limit, offset int) ([]UserListItem, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, email, nickname, role, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`,
		limit, offset,
	)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	var users []UserListItem
	for rows.Next() {
		var u UserListItem
		if err := rows.Scan(&u.ID, &u.Email, &u.Nickname, &u.Role, &u.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows err: %w", err)
	}
	if users == nil {
		users = []UserListItem{}
	}
	return users, nil
}

func CreateUserByAdmin(ctx context.Context, db *sql.DB, login, password, role string, email string) (*auth.User, error) {
	hash, err := auth.HashPassword(password)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	// Generate placeholder email if none provided
	if email == "" {
		n, _ := rand.Int(rand.Reader, big.NewInt(999999999))
		email = fmt.Sprintf("user_%d@placeholder.local", n.Int64()+100000000)
	}

	user := &auth.User{
		Email:         email,
		Nickname:      login,
		PasswordHash:  hash,
		Role:          role,
		EmailVerified: true,
	}
	if err := auth.CreateUser(ctx, db, user); err != nil {
		return nil, err
	}
	return user, nil
}

func UpdateUserRole(ctx context.Context, db *sql.DB, userID, newRole string) error {
	_, err := db.ExecContext(ctx,
		`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`,
		newRole, time.Now().UTC().Format(time.RFC3339), userID,
	)
	if err != nil {
		return fmt.Errorf("update user role: %w", err)
	}
	return nil
}

func GetUserEmailByID(ctx context.Context, db *sql.DB, userID string) (string, error) {
	var email string
	err := db.QueryRowContext(ctx, `SELECT email FROM users WHERE id = ?`, userID).Scan(&email)
	if err != nil {
		return "", err
	}
	return email, nil
}

func DeleteUserByID(ctx context.Context, db *sql.DB, userID string) error {
	_, err := db.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, userID)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	return nil
}
