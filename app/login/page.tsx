"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/app/theme-toggle";

type Stage = "password" | "mfa" | "setup" | "recovery_codes";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [recovery, setRecovery] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [stage, setStage] = useState<Stage>("password");
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(path: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (stage === "password") {
        const { ok, data } = await post("/api/auth/login", { email, password });
        if (!ok) return setError((data.error as string) ?? "Sign-in failed.");
        if (data.mfa_setup) {
          const s = await post("/api/auth/mfa/setup", {});
          if (!s.ok) return setError((s.data.error as string) ?? "Setup failed. Sign in again.");
          setSecret(String(s.data.secret));
          setUri(String(s.data.uri));
          setStage("setup");
          return;
        }
        if (data.mfa) return setStage("mfa");
        return goDashboard();
      }
      if (stage === "mfa") {
        const body = useRecovery ? { recovery } : { token };
        const { ok, data } = await post("/api/auth/mfa", body);
        if (!ok) return setError((data.error as string) ?? "Verification failed.");
        return goDashboard();
      }
      if (stage === "setup") {
        const { ok, data } = await post("/api/auth/mfa/enroll", { secret, token });
        if (!ok) return setError((data.error as string) ?? "Enrolment failed.");
        setRecoveryCodes(data.recoveryCodes as string[]);
        setStage("recovery_codes");
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  function goDashboard() {
    router.replace("/dashboard");
    router.refresh();
  }

  const copy =
    stage === "password"
      ? "Sign in to the production dashboard."
      : stage === "mfa"
        ? "Enter the 6-digit authenticator code."
        : "Set up multi-factor authentication (required for your role)."
        ;

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <div className="fixed right-4 top-4">
        <ThemeToggle />
      </div>
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {stage === "recovery_codes" ? "Recovery codes" : "Fanela staff login"}
        </h1>
        <p className="mt-1 mb-6 text-sm text-zinc-500">{stage === "recovery_codes" ? "Store these somewhere safe." : copy}</p>

        {stage === "password" && (
          <>
            <label htmlFor="login-email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 mb-4 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:focus-visible:outline-zinc-100"
            />
            <label htmlFor="login-password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Password</label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 mb-6 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:focus-visible:outline-zinc-100"
            />
          </>
        )}

        {stage === "setup" && (
          <div className="mb-6 space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-500">
              Add this secret to your authenticator app, then enter the 6-digit code.
            </p>
            <code className="block break-all rounded-md bg-zinc-100 p-3 text-xs dark:bg-zinc-900">{uri}</code>
            <label htmlFor="login-token-setup" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Authenticator code</label>
            <input
              id="login-token-setup"
              inputMode="numeric"
              pattern="\d{6}"
              required
              autoFocus
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 font-mono text-sm tracking-widest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:focus-visible:outline-zinc-100"
            />
          </div>
        )}

        {stage === "mfa" && (
          <>
            {!useRecovery ? (
              <>
                <label htmlFor="login-token" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Authentication code</label>
                <input
                  id="login-token"
                  inputMode="numeric"
                  pattern="\d{6}"
                  required
                  autoFocus
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="mt-1 mb-3 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 font-mono text-sm tracking-widest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:focus-visible:outline-zinc-100"
                />
                <button
                  type="button"
                  onClick={() => { setUseRecovery(true); setError(""); }}
                  className="mb-3 text-sm text-zinc-500 hover:text-zinc-700"
                >
                  Use a recovery code
                </button>
              </>
            ) : (
              <>
                <label htmlFor="login-recovery" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Recovery code</label>
                <input
                  id="login-recovery"
                  required
                  autoFocus
                  placeholder="XXXXX-XXXXX"
                  value={recovery}
                  onChange={(e) => setRecovery(e.target.value)}
                  className="mt-1 mb-3 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 font-mono text-sm uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:focus-visible:outline-zinc-100"
                />
                <button
                  type="button"
                  onClick={() => { setUseRecovery(false); setError(""); }}
                  className="mb-3 text-sm text-zinc-500 hover:text-zinc-700"
                >
                  Use authenticator code
                </button>
              </>
            )}
          </>
        )}

        {stage === "recovery_codes" && (
          <div className="mb-6">
            <ul className="mb-4 grid grid-cols-2 gap-2 font-mono text-sm">
              {recoveryCodes.map((c) => (
                <li key={c} className="rounded bg-zinc-100 px-2 py-1 text-center dark:bg-zinc-900">{c}</li>
              ))}
            </ul>
            <p className="text-xs text-zinc-500">Each code works once. You will not see them again.</p>
          </div>
        )}

        {error && (
          <p role="status" aria-live="polite" className="mb-4">
            <span className="block rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </span>
          </p>
        )}

        {stage === "recovery_codes" ? (
          <button
            type="button"
            onClick={goDashboard}
            className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:focus-visible:outline-zinc-100"
          >
            I saved them — continue
          </button>
        ) : (
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:focus-visible:outline-zinc-100"
          >
            {busy ? "Checking…" : stage === "password" ? "Sign in" : stage === "setup" ? "Activate & finish" : "Verify"}
          </button>
        )}

        {stage === "mfa" && (
          <button
            type="button"
            onClick={() => { setStage("password"); setError(""); }}
            className="mt-3 w-full text-sm text-zinc-500 hover:text-zinc-700"
          >
            Back to password
          </button>
        )}
      </form>
    </div>
  );
}
