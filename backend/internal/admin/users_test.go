package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestUsers_List_Pagination(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	for i := 0; i < 5; i++ {
		_, err := db.Exec(`INSERT INTO users (id, email, nickname, password_hash, role, email_verified, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
			"user-"+string(rune('0'+i)), "user"+string(rune('0'+i))+"@test.com", "User"+string(rune('0'+i)),
			"$argon2id$v=19$m=65536,t=3,p=1$dummy", "free",
			time.Now().UTC().Format(time.RFC3339), time.Now().UTC().Format(time.RFC3339))
		if err != nil {
			t.Fatalf("insert user: %v", err)
		}
	}

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	token := createAdminToken(t, cfg, "admin-001", "admin")

	req := httptest.NewRequest("GET", "/api/v1/admin/users?limit=2&offset=0", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleGetUsers))
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		OK   bool `json:"ok"`
		Data struct {
			Users  []UserListItem `json:"users"`
			Limit  int            `json:"limit"`
			Offset int            `json:"offset"`
		} `json:"data"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Data.Users) != 2 {
		t.Errorf("expected 2 users, got %d", len(resp.Data.Users))
	}
	if resp.Data.Limit != 2 {
		t.Errorf("expected limit=2, got %d", resp.Data.Limit)
	}
}

func TestUsers_List_PasswordHashNotExposed(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	_, err := db.Exec(`INSERT INTO users (id, email, nickname, password_hash, role, email_verified, created_at, updated_at)
		VALUES ('u1', 'test@test.com', 'Test', 'should-not-appear', 'free', 1, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	token := createAdminToken(t, cfg, "admin-001", "admin")

	req := httptest.NewRequest("GET", "/api/v1/admin/users", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleGetUsers))
	handler.ServeHTTP(w, req)

	body := w.Body.String()
	if strings.Contains(body, "should-not-appear") {
		t.Error("password_hash should not appear in response")
	}
}

func TestUsers_Create_Success(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	token := createAdminToken(t, cfg, "admin-001", "admin")

	body := `{"login":"newuser","email":"newuser@test.com","password":"password123","role":"pro"}`
	req := httptest.NewRequest("POST", "/api/v1/admin/users", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleCreateUser))
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		OK   bool `json:"ok"`
		Data struct {
			ID    string `json:"id"`
			Login string `json:"login"`
			Email string `json:"email"`
			Role  string `json:"role"`
		} `json:"data"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.Login != "newuser" {
		t.Errorf("expected login newuser, got %s", resp.Data.Login)
	}
	if resp.Data.Email != "newuser@test.com" {
		t.Errorf("expected newuser@test.com, got %s", resp.Data.Email)
	}
	if resp.Data.Role != "pro" {
		t.Errorf("expected pro, got %s", resp.Data.Role)
	}

	var storedHash string
	err := db.QueryRow(`SELECT password_hash FROM users WHERE id = ?`, resp.Data.ID).Scan(&storedHash)
	if err != nil {
		t.Fatalf("query user: %v", err)
	}
	if storedHash == "" || strings.HasPrefix(storedHash, "$argon2id$") == false {
		t.Errorf("password should be argon2id hashed, got: %s", storedHash)
	}
	if strings.Contains(storedHash, "password123") {
		t.Error("plaintext password should not be stored")
	}
}

func TestUsers_Create_DuplicateLogin_409(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	token := createAdminToken(t, cfg, "admin-001", "admin")

	body := `{"login":"dup","email":"dup1@test.com","password":"password123","role":"free"}`
	req := httptest.NewRequest("POST", "/api/v1/admin/users", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleCreateUser))
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("first create: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	body2 := `{"login":"dup","email":"dup2@test.com","password":"password123","role":"free"}`
	req2 := httptest.NewRequest("POST", "/api/v1/admin/users", strings.NewReader(body2))
	req2.Header.Set("Authorization", "Bearer "+token)
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	handler2 := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleCreateUser))
	handler2.ServeHTTP(w2, req2)

	if w2.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w2.Code, w2.Body.String())
	}

	var errResp struct {
		OK  bool        `json:"ok"`
		Err *adminError `json:"error"`
	}
	json.NewDecoder(w2.Body).Decode(&errResp)
	if errResp.Err == nil || errResp.Err.Code != "LOGIN_EXISTS" {
		t.Errorf("expected LOGIN_EXISTS error, got %+v", errResp.Err)
	}
}

func TestUsers_Create_DuplicateEmail_409(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	token := createAdminToken(t, cfg, "admin-001", "admin")

	body := `{"login":"user1","email":"dup@test.com","password":"password123","role":"free"}`
	req := httptest.NewRequest("POST", "/api/v1/admin/users", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleCreateUser))
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("first create: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	body2 := `{"login":"user2","email":"dup@test.com","password":"password123","role":"free"}`
	req2 := httptest.NewRequest("POST", "/api/v1/admin/users", strings.NewReader(body2))
	req2.Header.Set("Authorization", "Bearer "+token)
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	handler2 := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleCreateUser))
	handler2.ServeHTTP(w2, req2)

	if w2.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w2.Code, w2.Body.String())
	}

	var errResp struct {
		OK  bool        `json:"ok"`
		Err *adminError `json:"error"`
	}
	json.NewDecoder(w2.Body).Decode(&errResp)
	if errResp.Err == nil || errResp.Err.Code != "USER_EXISTS" {
		t.Errorf("expected USER_EXISTS error, got %+v", errResp.Err)
	}
}

func TestUsers_UpdateRole_Success(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	_, err := db.Exec(`INSERT INTO users (id, email, nickname, password_hash, role, email_verified, created_at, updated_at)
		VALUES ('u1', 'updatable@test.com', 'Updatable', '$argon2id$v=19$m=65536,t=3,p=1$dummy', 'free', 1, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	token := createAdminToken(t, cfg, "admin-001", "admin")

	body := `{"role":"vip"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/users/u1", strings.NewReader(body))
	req.SetPathValue("id", "u1")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleUpdateUser))
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var storedRole string
	err = db.QueryRow(`SELECT role FROM users WHERE id = 'u1'`).Scan(&storedRole)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if storedRole != "vip" {
		t.Errorf("expected vip, got %s", storedRole)
	}
}

func TestUsers_Delete_Success(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	_, err := db.Exec(`INSERT INTO users (id, email, nickname, password_hash, role, email_verified, created_at, updated_at)
		VALUES ('u1', 'deletable@test.com', 'Deletable', '$argon2id$v=19$m=65536,t=3,p=1$dummy', 'free', 1, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	token := createAdminToken(t, cfg, "admin-001", "admin")

	req := httptest.NewRequest("DELETE", "/api/v1/admin/users/u1", nil)
	req.SetPathValue("id", "u1")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleDeleteUser))
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var count int
	err = db.QueryRow(`SELECT COUNT(*) FROM users WHERE id = 'u1'`).Scan(&count)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if count != 0 {
		t.Error("user should be deleted")
	}
}

func TestUsers_Delete_SelfNotAllowed(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	token := createAdminToken(t, cfg, "admin-self", "admin")

	req := httptest.NewRequest("DELETE", "/api/v1/admin/users/admin-self", nil)
	req.SetPathValue("id", "admin-self")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleDeleteUser))
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}

	var errResp struct {
		OK  bool        `json:"ok"`
		Err *adminError `json:"error"`
	}
	json.NewDecoder(w.Body).Decode(&errResp)
	if errResp.Err == nil || errResp.Err.Code != "SELF_DELETE" {
		t.Errorf("expected SELF_DELETE error, got %+v", errResp.Err)
	}
}

func TestUsers_Create_WithoutEmail_Placeholder(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	token := createAdminToken(t, cfg, "admin-001", "admin")

	body := `{"login":"nomaillogin","password":"password123","role":"free"}`
	req := httptest.NewRequest("POST", "/api/v1/admin/users", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleCreateUser))
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		OK   bool `json:"ok"`
		Data struct {
			ID    string `json:"id"`
			Login string `json:"login"`
			Email string `json:"email"`
			Role  string `json:"role"`
		} `json:"data"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.Email == "" || !strings.Contains(resp.Data.Email, "@placeholder.local") {
		t.Errorf("expected placeholder email, got %q", resp.Data.Email)
	}
	if resp.Data.Login != "nomaillogin" {
		t.Errorf("expected login nomaillogin, got %s", resp.Data.Login)
	}
}

func TestUsers_UpdateRole_InvalidRole_Guest(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	_, err := db.Exec(`INSERT INTO users (id, email, nickname, password_hash, role, email_verified, created_at, updated_at)
		VALUES ('u1', 'guestbound@test.com', 'GuestBound', '$argon2id$v=19$m=65536,t=3,p=1$dummy', 'free', 1, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	token := createAdminToken(t, cfg, "admin-001", "admin")

	body := `{"role":"guest"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/users/u1", strings.NewReader(body))
	req.SetPathValue("id", "u1")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleUpdateUser))
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}

	var errResp struct {
		OK  bool        `json:"ok"`
		Err *adminError `json:"error"`
	}
	json.NewDecoder(w.Body).Decode(&errResp)
	if errResp.Err == nil || errResp.Err.Code != "INVALID_ROLE" {
		t.Errorf("expected INVALID_ROLE error, got %+v", errResp.Err)
	}
}

func TestUsers_NoAuth_401(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())

	endpoints := []struct {
		method string
		path   string
		body   string
	}{
		{"GET", "/api/v1/admin/users", ""},
		{"POST", "/api/v1/admin/users", `{"email":"x@y.com","password":"password123","role":"free"}`},
		{"PATCH", "/api/v1/admin/users/u1", `{"role":"vip"}`},
		{"DELETE", "/api/v1/admin/users/u1", ""},
		{"GET", "/api/v1/admin/users/stats", ""},
	}

	for _, ep := range endpoints {
		var req *http.Request
		if ep.body != "" {
			req = httptest.NewRequest(ep.method, ep.path, strings.NewReader(ep.body))
			req.Header.Set("Content-Type", "application/json")
		} else {
			req = httptest.NewRequest(ep.method, ep.path, nil)
		}
		w := httptest.NewRecorder()
		handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(func(wr http.ResponseWriter, r *http.Request) {
			wr.WriteHeader(http.StatusOK)
		}))
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: expected 401, got %d", ep.method, ep.path, w.Code)
		}
	}
}

func TestUsers_NonAdmin_403(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	token := createAdminToken(t, cfg, "free-user", "free")

	endpoints := []struct {
		method string
		path   string
		body   string
	}{
		{"GET", "/api/v1/admin/users", ""},
		{"POST", "/api/v1/admin/users", `{"email":"x@y.com","password":"password123","role":"free"}`},
		{"PATCH", "/api/v1/admin/users/u1", `{"role":"vip"}`},
		{"DELETE", "/api/v1/admin/users/u1", ""},
		{"GET", "/api/v1/admin/users/stats", ""},
	}

	for _, ep := range endpoints {
		var req *http.Request
		if ep.body != "" {
			req = httptest.NewRequest(ep.method, ep.path, strings.NewReader(ep.body))
			req.Header.Set("Content-Type", "application/json")
		} else {
			req = httptest.NewRequest(ep.method, ep.path, nil)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(func(wr http.ResponseWriter, r *http.Request) {
			wr.WriteHeader(http.StatusOK)
		}))
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Errorf("%s %s: expected 403, got %d", ep.method, ep.path, w.Code)
		}
	}
}

func TestUsers_Stats_RegisteredCount(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	userIDs := []string{"u1", "u2", "u3"}
	for _, uid := range userIDs {
		_, err := db.Exec(`INSERT INTO users (id, email, nickname, password_hash, role, email_verified, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
			uid, uid+"@test.com", "User"+uid,
			"hash", "free",
			"2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z")
		if err != nil {
			t.Fatalf("insert user %s: %v", uid, err)
		}
	}

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	token := createAdminToken(t, cfg, "admin-001", "admin")

	req := httptest.NewRequest("GET", "/api/v1/admin/users/stats", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleGetUsersStats))
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		OK   bool `json:"ok"`
		Data struct {
			Registered int64 `json:"registered"`
			OnlineAuth int64 `json:"onlineAuth"`
			Hosts      int64 `json:"hosts"`
		} `json:"data"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.Registered != 3 {
		t.Errorf("expected 3 registered, got %d", resp.Data.Registered)
	}
}

func TestUsers_Stats_GuestTracking(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()

	mr.Set("guest:online:anon1", "1")
	mr.Set("guest:online:anon2", "1")
	mr.Set("guest:online:anon3", "1")

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	token := createAdminToken(t, cfg, "admin-001", "admin")

	req := httptest.NewRequest("GET", "/api/v1/admin/users/stats", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleGetUsersStats))
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		OK   bool `json:"ok"`
		Data struct {
			Registered int64 `json:"registered"`
			OnlineAuth int64 `json:"onlineAuth"`
			Hosts      int64 `json:"hosts"`
		} `json:"data"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.Registered != 0 {
		t.Errorf("expected 0 registered, got %d", resp.Data.Registered)
	}
	if resp.Data.OnlineAuth != 0 {
		t.Errorf("expected 0 onlineAuth, got %d", resp.Data.OnlineAuth)
	}
	if resp.Data.Hosts != 3 {
		t.Errorf("expected 3 hosts (3 guests, 0 auth), got %d", resp.Data.Hosts)
	}
}

func TestUsers_Stats_OnlineAuthFromSessions(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()

	mr.Set("chart_sessions:user1", "some-value")
	mr.Set("chart_sessions:user2", "some-value")

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	token := createAdminToken(t, cfg, "admin-001", "admin")

	req := httptest.NewRequest("GET", "/api/v1/admin/users/stats", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleGetUsersStats))
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		OK   bool `json:"ok"`
		Data struct {
			Registered int64 `json:"registered"`
			OnlineAuth int64 `json:"onlineAuth"`
			Hosts      int64 `json:"hosts"`
		} `json:"data"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.OnlineAuth != 2 {
		t.Errorf("expected 2 onlineAuth, got %d", resp.Data.OnlineAuth)
	}
}

func TestUsers_Create_AuditLogWritten(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	cfg := setupTestConfig()
	rdb, cleanup := setupTestRedis(t)
	defer cleanup()

	h := NewAdminHandler(db, cfg, nil, rdb, NewLogBuffer(100), NewMetricsHistory())
	token := createAdminToken(t, cfg, "admin-001", "admin")

	body := `{"login":"audit","email":"audit@test.com","password":"password123","role":"free"}`
	req := httptest.NewRequest("POST", "/api/v1/admin/users", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler := withAdminMiddleware(h.rl, h.authCfg, http.HandlerFunc(h.handleCreateUser))
	handler.ServeHTTP(w, req)

	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM admin_actions WHERE action = 'user.create'`).Scan(&count)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 audit log entry, got %d", count)
	}
}
