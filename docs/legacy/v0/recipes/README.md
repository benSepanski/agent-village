# Connectivity recipes

Each recipe demonstrates a specific connectivity pattern your agent can use:
permissions, egress allowlists, and the platform's grant/denial paths. Every
recipe has an automated **allow-path test** (proves the good case works) and a
**deny-path test** (proves the bad case is blocked).

Start with the example in [`examples/`](../../examples/) for your recipe, then
adapt the `manifest.json` and grants to your needs.

---

## Recipes

- **[Anthropic-only](anthropic-only.md)** — reach the metering gateway only; no
  external APIs. Use when your agent needs LLM only.
  - Allow-path: metering gateway (implicit TLS, AWS base domains).
  - Deny-path: any off-list host is blocked at egress.

- **[Read-only Notion](notion-read-only.md)** — Notion API with a scoped,
  read-only integration token.
  - Allow-path: Notion API endpoint with Bearer token.
  - Deny-path: write attempt / non-allowlisted host / missing token.
  - **Key insight**: the token's own scope (read-only) enforces the read-only
    constraint; the platform blocks hosts/ports, not HTTP verbs.

- **[Partial email](email-partial.md)** — IMAP and SMTP with implicit TLS (no STARTTLS).
  - Allow-path: IMAP (port 993) and SMTP (port 465) to allowlisted mail hosts.
  - Deny-path: STARTTLS ports (143/587) are blocked; non-allowlisted hosts blocked.
  - **Key constraint**: the platform proxy does not support STARTTLS (no plaintext
    upgrading to TLS), so mail clients must use implicit-TLS ports.

---

## How to read a recipe

Each recipe doc covers:

1. **Overview** — what this agent can do and what it cannot.
2. **Example structure** — file layout in `examples/<recipe-name>/`.
3. **The manifest** — the `manifest.json` excerpt showing `egressAllow` and any grants.
4. **Connectivity verification** — where the allow/deny tests live and what they prove.

---

## Automated test coverage

Every recipe is tested at two levels:

| Level                         | Where                                          | What it tests                                                                                                   |
| ----------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Derivation** (unit)         | `packages/services/src/sandbox-egress.test.ts` | The `buildEgressAllowlist()` function correctly includes the recipe's hosts in the derived allowlist            |
| **Enforcement** (integration) | `packages/infra/test/proxy-allowlist.test.ts`  | The proxy matcher (`isHostAllowed`, `resolveTarget`, port support) correctly allows/denies the recipe's traffic |

Tests are gated by recipe name or feature. A new recipe with an allow-path must
have a corresponding deny-path test — both are mandatory.

---

## Creating your own recipe

1. Create a new directory under `examples/` with a unique name.
2. Add a `manifest.json` with `egressAllow` entries for your APIs and any grants
   (e.g. `{"kind":"secret","name":"api-token","env":"API_TOKEN"}`).
3. Write the app code (JavaScript, Python, etc.) using those hostnames and secrets.
4. Document the pattern in `docs/recipes/<name>.md`.
5. Add allow/deny tests for the derivation and enforcement layers.

See an existing recipe for the structure.

---

## Egress proxy limits and guarantees

The proxy **only allows outbound TCP** to:

- AWS service endpoints (base domain `us-east-1.amazonaws.com`, etc.)
- Exact hostnames or wildcard patterns in `manifest.egressAllow`
- Implicit-TLS ports (443, 993, 465, etc.)

The proxy does **not** support:

- STARTTLS (plaintext-to-TLS upgrade, e.g. SMTP port 587). Use implicit-TLS
  ports instead (SMTPS port 465).
- MCP (Model Context Protocol) — no special handling; standard HTTP/TLS only.
- SSE (Server-Sent Events) streaming — not supported over the proxy.

These constraints are enforced at the proxy layer before any connection reaches
your agent — see the `AC-6.5 no new proxy features` and STARTTLS-rejection
tests in
[`proxy-allowlist.test.ts`](../../packages/infra/test/proxy-allowlist.test.ts).
