package auth

import (
	"context"
	"fmt"
)

type OAuthUser struct {
	ID    string
	Email string
	Name  string
}

type OAuthProvider interface {
	AuthURL(state string) string
	Exchange(ctx context.Context, code string) (*OAuthUser, error)
}

type StubOAuthProvider struct{}

func (s *StubOAuthProvider) AuthURL(state string) string { return "" }
func (s *StubOAuthProvider) Exchange(ctx context.Context, code string) (*OAuthUser, error) {
	return nil, fmt.Errorf("Google OAuth not enabled")
}

func NewOAuthProvider(cfg AuthConfig) OAuthProvider {
	if cfg.GoogleOAuthEnabled {
		return &GoogleOAuthProvider{
			ClientID:     cfg.GoogleClientID,
			ClientSecret: cfg.GoogleClientSecret,
		}
	}
	return &StubOAuthProvider{}
}

type GoogleOAuthProvider struct {
	ClientID     string
	ClientSecret string
}

func (g *GoogleOAuthProvider) AuthURL(state string) string {
	return fmt.Sprintf(
		"https://accounts.google.com/o/oauth2/v2/auth?client_id=%s&redirect_uri=&response_type=code&scope=openid+email+profile&state=%s",
		g.ClientID, state,
	)
}

func (g *GoogleOAuthProvider) Exchange(ctx context.Context, code string) (*OAuthUser, error) {
	return nil, fmt.Errorf("Google OAuth exchange not implemented")
}
