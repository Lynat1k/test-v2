package admin

import (
	"database/sql"
	"fmt"
	"log"
	"sync"
)

var (
	betaModeCache   bool
	betaModeCacheMu sync.RWMutex
)

func InitSiteSettings(db *sql.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS site_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("migration site_settings: %w", err)
		}
	}

	if _, err := db.Exec(`INSERT OR IGNORE INTO site_settings (key, value) VALUES ('beta_mode', '0')`); err != nil {
		return fmt.Errorf("seed beta_mode: %w", err)
	}

	LoadBetaModeIntoCache(db)
	return nil
}

func LoadBetaModeIntoCache(db *sql.DB) {
	var val string
	err := db.QueryRow(`SELECT value FROM site_settings WHERE key = 'beta_mode'`).Scan(&val)
	if err != nil {
		log.Printf("[site_settings] load beta_mode: %v (defaulting to false)", err)
		betaModeCacheMu.Lock()
		betaModeCache = false
		betaModeCacheMu.Unlock()
		return
	}
	betaModeCacheMu.Lock()
	betaModeCache = val == "1"
	betaModeCacheMu.Unlock()
	log.Printf("[site_settings] beta_mode loaded: %v", val == "1")
}

func BetaModeEnabled() bool {
	betaModeCacheMu.RLock()
	defer betaModeCacheMu.RUnlock()
	return betaModeCache
}

func GetBetaMode(db *sql.DB) (bool, error) {
	var val string
	err := db.QueryRow(`SELECT value FROM site_settings WHERE key = 'beta_mode'`).Scan(&val)
	if err != nil {
		return false, fmt.Errorf("get beta_mode: %w", err)
	}
	return val == "1", nil
}

func SetBetaMode(db *sql.DB, enabled bool) error {
	val := "0"
	if enabled {
		val = "1"
	}
	_, err := db.Exec(
		`INSERT INTO site_settings (key, value) VALUES ('beta_mode', ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		val,
	)
	if err != nil {
		return fmt.Errorf("set beta_mode: %w", err)
	}
	betaModeCacheMu.Lock()
	betaModeCache = enabled
	betaModeCacheMu.Unlock()
	log.Printf("[site_settings] beta_mode set to %v", enabled)
	return nil
}
