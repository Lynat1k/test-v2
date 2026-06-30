package auth

import (
	"context"
	"crypto/tls"
	_ "embed"
	"encoding/base64"
	"fmt"
	"html"
	"log"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

//go:embed logo.png
var logoPNG []byte

// logoDataURL — лого PROCLUSTER, вшитое в бинарь (//go:embed) и закодированное
// как data:image/png;base64,… для <img src> в письме. Считается один раз при
// инициализации пакета. Так письмо самодостаточно: НИКАКИХ файлов во frontend/
// public (они ломали Vite-манифест на проде) и внешних URL логотипа.
var logoDataURL = "data:image/png;base64," + base64.StdEncoding.EncodeToString(logoPNG)

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

// verifyEmailHTMLTemplate — брендированное письмо подтверждения email в стиле
// PROCLUSTER. Email-safe: table-layout, inline-стили, bulletproof VML-кнопка для
// Outlook, preheader, web-safe шрифты. Логотип встроен data-URL'ом (см.
// logoDataURL) — внешних картинок и файлов во frontend/ нет. Плейсхолдеры
// {{LOGO_DATA_URL}} и {{VERIFY_URL}} подставляются через strings.ReplaceAll
// (VERIFY_URL уже прошёл html.EscapeString). НЕ использовать fmt — в CSS есть '%'.
const verifyEmailHTMLTemplate = `<!doctype html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>PROCLUSTER — подтверждение email</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
  img{-ms-interpolation-mode:bicubic;border:0;height:auto;line-height:100%;outline:none;text-decoration:none;}
  table{border-collapse:collapse!important;}
  body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;background:#0b0f17;}
  a{color:#fbbf24;text-decoration:none;}
  @media only screen and (max-width:600px){
    .pc-container{width:100%!important;}
    .pc-card{padding:30px 22px!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#0b0f17;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#0b0f17;opacity:0;">Подтвердите email, чтобы начать пользоваться PROCLUSTER&#8203;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b0f17;">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <table role="presentation" class="pc-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;margin:0 auto;">
        <tr>
          <td align="center" style="padding:6px 0 26px 0;">
            <img src="{{LOGO_DATA_URL}}" width="150" alt="PROCLUSTER" style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;text-decoration:none;">
          </td>
        </tr>
        <tr>
          <td class="pc-card" style="background:#111827;border:1px solid #1f2937;border-radius:16px;padding:38px 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:24px;line-height:1.3;font-weight:700;color:#ffffff;padding:0 0 14px 0;">Подтвердите email</td>
              </tr>
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#9ca3af;padding:0 0 28px 0;">Спасибо за регистрацию в PROCLUSTER. Чтобы активировать аккаунт, нажмите кнопку ниже.</td>
              </tr>
              <tr>
                <td style="padding:0 0 26px 0;">
                  <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{VERIFY_URL}}" style="height:50px;v-text-anchor:middle;width:236px;" arcsize="20%" stroke="f" fillcolor="#f59e0b">
                  <w:anchorlock/>
                  <center style="color:#111827;font-family:'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:bold;">Подтвердить email</center>
                  </v:roundrect>
                  <![endif]-->
                  <!--[if !mso]><!-->
                  <a href="{{VERIFY_URL}}" style="display:inline-block;background:#f59e0b;color:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;font-weight:700;line-height:1.2;text-decoration:none;padding:14px 28px;border-radius:10px;">Подтвердить email</a>
                  <!--<![endif]-->
                </td>
              </tr>
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;line-height:1.5;color:#6b7280;padding:0 0 6px 0;">Если кнопка не работает, скопируйте ссылку в браузер:</td>
              </tr>
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;line-height:1.6;color:#9ca3af;word-break:break-all;padding:0 0 28px 0;"><a href="{{VERIFY_URL}}" style="color:#fbbf24;text-decoration:underline;word-break:break-all;">{{VERIFY_URL}}</a></td>
              </tr>
              <tr>
                <td style="border-top:1px solid #1f2937;font-size:0;line-height:0;height:1px;">&nbsp;</td>
              </tr>
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b7280;padding:22px 0 0 0;">Срок действия ссылки — 24 часа. Если вы не регистрировались — просто проигнорируйте это письмо.</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.7;color:#6b7280;padding:26px 16px 6px 16px;">
            © 2026 PROCLUSTER<br>
            <a href="https://chart.procluster.online" style="color:#9ca3af;text-decoration:underline;">chart.procluster.online</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`

func buildVerificationMessage(from, to, verifyURL string) []byte {
	boundary := "pc_boundary_" + strconv.FormatInt(time.Now().UnixNano(), 36)
	subject := "PROCLUSTER — подтверждение email"

	plain := "PROCLUSTER\r\n\r\n" +
		"Подтвердите email\r\n\r\n" +
		"Спасибо за регистрацию в PROCLUSTER. Чтобы активировать аккаунт,\r\n" +
		"перейдите по ссылке:\r\n\r\n" +
		verifyURL + "\r\n\r\n" +
		"Срок действия ссылки — 24 часа.\r\n" +
		"Если вы не регистрировались — просто проигнорируйте это письмо.\r\n\r\n" +
		"© 2026 PROCLUSTER\r\n" +
		"chart.procluster.online\r\n"

	safeURL := html.EscapeString(verifyURL)
	htmlBody := verifyEmailHTMLTemplate
	htmlBody = strings.ReplaceAll(htmlBody, "{{LOGO_DATA_URL}}", logoDataURL)
	htmlBody = strings.ReplaceAll(htmlBody, "{{VERIFY_URL}}", safeURL)

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
