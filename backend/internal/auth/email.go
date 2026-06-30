package auth

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"html"
	"log"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

type EmailSender interface {
	SendVerification(ctx context.Context, to, verifyURL string) error
}

type LogEmailSender struct{}

func (l *LogEmailSender) SendVerification(ctx context.Context, to, verifyURL string) error {
	log.Printf("[auth] verify email: %s → %s", to, verifyURL)
	return nil
}

type SMTPEmailSender struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
}

func (s *SMTPEmailSender) SendVerification(ctx context.Context, to, verifyURL string) error {
	if s.Host == "" || s.Port == 0 {
		return fmt.Errorf("smtp: host/port not configured")
	}
	from := s.From
	if from == "" {
		from = s.Username
	}
	addr := s.Host + ":" + strconv.Itoa(s.Port)
	msg := buildVerificationMessage(from, to, verifyURL)

	dialCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	errCh := make(chan error, 1)
	go func() { errCh <- s.send(addr, from, to, msg) }()

	select {
	case <-dialCtx.Done():
		return fmt.Errorf("smtp: timeout connecting to %s: %w", addr, dialCtx.Err())
	case err := <-errCh:
		return err
	}
}

func (s *SMTPEmailSender) send(addr, from, to string, msg []byte) error {
	tlsConf := &tls.Config{ServerName: s.Host, MinVersion: tls.VersionTLS12}
	var (
		client *smtp.Client
		err    error
	)

	if s.Port == 465 {
		conn, derr := tls.Dial("tcp", addr, tlsConf)
		if derr != nil {
			return fmt.Errorf("smtp: tls dial %s: %w", addr, derr)
		}
		client, err = smtp.NewClient(conn, s.Host)
		if err != nil {
			conn.Close()
			return fmt.Errorf("smtp: new client %s: %w", addr, err)
		}
	} else {
		client, err = smtp.Dial(addr)
		if err != nil {
			return fmt.Errorf("smtp: dial %s: %w", addr, err)
		}
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(tlsConf); err != nil {
				client.Close()
				return fmt.Errorf("smtp: starttls %s: %w", addr, err)
			}
		}
	}
	defer client.Close()

	if s.Username != "" {
		auth := smtp.PlainAuth("", s.Username, s.Password, s.Host)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("smtp: auth as %s on %s: %w", s.Username, addr, err)
		}
	}
	if err := client.Mail(from); err != nil {
		return fmt.Errorf("smtp: MAIL FROM %s: %w", from, err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("smtp: RCPT TO %s: %w", to, err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp: DATA: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("smtp: write body: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp: close body: %w", err)
	}
	if err := client.Quit(); err != nil {
		return fmt.Errorf("smtp: QUIT: %w", err)
	}
	return nil
}

func buildVerificationMessage(from, to, verifyURL string) []byte {
	boundary := "pc_boundary_" + strconv.FormatInt(time.Now().UnixNano(), 36)
	subject := "PROCLUSTER — подтверждение email"

	plain := "Здравствуйте!\r\n\r\n" +
		"Подтвердите ваш email, перейдя по ссылке:\r\n" +
		verifyURL + "\r\n\r\n" +
		"Если вы не регистрировались — проигнорируйте это письмо.\r\n"

	safeURL := html.EscapeString(verifyURL)
	htmlBody := `<!doctype html><html><body style="margin:0;padding:24px;background:#0b1220;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#e5e7eb">
<div style="max-width:480px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:16px;padding:28px">
<h2 style="margin:0 0 12px 0;color:#fff;font-size:18px">Подтвердите email</h2>
<p style="margin:0 0 18px 0;color:#9ca3af;font-size:14px;line-height:1.5">Нажмите кнопку, чтобы подтвердить ваш адрес.</p>
<p style="margin:0 0 18px 0"><a href="` + safeURL + `" style="display:inline-block;background:#f59e0b;color:#111827;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700;font-size:14px">Подтвердить email</a></p>
<p style="margin:0 0 6px 0;color:#6b7280;font-size:12px">Если кнопка не работает — откройте ссылку:</p>
<p style="margin:0;color:#9ca3af;font-size:12px;word-break:break-all"><a href="` + safeURL + `" style="color:#fbbf24">` + safeURL + `</a></p>
</div></body></html>`

	var b strings.Builder
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + mimeEncode(subject) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Date: " + time.Now().UTC().Format(time.RFC1123Z) + "\r\n")
	b.WriteString("Content-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n\r\n")

	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/plain; charset=\"UTF-8\"\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	b.WriteString(plain + "\r\n")

	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/html; charset=\"UTF-8\"\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	b.WriteString(htmlBody + "\r\n")

	b.WriteString("--" + boundary + "--\r\n")
	return []byte(b.String())
}

// mimeEncode wraps a header value in RFC 2047 encoded-word form if it
// contains non-ASCII bytes. Subjects with Cyrillic etc. need this.
func mimeEncode(s string) string {
	for i := 0; i < len(s); i++ {
		if s[i] > 127 {
			return "=?UTF-8?B?" + base64.StdEncoding.EncodeToString([]byte(s)) + "?="
		}
	}
	return s
}

func NewEmailSender(cfg AuthConfig) EmailSender {
	if cfg.EmailMode == "smtp" {
		return &SMTPEmailSender{
			Host:     cfg.SMTPHost,
			Port:     cfg.SMTPPort,
			Username: cfg.SMTPUsername,
			Password: cfg.SMTPPassword,
			From:     cfg.SMTPFrom,
		}
	}
	return &LogEmailSender{}
}
