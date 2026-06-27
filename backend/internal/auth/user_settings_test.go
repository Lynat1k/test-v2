package auth

import (
	"context"
	"testing"
)

// Regression: GET /user/settings returned 500 for any user with a saved
// settings row. Root cause was a type mismatch — user_settings.updated_at is a
// TEXT column, but UpsertUserSettings wrote a raw time.Time and GetUserSettings
// scanned it back into a time.Time. modernc.org/sqlite returns TEXT as string,
// and database/sql cannot convert string -> time.Time on Scan, so Get errored.
// This test fails before the fix (Get returns an error) and passes after.
func TestUserSettingsRoundTrip(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()
	uid := makeTestUser(t, db, "settings@test.com")

	const payload = `{"theme":"dark","compression":10}`
	if err := UpsertUserSettings(ctx, db, uid, payload); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	got, err := GetUserSettings(ctx, db, uid)
	if err != nil {
		t.Fatalf("get after upsert (the 500 bug): %v", err)
	}
	if got.SettingsJSON != payload {
		t.Fatalf("settings mismatch: got=%s want=%s", got.SettingsJSON, payload)
	}

	// SetUserSettingsField path must also round-trip with a readable Get.
	if err := SetUserSettingsField(ctx, db, uid, "favoriteIndicatorIds", []string{"cvd"}); err != nil {
		t.Fatalf("set field: %v", err)
	}
	if _, err := GetUserSettings(ctx, db, uid); err != nil {
		t.Fatalf("get after set field: %v", err)
	}
}
