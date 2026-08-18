import type { ReactNode } from "react";

import { InternalAppShell } from "./internal-app-shell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <InternalAppShell>{children}</InternalAppShell>;
}
