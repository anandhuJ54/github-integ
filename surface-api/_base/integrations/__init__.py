"""Shared platform-integration helpers (port of `lib/integrations*.ts`, `lib/google-workspace.server.ts`).

Secrets are read from the vault-backed environment by reference NAME only; values never leave
the server. Used by the admin Surface and (later) NORA.
"""
