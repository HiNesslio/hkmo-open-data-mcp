# Security policy

The MCP server deliberately treats model-supplied URLs and headers as untrusted input.

- HTTPS only.
- Host allowlist: Hong Kong/Macao government domains only.
- Redirect destination is revalidated.
- 10-second request timeout.
- Response-size limits.
- No secret persistence.
- No automatic scraping of private/session-authenticated services.
- No guessed API tokens, cookies, CSRF values, Referer headers or credentials.

Report security issues privately to the repository owner rather than publishing an exploit in a public issue.
