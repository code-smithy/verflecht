"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";

import { getBrowserSupabaseClient } from "../auth-client";

const internalLinks = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/ingest", label: "Ingest" },
  { href: "/app/review", label: "Review Queue" },
  { href: "/app/entities", label: "Entities" },
  { href: "/app/claims", label: "Claims" },
  { href: "/app/sources", label: "Sources" },
  { href: "/app/runs", label: "Crawl Runs" },
  { href: "/app/settings", label: "Settings" },
];

export function InternalAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [configMissing, setConfigMissing] = useState(false);

  useEffect(() => {
    let active = true;

    function redirectToLogin() {
      const nextPath = `${pathname}${window.location.search}`;
      router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
    }

    async function verifySession() {
      if (!supabase) {
        setConfigMissing(true);
        setIsChecking(false);
        return;
      }

      const { data, error } = await supabase.auth.getSession();

      if (!active) {
        return;
      }

      if (error || !data.session) {
        redirectToLogin();
        return;
      }

      setUser(data.session.user);
      setIsChecking(false);
    }

    void verifySession();

    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        setUser(null);
        redirectToLogin();
        return;
      }

      setUser(session.user);
      setIsChecking(false);
    });

    return () => {
      active = false;
      subscription?.data.subscription.unsubscribe();
    };
  }, [pathname, router, supabase]);

  async function signOut() {
    await supabase?.auth.signOut();
    router.replace("/login");
  }

  if (configMissing) {
    return (
      <main className="auth-status-page">
        <section className="login-panel">
          <p className="app-mark">Verflecht</p>
          <h1>Login is not configured</h1>
          <p>Set the browser Supabase environment variables to require Discord login.</p>
        </section>
      </main>
    );
  }

  if (isChecking) {
    return (
      <main className="auth-status-page">
        <section className="login-panel">
          <p className="app-mark">Verflecht</p>
          <h1>Checking access</h1>
          <p>Confirming your Discord session.</p>
        </section>
      </main>
    );
  }

  return (
    <div className="internal-shell">
      <aside className="internal-sidebar" aria-label="Internal workspace navigation">
        <div>
          <p className="app-mark">Workspace</p>
          <h2>Research Ops</h2>
        </div>
        <nav className="internal-nav">
          {internalLinks.map((link) => (
            <Link
              aria-current={isActivePath(pathname, link.href) ? "page" : undefined}
              className={isActivePath(pathname, link.href) ? "active" : undefined}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="internal-account">
          <span>{getDisplayName(user)}</span>
          <button onClick={signOut} type="button">
            Sign out
          </button>
        </div>
      </aside>
      <section className="internal-workspace">{children}</section>
    </div>
  );
}

function isActivePath(pathname: string, href: string) {
  if (href === "/app") {
    return pathname === "/app";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function getDisplayName(user: User | null): string {
  if (!user) {
    return "Discord user";
  }

  const metadataName =
    textValue(user.user_metadata.full_name) ??
    textValue(user.user_metadata.name) ??
    textValue(user.user_metadata.user_name) ??
    textValue(user.user_metadata.preferred_username);

  return metadataName ?? user.email ?? "Discord user";
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
