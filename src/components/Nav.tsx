"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "My Team" },
  { href: "/transfers", label: "Transfers" },
  { href: "/captaincy", label: "Captaincy" },
  { href: "/fixtures", label: "Fixtures" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-hairline bg-surface">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
        <Link href="/" className="text-base font-semibold tracking-tight">
          FPL Assistant
        </Link>
        <nav className="flex gap-1 text-sm">
          {LINKS.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  active
                    ? "bg-accent text-accent-ink font-medium"
                    : "text-ink-2 hover:bg-grid"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
