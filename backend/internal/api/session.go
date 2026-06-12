package api

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

var sessionLimits = map[string]int{
	"free":  1,
	"pro":   2,
	"vip":   2,
	"admin": -1,
}

const (
	heartbeatInterval = 10 * time.Second
	sessionTTL        = 30 * time.Second
)

var registerScript = redis.NewScript(`
local key = KEYS[1]
local sessionId = ARGV[1]
local now = ARGV[2]
local limit = tonumber(ARGV[3])
local threshold = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', tostring(tonumber(now) - tonumber(threshold)))

local count = redis.call('ZCARD', key)

if limit == -1 then
    redis.call('ZADD', key, now, sessionId)
    return {1, tostring(count + 1)}
end

if count < limit then
    redis.call('ZADD', key, now, sessionId)
    return {1, tostring(count + 1)}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
if #oldest >= 2 then
    redis.call('ZREM', key, oldest[1])
    redis.call('ZADD', key, now, sessionId)
    return {2, oldest[1]}
end

return {3, '0'}
`)

var heartbeatScript = redis.NewScript(`
local key = KEYS[1]
local sessionId = ARGV[1]
local now = ARGV[2]
local exists = redis.call('ZSCORE', key, sessionId)
if exists then
    redis.call('ZADD', key, now, sessionId)
    return 1
end
return 0
`)

var removeScript = redis.NewScript(`
local key = KEYS[1]
local sessionId = ARGV[1]
redis.call('ZREM', key, sessionId)
return 1
`)

type SessionManager struct {
	rdb    *redis.Client
	limits map[string]int
}

func NewSessionManager(rdb *redis.Client) *SessionManager {
	return &SessionManager{
		rdb:    rdb,
		limits: sessionLimits,
	}
}

func (sm *SessionManager) sessionKey(userId string) string {
	return fmt.Sprintf("chart_sessions:%s", userId)
}

func (sm *SessionManager) RegisterSession(ctx context.Context, userId, tier string, sessionId string) (RegisterResult, error) {
	if sessionId == "" {
		sessionId = uuid.New().String()
	}

	limit, ok := sm.limits[tier]
	if !ok {
		limit = 1
	}

	now := time.Now().UnixMilli()
	key := sm.sessionKey(userId)

	raw, err := registerScript.Run(ctx, sm.rdb, []string{key}, sessionId, now, limit, int64(sessionTTL.Seconds())).Slice()
	if err != nil {
		return RegisterResult{}, fmt.Errorf("register session: %w", err)
	}

	code := raw[0].(int64)
	res := RegisterResult{
		SessionID: sessionId,
		Code:      code,
	}

	switch code {
	case 1:
		res.Accepted = true
		log.Printf("[session] registered %s for user %s (count: %v)", sessionId, userId, raw[1])
	case 2:
		res.Accepted = true
		if evicted, ok := raw[1].(string); ok {
			res.EvictedID = evicted
		} else if evicted, ok := raw[1].([]byte); ok {
			res.EvictedID = string(evicted)
		}
		log.Printf("[session] evicted %s, registered %s for user %s", res.EvictedID, sessionId, userId)
	case 3:
		res.Accepted = false
		log.Printf("[session] rejected %s for user %s (limit: %d)", sessionId, userId, limit)
	}

	return res, nil
}

func (sm *SessionManager) Heartbeat(ctx context.Context, userId, sessionId string) bool {
	now := time.Now().UnixMilli()
	key := sm.sessionKey(userId)

	result, err := heartbeatScript.Run(ctx, sm.rdb, []string{key}, sessionId, now).Int()
	if err != nil {
		log.Printf("[session] heartbeat error: %v", err)
		return false
	}
	return result == 1
}

func (sm *SessionManager) RemoveSession(ctx context.Context, userId, sessionId string) {
	key := sm.sessionKey(userId)
	_, err := removeScript.Run(ctx, sm.rdb, []string{key}, sessionId).Result()
	if err != nil {
		log.Printf("[session] remove error: %v", err)
	}
}

func (sm *SessionManager) CountSessions(ctx context.Context, userId string) (int, error) {
	key := sm.sessionKey(userId)
	count, err := sm.rdb.ZCard(ctx, key).Result()
	if err != nil {
		return 0, fmt.Errorf("count sessions: %w", err)
	}
	return int(count), nil
}

type RegisterResult struct {
	SessionID string
	Accepted  bool
	Code      int64
	EvictedID string
}
