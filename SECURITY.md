# Security policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

Use GitHub's [private vulnerability reporting](../../security/advisories/new) for this repository,
or email the maintainers listed in the repository profile. Include:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept),
- the affected version/commit,
- any suggested mitigation.

We aim to acknowledge reports within a few days and will credit reporters who wish to be named.

## Scope

In scope:

- Authentication or authorization bypass, including cross-organization data access
- Device-token misuse (a phone credential reaching management endpoints, or vice versa)
- SQL injection, remote code execution, SSRF
- Pairing-code weaknesses (reuse, brute force, predictable generation)
- Sensitive data exposure (secrets, tokens, or location history leaking to unauthorized parties)
- GPS data integrity issues that could let one tenant alter another's records

Out of scope:

- Findings that require an already-compromised host, database, or Docker daemon
- Missing hardening headers on deployments that strip them at the reverse proxy
- Denial of service through sheer request volume without a specific amplification vector
- Outdated dependencies reported without a demonstrable exploit path (still tell us — we will upgrade)

## Supported versions

The latest `main` and the most recent tagged release receive security fixes.

## Hardening checklist for operators

- [ ] `JWT_SECRET` and `JWT_REFRESH_SECRET` are unique, ≥32 random bytes, and not the defaults
- [ ] `POSTGRES_PASSWORD` is strong and `DATABASE_URL` matches
- [ ] The API is reachable only over HTTPS; `CORS_ORIGIN` lists exact production origins
- [ ] PostgreSQL is not published to the host (the default compose file does not publish it)
- [ ] The host firewall allows only SSH and 80/443
- [ ] Backups are encrypted and stored off-host
- [ ] Retention windows match your privacy policy
- [ ] Administrative accounts use strong, unique passwords; disabled accounts are truly disabled
- [ ] You review the audit log periodically (`/api/audit-logs`)

## Design notes relevant to security reviewers

- Passwords are hashed with bcrypt (cost 12). Refresh tokens are stored as SHA-256 hashes and are
  rotated on use; changing a password revokes all outstanding refresh tokens.
- Device tokens and user sessions are cryptographically distinct principals. `auth()` rejects
  device tokens; `deviceAuth()` rejects user tokens.
- Every query is scoped by `organizationId` unless the caller is a `SUPERADMIN`.
- Pairing codes are bcrypt-hashed, single-use, expire after 15 minutes, and are bound to one device UUID.
- Request bodies are validated with Zod schemas; the JSON body limit is 2 MB.
- Audit entries record actor, organization, action, resource, result, IP, and time — never secrets.
