package history

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

var ErrNotFound = errors.New("archive not available for this date")

var httpClient = &http.Client{
	Transport: &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   15 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		MaxIdleConns:          5,
		IdleConnTimeout:       90 * time.Second,
	},
}

const (
	maxRetries     = 5
	baseRetryDelay = 1 * time.Second
)

func DownloadToFile(ctx context.Context, url, destPath string) error {
	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			delay := baseRetryDelay * time.Duration(1<<(attempt-1))
			fmt.Fprintf(os.Stderr, "retry %d/%d in %v... ", attempt, maxRetries, delay)
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return ctx.Err()
			}
		}

		err := downloadToFile(ctx, url, destPath)
		if err == nil {
			return nil
		}

		lastErr = err

		if errors.Is(err, ErrNotFound) {
			return err
		}

		if !isRetryable(err) {
			return err
		}

		fmt.Fprintf(os.Stderr, "error: %v ", err)
	}

	return fmt.Errorf("all %d attempts failed: %w", maxRetries+1, lastErr)
}

func downloadToFile(ctx context.Context, url, destPath string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("download %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return ErrNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s: status %d", url, resp.StatusCode)
	}

	f, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	defer func() {
		f.Close()
		if err != nil {
			os.Remove(destPath)
		}
	}()

	_, err = io.Copy(f, resp.Body)
	if err != nil {
		return fmt.Errorf("write temp file: %w", err)
	}

	return nil
}

func UnzipFile(zipPath string) (io.ReadCloser, error) {
	fi, err := os.Stat(zipPath)
	if err != nil {
		return nil, fmt.Errorf("stat zip: %w", err)
	}

	zipReader, err := zip.NewReader(
		mustOpen(zipPath),
		fi.Size(),
	)
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}

	if len(zipReader.File) == 0 {
		return nil, fmt.Errorf("zip archive is empty")
	}

	f := zipReader.File[0]
	rc, err := f.Open()
	if err != nil {
		return nil, fmt.Errorf("open file in zip: %w", err)
	}

	return rc, nil
}

func mustOpen(path string) *os.File {
	f, err := os.Open(path)
	if err != nil {
		panic(err)
	}
	return f
}

func TempDir() (string, func(), error) {
	dir, err := os.MkdirTemp("", "procluster-loader-*")
	if err != nil {
		return "", nil, fmt.Errorf("create temp dir: %w", err)
	}
	cleanup := func() {
		os.RemoveAll(dir)
	}
	return dir, cleanup, nil
}

func isRetryable(err error) bool {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}

	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}

	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return true
	}

	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return true
	}

	errStr := err.Error()
	return contains(errStr, "connection refused") ||
		contains(errStr, "connection reset") ||
		contains(errStr, "connection closed") ||
		contains(errStr, "broken pipe") ||
		contains(errStr, "EOF") ||
		contains(errStr, "wsarecv") ||
		contains(errStr, "i/o timeout")
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstr(s, substr))
}

func containsSubstr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func BuildURL(market MarketType, symbol string, date time.Time) string {
	dateStr := date.Format("2006-01-02")

	if market == MarketFutures {
		return fmt.Sprintf(
			"https://data.binance.vision/data/futures/um/daily/aggTrades/%s/%s-aggTrades-%s.zip",
			symbol, symbol, dateStr,
		)
	}

	return fmt.Sprintf(
		"https://data.binance.vision/data/spot/daily/aggTrades/%s/%s-aggTrades-%s.zip",
		symbol, symbol, dateStr,
	)
}

func FilenameForDate(symbol string, date time.Time) string {
	return fmt.Sprintf("%s-aggTrades-%s.zip", symbol, date.Format("2006-01-02"))
}

func UnzipPath(dir, symbol string, date time.Time) string {
	return filepath.Join(dir, FilenameForDate(symbol, date))
}
