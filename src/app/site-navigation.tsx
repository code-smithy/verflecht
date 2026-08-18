"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const publicLinks = [
  { href: "/", label: "Research Graph" },
  { href: "/people", label: "People" },
  { href: "/sources", label: "Sources" },
  { href: "/methodology", label: "Methodology" },
];

const appLinks = [{ href: "/app", label: "Internal App" }];

export function SiteNavigation() {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <Link className="site-brand" href="/">
        <span>Verflecht</span>
      </Link>
      <nav aria-label="Primary navigation" className="site-nav">
        {[...publicLinks, ...appLinks].map((link) => (
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
      <Link className="login-link" href="/login">
        Login
      </Link>
    </header>
  );
}

function isActivePath(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
