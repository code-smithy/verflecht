"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { getBrowserSupabaseClient } from "../auth-client";
import { buildSiteUrl, getSafeNextPath } from "../auth-paths";

type LoginState = "checking" | "ready" | "redirecting" | "configured";

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);
  const [state, setState] = useState<LoginState>("checking");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function finishPendingSignIn() {
      if (!supabase) {
        setState("configured");
        return;
      }

      const url = new URL(window.location.href);
      const nextPath = getSafeNextPath(url.searchParams.get("next"));
      const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");

      if (error) {
        setMessage(error);
        setState("ready");
        return;
      }

      const code = url.searchParams.get("code");

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

        if (!active) {
          return;
        }

        if (exchangeError) {
          setMessage(exchangeError.message);
          setState("ready");
          return;
        }

        window.history.replaceState(null, "", buildSiteUrl(window.location.origin, "/login/"));
        router.replace(nextPath);
        return;
      }

      const { data, error: sessionError } = await supabase.auth.getSession();

      if (!active) {
        return;
      }

      if (sessionError) {
        setMessage(sessionError.message);
        setState("ready");
        return;
      }

      if (data.session) {
        router.replace(nextPath);
        return;
      }

      setState("ready");
    }

    void finishPendingSignIn();

    return () => {
      active = false;
    };
  }, [router, supabase]);

  async function signInWithDiscord() {
    if (!supabase) {
      setState("configured");
      return;
    }

    setMessage(null);
    setState("redirecting");

    const nextPath = getSafeNextPath(new URL(window.location.href).searchParams.get("next"));
    const redirectTo = buildSiteUrl(
      window.location.origin,
      `/login/?next=${encodeURIComponent(nextPath)}`,
    );

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo,
        scopes: "identify email",
      },
    });

    if (error) {
      setMessage(error.message);
      setState("ready");
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <p className="app-mark">Verflecht</p>
        <h1>Discord login</h1>
        <p>Internal access for researchers, reviewers, and administrators.</p>

        {state === "configured" ? (
          <div className="auth-alert" role="alert">
            Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable Discord login.
          </div>
        ) : null}

        {message ? (
          <div className="auth-alert" role="alert">
            {message}
          </div>
        ) : null}

        <button
          className="discord-login-button"
          disabled={state === "checking" || state === "redirecting" || state === "configured"}
          onClick={signInWithDiscord}
          type="button"
        >
          {state === "checking"
            ? "Checking session..."
            : state === "redirecting"
              ? "Opening Discord..."
              : "Continue with Discord"}
        </button>
      </section>
    </main>
  );
}
