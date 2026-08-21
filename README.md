# verflecht

Planning documents:

- [Requirements](docs/requirements.md)
- [Implementation plan](docs/implementation-plan.md)
- [Database foundation](docs/database.md)
- [Domain services](docs/domain-services.md)
- [URL ingestion](docs/ingestion.md)
- [LLM provider abstraction](docs/llm-provider.md)
- [Public API](docs/public-api.md)

## Discord login

The internal `/app` workspace is gated by Supabase Auth with the Discord OAuth provider.

Required public build variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_BASE_PATH=/verflecht`

Configure Discord as a Supabase Auth provider, then allow this redirect URL in Supabase:

`https://code-smithy.github.io/verflecht/login/`
