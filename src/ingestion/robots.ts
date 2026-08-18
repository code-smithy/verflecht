type RobotsRule = {
  directive: "allow" | "disallow";
  path: string;
};

type RobotsGroup = {
  userAgents: string[];
  rules: RobotsRule[];
};

function normalizeRulePath(path: string): string {
  return path.trim().replace(/\*$/u, "");
}

export function isRobotsAllowed(robotsTxt: string, targetPath: string, userAgent: string): boolean {
  const groups: RobotsGroup[] = [];
  let currentGroup: RobotsGroup | undefined;

  for (const rawLine of robotsTxt.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*/u, "").trim();
    if (!line) {
      currentGroup = undefined;
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const directive = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();

    if (directive === "user-agent") {
      if (!currentGroup || currentGroup.rules.length > 0) {
        currentGroup = { userAgents: [], rules: [] };
        groups.push(currentGroup);
      }

      currentGroup.userAgents.push(value.toLowerCase());
      continue;
    }

    if (!currentGroup || (directive !== "allow" && directive !== "disallow")) {
      continue;
    }

    currentGroup.rules.push({
      directive,
      path: normalizeRulePath(value),
    });
  }

  const userAgentToken = userAgent.toLowerCase().split(/[ /\t]/u)[0] ?? userAgent.toLowerCase();
  const matchingGroups = groups.filter((group) =>
    group.userAgents.some((agent) => agent === "*" || userAgentToken.includes(agent)),
  );
  const matchingRules = matchingGroups.flatMap((group) => group.rules);
  let winner: RobotsRule | undefined;

  for (const rule of matchingRules) {
    if (rule.path === "") {
      continue;
    }

    if (!targetPath.startsWith(rule.path)) {
      continue;
    }

    if (!winner || rule.path.length > winner.path.length) {
      winner = rule;
      continue;
    }

    if (winner.path.length === rule.path.length && rule.directive === "allow") {
      winner = rule;
    }
  }

  return winner?.directive !== "disallow";
}

export class RobotsBlockedError extends Error {
  constructor(url: string) {
    super(`Robots.txt disallows fetching ${url}.`);
    this.name = "RobotsBlockedError";
  }
}
