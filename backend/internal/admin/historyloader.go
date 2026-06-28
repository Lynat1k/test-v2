package admin

import (
	"archive/zip"
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/procluster/procluster/internal/aggregation"
	"github.com/procluster/procluster/internal/model"
	"golang.org/x/net/proxy"
)

type DownloadJob struct {
	ID          string     `json:"id"`
	Symbol      string     `json:"symbol"`
	Market      string     `json:"market"`
	StartDate   string     `json:"startDate"`
	EndDate     string     `json:"endDate"`
	DataType    string     `json:"dataType"` // "clusters" (default) | "bookDepth"
	Status      string     `json:"status"`
	Progress    float64    `json:"progress"`
	StepDetail  string     `json:"stepDetail"`
	Error       string     `json:"error"`
	TotalTicks  int64      `json:"totalTicks"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
}

type HistoryClickHouse interface {
	DeleteClustersByRange(ctx context.Context, table, symbol, timeframe string, from, to time.Time) error
	InsertClusterBatch(ctx context.Context, rows []model.ClusterRow, table string) error
	InsertBookDepthRatioBatch(ctx context.Context, rows []model.BookDepthRatio) error
	InsertLongShortRatioBatch(ctx context.Context, rows []model.LongShortRatio) error
}

type JobRegistry struct {
	mu          sync.RWMutex
	jobs        map[string]*DownloadJob
	db          *sql.DB
	cancelFuncs map[string]context.CancelFunc
	cleared     bool
}

func NewJobRegistry(db *sql.DB) *JobRegistry {
	r := &JobRegistry{
		jobs:        make(map[string]*DownloadJob),
		db:          db,
		cancelFuncs: make(map[string]context.CancelFunc),
	}
	r.ensureTable()
	return r
}

func (r *JobRegistry) ensureTable() {
	ddl := `CREATE TABLE IF NOT EXISTS download_jobs (
		id TEXT PRIMARY KEY,
		symbol TEXT NOT NULL,
		market TEXT NOT NULL,
		start_date TEXT NOT NULL,
		end_date TEXT NOT NULL,
		data_type TEXT NOT NULL DEFAULT 'clusters',
		status TEXT NOT NULL DEFAULT 'pending',
		progress REAL NOT NULL DEFAULT 0,
		step_detail TEXT NOT NULL DEFAULT '',
		error TEXT NOT NULL DEFAULT '',
		total_ticks INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL,
		completed_at DATETIME
	)`
	if _, err := r.db.Exec(ddl); err != nil {
		log.Printf("[jobregistry] ensure table: %v", err)
	}
	// Idempotent column add for DBs created before data_type existed.
	// Duplicate-column error on existing schemas is expected — ignore it.
	if _, err := r.db.Exec(`ALTER TABLE download_jobs ADD COLUMN data_type TEXT NOT NULL DEFAULT 'clusters'`); err != nil &&
		!strings.Contains(err.Error(), "duplicate column") {
		log.Printf("[jobregistry] add data_type column: %v", err)
	}
}

// CreateJob registers a new download job. dataType is optional (trailing variadic
// for backward compatibility): empty or omitted → "clusters".
func (r *JobRegistry) CreateJob(symbol, market, startDate, endDate string, dataType ...string) *DownloadJob {
	dt := "clusters"
	if len(dataType) > 0 && strings.TrimSpace(dataType[0]) != "" {
		dt = dataType[0]
	}

	now := time.Now().UTC()
	job := &DownloadJob{
		ID:        uuid.New().String(),
		Symbol:    symbol,
		Market:    market,
		StartDate: startDate,
		EndDate:   endDate,
		DataType:  dt,
		Status:    "pending",
		CreatedAt: now,
		UpdatedAt: now,
	}

	r.mu.Lock()
	r.jobs[job.ID] = job
	r.cleared = false
	r.mu.Unlock()

	_, err := r.db.Exec(
		`INSERT INTO download_jobs (id, symbol, market, start_date, end_date, data_type, status, progress, step_detail, error, total_ticks, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		job.ID, job.Symbol, job.Market, job.StartDate, job.EndDate, job.DataType,
		job.Status, job.Progress, job.StepDetail, job.Error, job.TotalTicks,
		job.CreatedAt, job.UpdatedAt,
	)
	if err != nil {
		log.Printf("[jobregistry] create job db: %v", err)
	}

	return job
}

func (r *JobRegistry) GetJob(id string) (*DownloadJob, bool) {
	r.mu.RLock()
	job, ok := r.jobs[id]
	r.mu.RUnlock()
	if ok {
		return job, true
	}

	job = &DownloadJob{}
	var createdAt, updatedAt string
	var completedAt sql.NullString
	err := r.db.QueryRow(
		`SELECT id, symbol, market, start_date, end_date, data_type, status, progress, step_detail, error, total_ticks, created_at, updated_at, completed_at
		 FROM download_jobs WHERE id = ?`, id,
	).Scan(
		&job.ID, &job.Symbol, &job.Market, &job.StartDate, &job.EndDate, &job.DataType,
		&job.Status, &job.Progress, &job.StepDetail, &job.Error, &job.TotalTicks,
		&createdAt, &updatedAt, &completedAt,
	)
	if err != nil {
		return nil, false
	}

	job.CreatedAt = parseTime(createdAt)
	job.UpdatedAt = parseTime(updatedAt)
	if completedAt.Valid {
		t := parseTime(completedAt.String)
		job.CompletedAt = &t
	}

	r.mu.Lock()
	r.jobs[job.ID] = job
	r.mu.Unlock()

	return job, true
}

func (r *JobRegistry) ListJobs() []*DownloadJob {
	rows, err := r.db.Query(
		`SELECT id, symbol, market, start_date, end_date, data_type, status, progress, step_detail, error, total_ticks, created_at, updated_at, completed_at
		 FROM download_jobs ORDER BY created_at DESC`,
	)
	if err != nil {
		log.Printf("[jobregistry] list jobs db: %v", err)
		return nil
	}
	defer rows.Close()

	var jobs []*DownloadJob
	for rows.Next() {
		job := &DownloadJob{}
		var createdAt, updatedAt string
		var completedAt sql.NullString
		if err := rows.Scan(
			&job.ID, &job.Symbol, &job.Market, &job.StartDate, &job.EndDate, &job.DataType,
			&job.Status, &job.Progress, &job.StepDetail, &job.Error, &job.TotalTicks,
			&createdAt, &updatedAt, &completedAt,
		); err != nil {
			log.Printf("[jobregistry] list scan: %v", err)
			continue
		}
		job.CreatedAt = parseTime(createdAt)
		job.UpdatedAt = parseTime(updatedAt)
		if completedAt.Valid {
			t := parseTime(completedAt.String)
			job.CompletedAt = &t
		}
		jobs = append(jobs, job)
	}

	return jobs
}

func (r *JobRegistry) UpdateJob(job *DownloadJob) {
	job.UpdatedAt = time.Now().UTC()

	r.mu.Lock()
	cleared := r.cleared
	if !cleared {
		r.jobs[job.ID] = job
	}
	r.mu.Unlock()

	if cleared {
		return
	}

	_, err := r.db.Exec(
		`UPDATE download_jobs SET status=?, progress=?, step_detail=?, error=?, total_ticks=?, updated_at=?, completed_at=? WHERE id=?`,
		job.Status, job.Progress, job.StepDetail, job.Error, job.TotalTicks,
		job.UpdatedAt, job.CompletedAt, job.ID,
	)
	if err != nil {
		log.Printf("[jobregistry] update job db: %v", err)
	}
}

func (r *JobRegistry) StartDownload(chRepo HistoryClickHouse, tickerSymbol string, config aggregation.CompressionConfig, job *DownloadJob) {
	workerCtx, cancel := context.WithCancel(context.Background())
	r.mu.Lock()
	r.cancelFuncs[job.ID] = cancel
	r.mu.Unlock()
	go r.downloadWorker(workerCtx, chRepo, config, job)
}

func (r *JobRegistry) ClearJobs() {
	r.mu.Lock()
	for _, cancel := range r.cancelFuncs {
		cancel()
	}
	r.jobs = make(map[string]*DownloadJob)
	r.cancelFuncs = make(map[string]context.CancelFunc)
	r.cleared = true
	r.mu.Unlock()

	if _, err := r.db.Exec(`DELETE FROM download_jobs`); err != nil {
		log.Printf("[jobregistry] clear jobs db: %v", err)
	}
}

func (r *JobRegistry) CancelJob(id string) {
	r.mu.Lock()
	cancel, ok := r.cancelFuncs[id]
	delete(r.cancelFuncs, id)
	r.mu.Unlock()
	if ok {
		cancel()
	}
}

func (r *JobRegistry) downloadWorker(ctx context.Context, chRepo HistoryClickHouse, config aggregation.CompressionConfig, job *DownloadJob) {
	defer func() {
		r.mu.Lock()
		delete(r.cancelFuncs, job.ID)
		r.mu.Unlock()
	}()
	defer func() {
		if rec := recover(); rec != nil {
			log.Printf("[download] panic recovered: %v", rec)
			job.Status = "failed"
			job.Error = fmt.Sprintf("panic: %v", rec)
			now := time.Now().UTC()
			job.CompletedAt = &now
			r.UpdateJob(job)
		}
	}()

	// bookDepth history goes through a dedicated path (no trade aggregation).
	if job.DataType == "bookDepth" {
		r.downloadWorkerBookDepth(ctx, chRepo, job)
		return
	}

	// longShortRatio history: daily metrics dumps, no trade aggregation.
	if job.DataType == "longShortRatio" {
		r.downloadWorkerLongShort(ctx, chRepo, job)
		return
	}

	startDate, err := time.Parse("2006-01-02", job.StartDate)
	if err != nil {
		job.Status = "failed"
		job.Error = fmt.Sprintf("invalid start date: %v", err)
		now := time.Now().UTC()
		job.CompletedAt = &now
		r.UpdateJob(job)
		return
	}

	endDate, err := time.Parse("2006-01-02", job.EndDate)
	if err != nil {
		job.Status = "failed"
		job.Error = fmt.Sprintf("invalid end date: %v", err)
		now := time.Now().UTC()
		job.CompletedAt = &now
		r.UpdateJob(job)
		return
	}

	totalDays := int(endDate.Sub(startDate).Hours()/24) + 1
	successfulDays := 0
	skippedDays := 0

	table := "clusters_futures"
	if job.Market == "spot" {
		table = "clusters_spot"
	}

	tmpDir, err := os.MkdirTemp("", "procluster-dl-*")
	if err != nil {
		job.Status = "failed"
		job.Error = fmt.Sprintf("create temp dir: %v", err)
		now := time.Now().UTC()
		job.CompletedAt = &now
		r.UpdateJob(job)
		return
	}
	defer os.RemoveAll(tmpDir)

	for dayIdx := 0; dayIdx < totalDays; dayIdx++ {
		select {
		case <-ctx.Done():
			job.Status = "failed"
			job.Error = "context cancelled"
			now := time.Now().UTC()
			job.CompletedAt = &now
			r.UpdateJob(job)
			return
		default:
		}

		date := startDate.AddDate(0, 0, dayIdx)
		if date.After(endDate) {
			break
		}

		dateStr := date.Format("2006-01-02")
		dayStart := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, time.UTC)
		dayEnd := time.Date(date.Year(), date.Month(), date.Day(), 23, 59, 59, 999999999, time.UTC)

		// Step 1: downloading with retries
		job.Status = "downloading"
		job.Progress = float64(dayIdx*4) / float64(totalDays*4) * 100
		r.UpdateJob(job)

		url := buildDownloadURL(job.Market, job.Symbol, date)
		zipPath := tmpDir + "/" + job.Symbol + "-aggTrades-" + dateStr + ".zip"

		if err := r.downloadFileWithRetries(ctx, url, zipPath, dayIdx+1, totalDays, dateStr, job); err != nil {
			skippedDays++
			continue
		}

		// Step 2: parsing
		job.Status = "parsing"
		job.StepDetail = fmt.Sprintf("Day %d/%d: parsing trades...", dayIdx+1, totalDays)
		job.Progress = float64(dayIdx*4+1) / float64(totalDays*4) * 100
		r.UpdateJob(job)

		trades, err := unzipAndParse(zipPath, job.Symbol, job.Market)
		os.Remove(zipPath)
		if err != nil {
			log.Printf("[download] %s: parse error (skipping): %v", dateStr, err)
			skippedDays++
			continue
		}

		if len(trades) == 0 {
			log.Printf("[download] %s: no trades, skipping", dateStr)
			skippedDays++
			continue
		}

		log.Printf("[download] %s: parsed %d trades", dateStr, len(trades))

		// Step 3: aggregating
		job.Status = "aggregating"
		job.StepDetail = fmt.Sprintf("Day %d/%d: aggregating %d trades into clusters...", dayIdx+1, totalDays, len(trades))
		job.Progress = float64(dayIdx*4+2) / float64(totalDays*4) * 100
		r.UpdateJob(job)

		minuteBuckets := make(map[time.Time][]model.Trade)
		for _, t := range trades {
			minute := t.Time.Truncate(time.Minute)
			minuteBuckets[minute] = append(minuteBuckets[minute], t)
		}

		compConfig := aggregation.CompressionConfig{
			Symbol:    config.Symbol,
			PriceTick: config.PriceTick,
			BaseLevel: config.BaseLevel,
			MaxLevels: config.MaxLevels,
		}

		var allRows1m []model.ClusterRow
		for minute, minuteTrades := range minuteBuckets {
			rows := aggregation.CompressTrades(minuteTrades, compConfig)

			var openPrice, closePrice float64
			if len(minuteTrades) > 0 {
				first, last := minuteTrades[0], minuteTrades[len(minuteTrades)-1]
				openPrice = first.Price
				closePrice = last.Price
			}

			for i := range rows {
				rows[i].Symbol = job.Symbol
				rows[i].Timeframe = "1m"
				rows[i].CandleOpen = minute
				rows[i].Compression = uint16(config.BaseLevel)
				rows[i].OpenPrice = openPrice
				rows[i].ClosePrice = closePrice
			}

			allRows1m = append(allRows1m, rows...)
		}
		log.Printf("[download] %s: %d minute buckets -> %d 1m cluster rows from %d trades", dateStr, len(minuteBuckets), len(allRows1m), len(trades))

		if len(allRows1m) == 0 {
			log.Printf("[download] %s: WARNING no 1m cluster rows built from %d trades, skipping day", dateStr, len(trades))
			skippedDays++
			continue
		}

		// Step 4: inserting
		job.Status = "inserting"
		job.StepDetail = fmt.Sprintf("Day %d/%d: inserting %d rows into ClickHouse...", dayIdx+1, totalDays, len(allRows1m))
		job.Progress = float64(dayIdx*4+3) / float64(totalDays*4) * 100
		r.UpdateJob(job)

		log.Printf("[download] %s: deleting range [%v, %v] for 1m, then inserting %d rows", dateStr, dayStart, dayEnd, len(allRows1m))

		if err := chRepo.DeleteClustersByRange(ctx, table, job.Symbol, "1m", dayStart, dayEnd); err != nil {
			log.Printf("[download] %s: delete 1m error: %v", dateStr, err)
			job.Status = "failed"
			job.Error = fmt.Sprintf("delete 1m for %s: %v", dateStr, err)
			now := time.Now().UTC()
			job.CompletedAt = &now
			r.UpdateJob(job)
			return
		}

		if err := chRepo.InsertClusterBatch(ctx, allRows1m, table); err != nil {
			log.Printf("[download] %s: insert 1m error: %v", dateStr, err)
			job.Status = "failed"
			job.Error = fmt.Sprintf("insert 1m for %s: %v", dateStr, err)
			now := time.Now().UTC()
			job.CompletedAt = &now
			r.UpdateJob(job)
			return
		}

		log.Printf("[download] %s: inserted %d rows into %s (1m)", dateStr, len(allRows1m), table)
		dayTicks := int64(len(allRows1m))
		job.TotalTicks += dayTicks

		rollupRows := aggregation.Rollup(allRows1m)
		rollupByTf := make(map[string][]model.ClusterRow)
		for _, row := range rollupRows {
			rollupByTf[row.Timeframe] = append(rollupByTf[row.Timeframe], row)
		}

		log.Printf("[download] %s: rollup totals per tf: 1m=%d", dateStr, len(allRows1m))
		for tf, tfRows := range rollupByTf {
			log.Printf("[download] %s: rollup %s=%d rows", dateStr, tf, len(tfRows))
		}

		for tf, tfRows := range rollupByTf {
			if len(tfRows) == 0 {
				continue
			}

			if err := chRepo.DeleteClustersByRange(ctx, table, job.Symbol, tf, dayStart, dayEnd); err != nil {
				log.Printf("[download] %s: delete %s error: %v", dateStr, tf, err)
				continue
			}

			if err := chRepo.InsertClusterBatch(ctx, tfRows, table); err != nil {
				log.Printf("[download] %s: insert %s error: %v", dateStr, tf, err)
				continue
			}

			log.Printf("[download] %s: inserted %d rows into %s (%s)", dateStr, len(tfRows), table, tf)
			job.TotalTicks += int64(len(tfRows))
		}

		successfulDays++
	}

	// Final status
	now := time.Now().UTC()
	job.CompletedAt = &now
	job.Progress = 100

	if successfulDays == 0 && job.TotalTicks == 0 {
		job.Status = "failed"
		job.Error = "failed to download any days: all days skipped or produced 0 cluster rows"
		job.StepDetail = fmt.Sprintf("0/%d days downloaded, %d skipped", totalDays, skippedDays)
	} else if skippedDays > 0 {
		job.Status = "completed"
		job.StepDetail = fmt.Sprintf("completed: %d/%d days, %d skipped", successfulDays, totalDays, skippedDays)
		if job.Error == "" {
			job.Error = fmt.Sprintf("%d days were skipped (download or parse errors)", skippedDays)
		}
	} else {
		job.Status = "completed"
		job.StepDetail = fmt.Sprintf("All %d days processed successfully", totalDays)
		job.Error = ""
	}

	r.UpdateJob(job)
}

var buildDownloadURL = func(market, symbol string, date time.Time) string {
	dateStr := date.Format("2006-01-02")
	if market == "futures" {
		return fmt.Sprintf("https://data.binance.vision/data/futures/um/daily/aggTrades/%s/%s-aggTrades-%s.zip", symbol, symbol, dateStr)
	}
	return fmt.Sprintf("https://data.binance.vision/data/spot/daily/aggTrades/%s/%s-aggTrades-%s.zip", symbol, symbol, dateStr)
}

// buildBookDepthURL builds the daily bookDepth archive URL. bookDepth dumps exist
// only for USDⓂ futures on data.binance.vision.
var buildBookDepthURL = func(symbol string, date time.Time) string {
	dateStr := date.Format("2006-01-02")
	return fmt.Sprintf("https://data.binance.vision/data/futures/um/daily/bookDepth/%s/%s-bookDepth-%s.zip", symbol, symbol, dateStr)
}

// buildMetricsURL builds the daily metrics archive URL. metrics dumps (which carry
// the global long/short account ratio) exist only for USDⓂ futures.
var buildMetricsURL = func(symbol string, date time.Time) string {
	dateStr := date.Format("2006-01-02")
	return fmt.Sprintf("https://data.binance.vision/data/futures/um/daily/metrics/%s/%s-metrics-%s.zip", symbol, symbol, dateStr)
}

// downloadWorkerBookDepth backfills bookdepth_ratio from daily bookDepth archives.
// Steps per day: downloading → parsing → inserting (no aggregation). Idempotency is
// provided by the ReplacingMergeTree engine — re-running a range overwrites rows by
// (symbol, market, snapshot_ts), so no pre-delete is needed.
func (r *JobRegistry) downloadWorkerBookDepth(ctx context.Context, chRepo HistoryClickHouse, job *DownloadJob) {
	startDate, err := time.Parse("2006-01-02", job.StartDate)
	if err != nil {
		r.failJob(job, fmt.Sprintf("invalid start date: %v", err))
		return
	}
	endDate, err := time.Parse("2006-01-02", job.EndDate)
	if err != nil {
		r.failJob(job, fmt.Sprintf("invalid end date: %v", err))
		return
	}

	totalDays := int(endDate.Sub(startDate).Hours()/24) + 1
	successfulDays := 0
	skippedDays := 0

	tmpDir, err := os.MkdirTemp("", "procluster-bd-*")
	if err != nil {
		r.failJob(job, fmt.Sprintf("create temp dir: %v", err))
		return
	}
	defer os.RemoveAll(tmpDir)

	for dayIdx := 0; dayIdx < totalDays; dayIdx++ {
		select {
		case <-ctx.Done():
			r.failJob(job, "context cancelled")
			return
		default:
		}

		date := startDate.AddDate(0, 0, dayIdx)
		if date.After(endDate) {
			break
		}
		dateStr := date.Format("2006-01-02")

		// Step 1: downloading (3 steps per day → dayIdx*3)
		job.Status = "downloading"
		job.Progress = float64(dayIdx*3) / float64(totalDays*3) * 100
		r.UpdateJob(job)

		url := buildBookDepthURL(job.Symbol, date)
		zipPath := tmpDir + "/" + job.Symbol + "-bookDepth-" + dateStr + ".zip"
		if err := r.downloadFileWithRetries(ctx, url, zipPath, dayIdx+1, totalDays, dateStr, job); err != nil {
			skippedDays++
			continue
		}

		// Step 2: parsing
		job.Status = "parsing"
		job.StepDetail = fmt.Sprintf("Day %d/%d: parsing bookDepth...", dayIdx+1, totalDays)
		job.Progress = float64(dayIdx*3+1) / float64(totalDays*3) * 100
		r.UpdateJob(job)

		rows, skippedMinutes, err := unzipAndParseBookDepth(zipPath, job.Symbol)
		os.Remove(zipPath)
		if err != nil {
			log.Printf("[download] %s: bookDepth parse error (skipping): %v", dateStr, err)
			skippedDays++
			continue
		}
		if skippedMinutes > 0 {
			log.Printf("[download] %s: bookDepth %d minutes skipped (incomplete ±1/3/5%% levels)", dateStr, skippedMinutes)
		}
		if len(rows) == 0 {
			log.Printf("[download] %s: bookDepth produced 0 rows, skipping", dateStr)
			skippedDays++
			continue
		}
		log.Printf("[download] %s: bookDepth parsed %d minute rows", dateStr, len(rows))

		// Step 3: inserting (ReplacingMergeTree → idempotent, no delete)
		job.Status = "inserting"
		job.StepDetail = fmt.Sprintf("Day %d/%d: inserting %d rows into bookdepth_ratio...", dayIdx+1, totalDays, len(rows))
		job.Progress = float64(dayIdx*3+2) / float64(totalDays*3) * 100
		r.UpdateJob(job)

		if err := chRepo.InsertBookDepthRatioBatch(ctx, rows); err != nil {
			log.Printf("[download] %s: bookDepth insert error: %v", dateStr, err)
			r.failJob(job, fmt.Sprintf("insert bookDepth for %s: %v", dateStr, err))
			return
		}
		log.Printf("[download] %s: inserted %d rows into bookdepth_ratio", dateStr, len(rows))
		job.TotalTicks += int64(len(rows))
		successfulDays++
	}

	now := time.Now().UTC()
	job.CompletedAt = &now
	job.Progress = 100
	switch {
	case successfulDays == 0 && job.TotalTicks == 0:
		job.Status = "failed"
		job.Error = "failed to download any days: all days skipped or produced 0 bookDepth rows"
		job.StepDetail = fmt.Sprintf("0/%d days downloaded, %d skipped", totalDays, skippedDays)
	case skippedDays > 0:
		job.Status = "completed"
		job.StepDetail = fmt.Sprintf("completed: %d/%d days, %d skipped", successfulDays, totalDays, skippedDays)
		if job.Error == "" {
			job.Error = fmt.Sprintf("%d days were skipped (download or parse errors)", skippedDays)
		}
	default:
		job.Status = "completed"
		job.StepDetail = fmt.Sprintf("All %d days processed successfully", totalDays)
		job.Error = ""
	}
	r.UpdateJob(job)
}

// downloadWorkerLongShort backfills long_short_ratio from daily metrics archives.
// Steps per day: downloading → parsing → inserting (no aggregation). Idempotency is
// provided by the ReplacingMergeTree engine — re-running a range overwrites rows by
// (symbol, market, ts), so no pre-delete is needed.
func (r *JobRegistry) downloadWorkerLongShort(ctx context.Context, chRepo HistoryClickHouse, job *DownloadJob) {
	startDate, err := time.Parse("2006-01-02", job.StartDate)
	if err != nil {
		r.failJob(job, fmt.Sprintf("invalid start date: %v", err))
		return
	}
	endDate, err := time.Parse("2006-01-02", job.EndDate)
	if err != nil {
		r.failJob(job, fmt.Sprintf("invalid end date: %v", err))
		return
	}

	totalDays := int(endDate.Sub(startDate).Hours()/24) + 1
	successfulDays := 0
	skippedDays := 0

	tmpDir, err := os.MkdirTemp("", "procluster-lsr-*")
	if err != nil {
		r.failJob(job, fmt.Sprintf("create temp dir: %v", err))
		return
	}
	defer os.RemoveAll(tmpDir)

	for dayIdx := 0; dayIdx < totalDays; dayIdx++ {
		select {
		case <-ctx.Done():
			r.failJob(job, "context cancelled")
			return
		default:
		}

		date := startDate.AddDate(0, 0, dayIdx)
		if date.After(endDate) {
			break
		}
		dateStr := date.Format("2006-01-02")

		// Step 1: downloading (3 steps per day → dayIdx*3)
		job.Status = "downloading"
		job.Progress = float64(dayIdx*3) / float64(totalDays*3) * 100
		r.UpdateJob(job)

		url := buildMetricsURL(job.Symbol, date)
		zipPath := tmpDir + "/" + job.Symbol + "-metrics-" + dateStr + ".zip"
		if err := r.downloadFileWithRetries(ctx, url, zipPath, dayIdx+1, totalDays, dateStr, job); err != nil {
			skippedDays++
			continue
		}

		// Step 2: parsing
		job.Status = "parsing"
		job.StepDetail = fmt.Sprintf("Day %d/%d: parsing metrics...", dayIdx+1, totalDays)
		job.Progress = float64(dayIdx*3+1) / float64(totalDays*3) * 100
		r.UpdateJob(job)

		rows, skippedLines, err := unzipAndParseMetricsLongShort(zipPath, job.Symbol)
		os.Remove(zipPath)
		if err != nil {
			log.Printf("[download] %s: metrics parse error (skipping): %v", dateStr, err)
			skippedDays++
			continue
		}
		if skippedLines > 0 {
			log.Printf("[download] %s: metrics %d rows skipped (empty/bad ratio)", dateStr, skippedLines)
		}
		if len(rows) == 0 {
			log.Printf("[download] %s: metrics produced 0 rows, skipping", dateStr)
			skippedDays++
			continue
		}
		log.Printf("[download] %s: metrics parsed %d long/short rows", dateStr, len(rows))

		// Step 3: inserting (ReplacingMergeTree → idempotent, no delete)
		job.Status = "inserting"
		job.StepDetail = fmt.Sprintf("Day %d/%d: inserting %d rows into long_short_ratio...", dayIdx+1, totalDays, len(rows))
		job.Progress = float64(dayIdx*3+2) / float64(totalDays*3) * 100
		r.UpdateJob(job)

		if err := chRepo.InsertLongShortRatioBatch(ctx, rows); err != nil {
			log.Printf("[download] %s: long/short insert error: %v", dateStr, err)
			r.failJob(job, fmt.Sprintf("insert long/short for %s: %v", dateStr, err))
			return
		}
		log.Printf("[download] %s: inserted %d rows into long_short_ratio", dateStr, len(rows))
		job.TotalTicks += int64(len(rows))
		successfulDays++
	}

	now := time.Now().UTC()
	job.CompletedAt = &now
	job.Progress = 100
	switch {
	case successfulDays == 0 && job.TotalTicks == 0:
		job.Status = "failed"
		job.Error = "failed to download any days: all days skipped or produced 0 long/short rows"
		job.StepDetail = fmt.Sprintf("0/%d days downloaded, %d skipped", totalDays, skippedDays)
	case skippedDays > 0:
		job.Status = "completed"
		job.StepDetail = fmt.Sprintf("completed: %d/%d days, %d skipped", successfulDays, totalDays, skippedDays)
		if job.Error == "" {
			job.Error = fmt.Sprintf("%d days were skipped (download or parse errors)", skippedDays)
		}
	default:
		job.Status = "completed"
		job.StepDetail = fmt.Sprintf("All %d days processed successfully", totalDays)
		job.Error = ""
	}
	r.UpdateJob(job)
}

func unzipAndParseMetricsLongShort(zipPath, symbol string) ([]model.LongShortRatio, int, error) {
	fi, err := os.Stat(zipPath)
	if err != nil {
		return nil, 0, fmt.Errorf("stat zip: %w", err)
	}

	zr, err := zip.NewReader(mustOpenFile(zipPath), fi.Size())
	if err != nil {
		return nil, 0, fmt.Errorf("open zip: %w", err)
	}
	if len(zr.File) == 0 {
		return nil, 0, fmt.Errorf("zip archive is empty")
	}

	rc, err := zr.File[0].Open()
	if err != nil {
		return nil, 0, fmt.Errorf("open csv in zip: %w", err)
	}
	defer rc.Close()

	return parseMetricsLongShortCSV(rc, symbol)
}

// parseMetricsLongShortCSV parses a daily metrics CSV (header + ~288 rows). Column
// indices are resolved by NAME from the header (create_time, count_long_short_ratio)
// because column order may change across periods. count_long_short_ratio is the
// GLOBAL account long/short ratio. create_time is "YYYY-MM-DD HH:MM:SS" UTC. Rows with
// an empty/unparseable ratio are skipped; the second return value is the skip count.
func parseMetricsLongShortCSV(reader io.Reader, symbol string) ([]model.LongShortRatio, int, error) {
	cr := csv.NewReader(reader)
	cr.LazyQuotes = true
	cr.FieldsPerRecord = -1

	header, err := cr.Read()
	if err != nil {
		return nil, 0, fmt.Errorf("read metrics header: %w", err)
	}

	tsIdx, ratioIdx := -1, -1
	for i, col := range header {
		switch strings.ToLower(strings.TrimSpace(col)) {
		case "create_time":
			tsIdx = i
		case "count_long_short_ratio":
			ratioIdx = i
		}
	}
	if tsIdx < 0 || ratioIdx < 0 {
		return nil, 0, fmt.Errorf("metrics CSV missing required columns (create_time idx=%d, count_long_short_ratio idx=%d)", tsIdx, ratioIdx)
	}

	maxIdx := tsIdx
	if ratioIdx > maxIdx {
		maxIdx = ratioIdx
	}

	var rows []model.LongShortRatio
	skipped := 0
	lineNum := 1 // header already consumed
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		lineNum++
		if err != nil {
			log.Printf("[metrics csv] line %d: read error: %v, skipping", lineNum, err)
			skipped++
			continue
		}
		if len(rec) <= maxIdx {
			skipped++
			continue
		}

		ts, perr := parseBookDepthTimestamp(strings.TrimSpace(rec[tsIdx]))
		if perr != nil {
			skipped++
			continue
		}

		ratioRaw := strings.TrimSpace(rec[ratioIdx])
		ratio, ferr := strconv.ParseFloat(ratioRaw, 64)
		if ferr != nil || ratio <= 0 {
			skipped++
			continue
		}

		rows = append(rows, model.LongShortRatio{
			Symbol: symbol,
			Market: "futures",
			TS:     ts,
			Ratio:  ratio,
		})
	}

	sort.Slice(rows, func(i, j int) bool { return rows[i].TS.Before(rows[j].TS) })
	return rows, skipped, nil
}

// failJob marks a job failed with the given error and a completion timestamp.
func (r *JobRegistry) failJob(job *DownloadJob, errMsg string) {
	job.Status = "failed"
	job.Error = errMsg
	now := time.Now().UTC()
	job.CompletedAt = &now
	r.UpdateJob(job)
}

func unzipAndParseBookDepth(zipPath, symbol string) ([]model.BookDepthRatio, int, error) {
	fi, err := os.Stat(zipPath)
	if err != nil {
		return nil, 0, fmt.Errorf("stat zip: %w", err)
	}

	zr, err := zip.NewReader(mustOpenFile(zipPath), fi.Size())
	if err != nil {
		return nil, 0, fmt.Errorf("open zip: %w", err)
	}
	if len(zr.File) == 0 {
		return nil, 0, fmt.Errorf("zip archive is empty")
	}

	rc, err := zr.File[0].Open()
	if err != nil {
		return nil, 0, fmt.Errorf("open csv in zip: %w", err)
	}
	defer rc.Close()

	return parseBookDepthCSV(rc, symbol)
}

// bookDepthAcc accumulates the six depth bands for a single timestamp (minute).
type bookDepthAcc struct {
	ts                                         time.Time
	bid1, bid3, bid5, ask1, ask3, ask5         float64
	has1n, has3n, has5n, has1p, has3p, has5p   bool
}

// parseBookDepthCSV parses a bookDepth daily CSV (timestamp,percentage,depth,notional).
// Rows are grouped by timestamp; each group yields one BookDepthRatio mapping
// percentage → band (-1/-3/-5 = bid, 1/3/5 = ask). Returns the rows plus a count of
// minutes skipped because one of the six bands was missing. Unknown percentages are
// ignored. depth volumes are truncated to 1 decimal at insert time (InsertBookDepthRatioBatch).
func parseBookDepthCSV(reader io.Reader, symbol string) ([]model.BookDepthRatio, int, error) {
	cr := csv.NewReader(reader)
	cr.LazyQuotes = true
	cr.FieldsPerRecord = -1

	groups := make(map[string]*bookDepthAcc)
	var order []string

	lineNum := 0
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		lineNum++
		if err != nil {
			log.Printf("[bookDepth csv] line %d: read error: %v, skipping", lineNum, err)
			continue
		}
		if len(rec) < 4 {
			continue
		}
		if lineNum == 1 && looksLikeBookDepthHeader(rec) {
			continue
		}

		tsRaw := strings.TrimSpace(rec[0])
		pctF, err := strconv.ParseFloat(strings.TrimSpace(rec[1]), 64)
		if err != nil {
			continue
		}
		depth, err := strconv.ParseFloat(strings.TrimSpace(rec[2]), 64)
		if err != nil {
			continue
		}

		g, ok := groups[tsRaw]
		if !ok {
			ts, perr := parseBookDepthTimestamp(tsRaw)
			if perr != nil {
				continue
			}
			g = &bookDepthAcc{ts: ts}
			groups[tsRaw] = g
			order = append(order, tsRaw)
		}

		switch int(math.Round(pctF)) {
		case -1:
			g.bid1, g.has1n = depth, true
		case -3:
			g.bid3, g.has3n = depth, true
		case -5:
			g.bid5, g.has5n = depth, true
		case 1:
			g.ask1, g.has1p = depth, true
		case 3:
			g.ask3, g.has3p = depth, true
		case 5:
			g.ask5, g.has5p = depth, true
		default:
			// unknown percentage level — ignore
		}
	}

	rows := make([]model.BookDepthRatio, 0, len(order))
	skipped := 0
	for _, k := range order {
		g := groups[k]
		if !(g.has1n && g.has3n && g.has5n && g.has1p && g.has3p && g.has5p) {
			skipped++
			continue
		}
		rows = append(rows, model.BookDepthRatio{
			Symbol:     symbol,
			Market:     "futures",
			SnapshotTS: g.ts,
			Bid1:       g.bid1, Ask1: g.ask1,
			Bid3:       g.bid3, Ask3: g.ask3,
			Bid5:       g.bid5, Ask5: g.ask5,
		})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].SnapshotTS.Before(rows[j].SnapshotTS) })

	return rows, skipped, nil
}

// parseBookDepthTimestamp accepts either epoch ms/seconds or a "YYYY-MM-DD HH:MM:SS"
// datetime (UTC). Binance bookDepth dumps have used both forms across periods.
func parseBookDepthTimestamp(raw string) (time.Time, error) {
	if n, err := strconv.ParseInt(raw, 10, 64); err == nil {
		switch {
		case n > 1e12:
			return time.UnixMilli(n).UTC(), nil
		case n > 1e9:
			return time.Unix(n, 0).UTC(), nil
		default:
			return time.Time{}, fmt.Errorf("implausible epoch %d", n)
		}
	}
	for _, layout := range []string{"2006-01-02 15:04:05", "2006-01-02T15:04:05"} {
		if t, err := time.Parse(layout, raw); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("unrecognized timestamp %q", raw)
}

func looksLikeBookDepthHeader(rec []string) bool {
	joined := strings.ToLower(strings.Join(rec, ","))
	return strings.Contains(joined, "timestamp") ||
		strings.Contains(joined, "percentage") ||
		strings.Contains(joined, "notional")
}

var downloadClient *http.Client

func init() {
	downloadClient = newDownloadClient()
}

func newDownloadClient() *http.Client {
	transport := &http.Transport{
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
	}

	proxyAddr := os.Getenv("HISTORY_LOADER_PROXY")
	if proxyAddr != "" {
		u, err := url.Parse(proxyAddr)
		if err != nil {
			log.Printf("[download] invalid HISTORY_LOADER_PROXY %q: %v, falling back to direct", proxyAddr, err)
		} else {
			socksDialer, err := proxy.SOCKS5("tcp", u.Host, nil, proxy.Direct)
			if err != nil {
				log.Printf("[download] SOCKS5 dialer failed for %q: %v, falling back to direct", u.Host, err)
			} else {
				transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
					return socksDialer.Dial(network, addr)
				}
				// Clear the net.Dialer-based DialContext so only the SOCKS5 dialer is used
			}
		}
	}

	if transport.DialContext == nil {
		transport.DialContext = (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	}

	client := &http.Client{
		Timeout:   10 * time.Minute,
		Transport: transport,
	}

	if proxyAddr != "" && transport.DialContext != nil {
		log.Printf("[download] using SOCKS5 proxy %s for history downloads", proxyAddr)
	} else {
		log.Printf("[download] direct connection (no proxy)")
	}

	return client
}

func (r *JobRegistry) downloadFileWithRetries(ctx context.Context, url, destPath string, dayIdx, totalDays int, dateStr string, job *DownloadJob) error {
	maxAttempts := 3
	var lastErr error

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if attempt > 1 {
			job.StepDetail = fmt.Sprintf("Day %d/%d: downloading %s (attempt %d/%d)...", dayIdx, totalDays, dateStr, attempt, maxAttempts)
			r.UpdateJob(job)

			backoff := time.Duration(1<<uint(attempt-1)) * 2 * time.Second
			log.Printf("[download] %s: retry %d/%d in %v", dateStr, attempt, maxAttempts, backoff)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
		}

		err := downloadFile(ctx, url, destPath)
		if err == nil {
			return nil
		}

		if strings.Contains(err.Error(), "404") {
			return fmt.Errorf("404 not found (no data for this date)")
		}

		lastErr = err
		log.Printf("[download] %s: attempt %d/%d failed: %v", dateStr, attempt, maxAttempts, err)
	}

	log.Printf("[download] %s: all %d attempts failed, skipping", dateStr, maxAttempts)
	return fmt.Errorf("download failed after %d attempts: %v", maxAttempts, lastErr)
}

func downloadFile(ctx context.Context, url, destPath string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := downloadClient.Do(req)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("404 not found")
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	f, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("create file: %w", err)
	}

	_, err = io.Copy(f, resp.Body)
	if err != nil {
		f.Close()
		os.Remove(destPath)
		return fmt.Errorf("write file: %w", err)
	}

	if err := f.Close(); err != nil {
		os.Remove(destPath)
		return fmt.Errorf("close file: %w", err)
	}

	return nil
}

func unzipAndParse(zipPath, symbol, market string) ([]model.Trade, error) {
	fi, err := os.Stat(zipPath)
	if err != nil {
		return nil, fmt.Errorf("stat zip: %w", err)
	}

	zr, err := zip.NewReader(mustOpenFile(zipPath), fi.Size())
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}

	if len(zr.File) == 0 {
		return nil, fmt.Errorf("zip archive is empty")
	}

	rc, err := zr.File[0].Open()
	if err != nil {
		return nil, fmt.Errorf("open csv in zip: %w", err)
	}
	defer rc.Close()

	return parseAggTradeCSV(rc, symbol, market)
}

func mustOpenFile(path string) *os.File {
	f, err := os.Open(path)
	if err != nil {
		panic(fmt.Sprintf("mustOpenFile %s: %v", path, err))
	}
	return f
}

func parseAggTradeCSV(reader io.Reader, symbol, market string) ([]model.Trade, error) {
	r := csv.NewReader(reader)
	r.LazyQuotes = true

	var trades []model.Trade
	lineNum := 0
	for {
		record, err := r.Read()
		if err == io.EOF {
			break
		}
		lineNum++

		if err != nil {
			log.Printf("[csv] line %d: read error: %v, skipping", lineNum, err)
			continue
		}

		if len(record) == 0 {
			continue
		}

		if lineNum == 1 && looksLikeHeaderRow(record[0]) {
			continue
		}

		if market == "futures" {
			if len(record) < 7 {
				continue
			}
		} else {
			if len(record) < 8 {
				continue
			}
		}

		tradeID, err := strconv.ParseInt(strings.TrimSpace(record[0]), 10, 64)
		if err != nil {
			continue
		}
		price, err := strconv.ParseFloat(strings.TrimSpace(record[1]), 64)
		if err != nil {
			continue
		}
		qty, err := strconv.ParseFloat(strings.TrimSpace(record[2]), 64)
		if err != nil {
			continue
		}
		timestampMs, err := strconv.ParseInt(strings.TrimSpace(record[5]), 10, 64)
		if err != nil {
			continue
		}

		// Binance Vision spot aggTrade CSV stores timestamps in microseconds,
		// futures in milliseconds. Convert to ms for spot.
		// SEE ALSO: internal/history/csvparser.go:133 (same rule)
		if market == "spot" {
			timestampMs /= 1000
		}

		var isBuyerMaker bool
		if market == "futures" {
			val := strings.TrimSpace(record[6])
			isBuyerMaker = val == "True" || val == "true" || val == "1"
		} else {
			val := strings.TrimSpace(record[6])
			isBuyerMaker = val == "True" || val == "true" || val == "1"
		}

		if tradeID <= 0 || price <= 0 || qty <= 0 || timestampMs <= 0 {
			continue
		}

		trades = append(trades, model.Trade{
			TradeID:      tradeID,
			Price:        price,
			Qty:          qty,
			Time:         time.UnixMilli(timestampMs),
			IsBuyerMaker: isBuyerMaker,
			Symbol:       symbol,
			Market:       market,
		})
	}

	return trades, nil
}

func looksLikeHeaderRow(s string) bool {
	lower := strings.ToLower(s)
	return strings.Contains(lower, "aggtradeid") ||
		strings.Contains(lower, "price") ||
		strings.Contains(lower, "timestamp") ||
		strings.Contains(lower, "buyer")
}
