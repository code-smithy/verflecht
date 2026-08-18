"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

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
