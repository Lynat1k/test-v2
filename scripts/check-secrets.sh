#!/bin/sh
# check-secrets.sh — Detect secrets in staged files before commit
# Returns 1 if secrets found, 0 if clean

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

FOUND=0

# Get staged files (exclude deleted)
STAGED=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED" ]; then
  echo "${GREEN}No staged files to check.${NC}"
  exit 0
fi

echo "Scanning staged files for secrets..."

# Patterns to detect
check_file() {
  file="$1"
  issues=""
  
  # Skip binary files and certain paths
  case "$file" in
    *.png|*.jpg|*.jpeg|*.gif|*.ico|*.svg|*.woff|*.woff2|*.ttf|*.eot|*.pdf)
      return 0
      ;;
    node_modules/*|dist/*|*.lock|go.sum)
      return 0
      ;;
  esac

  # Read staged content from git index
  content=$(git show ":$file" 2>/dev/null) || return 0

  # .env files with actual values
  if echo "$file" | grep -qiE '\.env$|\.env\.|^\.env\.'; then
    # Allow .env.example, .env.local.example etc
    if echo "$file" | grep -qiE '\.example$'; then
      return 0
    fi
    issues="${issues}  ⚠ .env file detected (should not be committed)\n"
  fi

  # Private keys
  if printf '%s' "$content" | grep -qE 'BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY'; then
    issues="${issues}  ⚠ Private key detected\n"
  fi

  # AWS keys
  if printf '%s' "$content" | grep -qE 'AKIA[0-9A-Z]{16}'; then
    issues="${issues}  ⚠ AWS Access Key ID detected\n"
  fi

  # AWS secret keys
  if printf '%s' "$content" | grep -qE '(aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*=\s*["\x27]?[A-Za-z0-9/+=]{40}'; then
    issues="${issues}  ⚠ AWS Secret Access Key detected\n"
  fi

  # GitHub tokens
  if printf '%s' "$content" | grep -qE 'ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}'; then
    issues="${issues}  ⚠ GitHub token detected\n"
  fi

  # GitLab tokens
  if printf '%s' "$content" | grep -qE 'glpat-[A-Za-z0-9\-_]{20,}'; then
    issues="${issues}  ⚠ GitLab token detected\n"
  fi

  # Google API keys
  if printf '%s' "$content" | grep -qE 'AIza[0-9A-Za-z\-_]{35}'; then
    issues="${issues}  ⚠ Google API key detected\n"
  fi

  # Google OAuth client ID
  if printf '%s' "$content" | grep -qE '[0-9]+-[a-z0-9_]{32}\.apps\.googleusercontent\.com'; then
    issues="${issues}  ⚠ Google OAuth client ID detected\n"
  fi

  # Slack tokens
  if printf '%s' "$content" | grep -qE 'xox[bpors]-[0-9]{10,}-[A-Za-z0-9\-]+'; then
    issues="${issues}  ⚠ Slack token detected\n"
  fi

  # Discord tokens
  if printf '%s' "$content" | grep -qE '[MN][A-Za-z0-9]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}'; then
    issues="${issues}  ⚠ Discord token detected (check manually)\n"
  fi

  # Stripe keys
  if printf '%s' "$content" | grep -qE 'sk_live_[0-9a-zA-Z]{24,}|rk_live_[0-9a-zA-Z]{24,}'; then
    issues="${issues}  ⚠ Stripe secret key detected\n"
  fi

  if printf '%s' "$content" | grep -qE 'sk_test_[0-9a-zA-Z]{24,}'; then
    issues="${issues}  ⚠ Stripe test key detected\n"
  fi

  # Twilio
  if printf '%s' "$content" | grep -qE 'SK[0-9a-fA-F]{32}'; then
    issues="${issues}  ⚠ Possible Twilio API key detected\n"
  fi

  # Generic high-entropy secrets (passwords, tokens in config)
  if printf '%s' "$content" | grep -qiE '(password|passwd|secret|token|api_key|apikey|api-key)\s*[=:]\s*["\x27]?[A-Za-z0-9+/=_-]{20,}'; then
    # Exclude test files, examples, and mocks
    case "$file" in
      *test*|*spec*|*mock*|*example*|*.test.*|*.spec.*)
        ;;
      *)
        issues="${issues}  ⚠ Possible hardcoded secret/password/token\n"
        ;;
    esac
  fi

  # Connection strings with passwords
  if printf '%s' "$content" | grep -qE '://[^:]+:[^@]+@'; then
    # Exclude example files
    case "$file" in
      *example*|*.example)
        ;;
      *)
        issues="${issues}  ⚠ Connection string with embedded credentials\n"
        ;;
    esac
  fi

  # .pem files
  if echo "$file" | grep -qiE '\.pem$'; then
    issues="${issues}  ⚠ .pem file detected (usually contains private keys)\n"
  fi

  if [ -n "$issues" ]; then
    echo "${RED}✗ $file${NC}"
    echo "$issues"
    return 1
  fi

  return 0
}

# Check each staged file
for file in $STAGED; do
  if ! check_file "$file"; then
    FOUND=1
  fi
done

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo "${RED}║  SECRETS DETECTED — Commit blocked!                       ║${NC}"
  echo "${RED}║                                                            ║${NC}"
  echo "${RED}║  Remove secrets from staged files or add them to           ║${NC}"
  echo "${RED}║  .gitignore. If this is a false positive, you can          ║${NC}"
  echo "${RED}║  bypass with: git commit --no-verify (use with caution)   ║${NC}"
  echo "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
  exit 1
fi

echo "${GREEN}✓ No secrets detected.${NC}"
exit 0
