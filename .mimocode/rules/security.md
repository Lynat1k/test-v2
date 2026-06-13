---
paths:
  - "backend/internal/auth/**"
  - "backend/internal/admin/**"
  - "backend/internal/api/**"
---
# Security rules (auto-loaded for sensitive code)
- Весь пользовательский ввод валидируется здесь же на бэкенде.
- SQL только параметризованный, без конкатенации.
- Приватные/админ-маршруты: проверка authN+authZ на КАЖДОМ запросе.
- login/register/recovery: rate-limit (Redis) + lockout.
- Никаких секретов в коде. Ошибки наружу без stack trace.
- При сомнении — свериться с docs/SECURITY.md.
