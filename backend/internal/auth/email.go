package auth

import (
	"context"
	"fmt"
	"log"
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
	return fmt.Errorf("SMTP not implemented yet")
}

func NewEmailSender(cfg AuthConfig) EmailSender {
	if cfg.EmailMode == "smtp" {
		return &SMTPEmailSender{}
	}
	return &LogEmailSender{}
}
