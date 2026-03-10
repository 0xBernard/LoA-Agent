# Security Notes

## Gemini `--yolo` mode

The harness runs Gemini CLI with `--yolo` for unattended execution. This reduces interactive safety prompts, so treat the runtime as **trusted-but-constrained** infrastructure.

Recommended guardrails:

- Run inside an isolated Docker container (or equivalent sandbox).
- Mount only the minimum required workspace paths.
- Use least-privilege credentials and short-lived secrets.
- Restrict outbound network access when possible.
- Do not run as root in production.

If stronger control is needed, remove `--yolo` and require manual confirmation in interactive sessions.
