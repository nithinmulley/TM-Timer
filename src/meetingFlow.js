const EMBEDDED_MEETING_FLOW = `ROLE - Entry Type - Time - Flags
Presiding Officer - Intro - 1 min - Red @ 1min
TMOD - Part1 - 4 mins - Red @ 4mins
General Evaluator - TAG Intro - 2 mins - Red @ 2mins
Timer - Intro - 1 min - Red @ 1min
Ah-Counter - Intro - 1 min - Red @ 1min
Grammarian - Intro - 2 mins - Red @ 2mins
General Evaluator - Speech Objectives - 2 Min - Red @ 2mins
TMOD - Speaker Intro - 2 min - Red @ 2min
Speaker 1 - Speech - 6 or 7 mins - Green @ 4mins or 5mins, Yellow @ 5mins or 6mins, Red @ 6mins or 7mins
Speaker 2 - Speech - 6 or 7 mins - Green @ 4mins or 5mins, Yellow @ 5mins or 6mins, Red @ 6mins or 7mins
Speaker 3 - Speech - 6 or 7 mins - Green @ 4mins or 5mins, Yellow @ 5mins or 6mins, Red @ 6mins or 7mins
TMOD - Part2 - 2 mins - Red @ 2mins
General Evaluator - Eval Intro - 2 min - Red @ 2mins
Evaluator 1 - Evaluation - 2 mins - Green @ 1min, Yellow @ 1.5min, Red @ 2mins
Evaluator 2 - Evaluation - 2 mins - Green @ 1min, Yellow @ 1.5min, Red @ 2mins
Evaluator 3 - Evaluation - 2 mins - Green @ 1min, Yellow @ 1.5min, Red @ 2mins
Ah-Counter - Report - 2 mins - Green @ 1min, Yellow @ 1.5min, Red @ 2mins
Grammarian - Report - 2 mins - Green @ 1.5min, Yellow @ 2min, Red @ 3mins
Timer - Report - 2 mins - Green @ 1min, Yellow @ 1.5min, Red @ 2mins
General Evaluator - Final GE report - 5 mins - Green @ 3min, Yellow @ 4min, Red @ 5mins
TMOD - Part3 - 2 mins - Red @ 2mins
Table Topics Master - Intro - 2 mins - Red @ 2mins
Table Topic Speaker 1 - TTS - 2 mins - Green @ 1min, Yellow @ 1.5min, Red @ 2mins
Table Topic Speaker 2 - TTS - 2 mins - Green @ 1min, Yellow @ 1.5min, Red @ 2mins
Table Topic Speaker 3 - TTS - 2 mins - Green @ 1min, Yellow @ 1.5min, Red @ 2mins
Table Topic Speaker 4 - TTS - 2 mins - Green @ 1min, Yellow @ 1.5min, Red @ 2mins
Table Topic Speaker 5 - TTS - 2 mins - Green @ 1min, Yellow @ 1.5min, Red @ 2mins
TMOD - Part4- 2 mins - Red @ 2mins
Presiding Officer - Conclusion - 1 min - Red @ 1min`;

export const DEFAULT_PROJECT = "P1:Ice Breaker";

export const SPEECH_PROJECT_OPTIONS = [
  DEFAULT_PROJECT,
  "P2 to P9",
  "P10:Inspire Your Audience",
];

export const DEFAULT_SLOT_COUNTS = {
  Speaker: 3,
  "Table Topic Speaker": 5,
};

function getProjectVariantIndex(roleProjects, role) {
  return roleProjects[role] === "P2 to P9" ? 1 : 0;
}

export function getSlotGroup(role) {
  let match = role.match(/^(Speaker|Evaluator) \d+$/);
  if (match) {
    return match[1];
  }

  match = role.match(/^(Table Topic Speaker) \d+$/);
  if (match) {
    return match[1];
  }

  return null;
}

function extractTimeSeconds(text, variantIndex = -1) {
  const numbers = text.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) {
    return 0;
  }

  const minutes = variantIndex >= 0 && numbers.length > variantIndex
    ? Number.parseFloat(numbers[variantIndex])
    : Number.parseFloat(numbers[numbers.length - 1]);
  return Math.round(minutes * 60);
}

function extractSignalSeconds(text, color, variantIndex = -1) {
  const match = text.match(new RegExp(`${color}\\s*@\\s*([^,]+)`, "i"));
  if (!match) {
    return null;
  }
  return extractTimeSeconds(match[1], variantIndex);
}

function parseMeetingFlowLine(line, roleProjects = {}) {
  const parts = line.split(" - ").map((part) => part.trim());
  let role;
  let entryType;
  let timeText;
  let flagsText;

  if (parts.length === 4) {
    [role, entryType, timeText, flagsText] = parts;
  } else if (parts.length === 3 && parts[1].includes("-")) {
    role = parts[0];
    [entryType, timeText] = parts[1].split(/\s*-\s*/);
    flagsText = parts[2];
  } else {
    return null;
  }

  const useVariant = timeText.toLowerCase().includes(" or ") || flagsText.toLowerCase().includes(" or ");
  const variantIndex = useVariant ? getProjectVariantIndex(roleProjects, role) : -1;
  const redSeconds = extractSignalSeconds(flagsText, "Red", variantIndex);
  const greenSeconds = extractSignalSeconds(flagsText, "Green", variantIndex);
  const yellowSeconds = extractSignalSeconds(flagsText, "Yellow", variantIndex);
  const allocatedSeconds = redSeconds || extractTimeSeconds(timeText, variantIndex);

  return {
    role,
    entryType,
    allocatedSeconds,
    greenSeconds,
    yellowSeconds,
    redSeconds: redSeconds || allocatedSeconds,
  };
}

function getSpeechProjectEntry(roleProjects, role, entryType) {
  const project = roleProjects[role] ?? DEFAULT_PROJECT;

  if (project === "P10:Inspire Your Audience") {
    return {
      role,
      entryType: project,
      allocatedSeconds: 600,
      greenSeconds: 480,
      yellowSeconds: 540,
      redSeconds: 600,
    };
  }

  if (project === "P2 to P9") {
    return {
      role,
      entryType: project,
      allocatedSeconds: 420,
      greenSeconds: 300,
      yellowSeconds: 360,
      redSeconds: 420,
    };
  }

  return {
    role,
    entryType: project || entryType,
    allocatedSeconds: 360,
    greenSeconds: 240,
    yellowSeconds: 300,
    redSeconds: 360,
  };
}

export function buildMeetingEntries(slotCounts, roleProjects) {
  const templateEntries = EMBEDDED_MEETING_FLOW
    .split(/\r?\n/)
    .slice(1)
    .map((line) => parseMeetingFlowLine(line, roleProjects))
    .filter(Boolean);

  const expandedGroups = new Set();
  const entries = [];
  const normalizedSlotCounts = {
    ...slotCounts,
    Evaluator: slotCounts.Speaker,
  };

  for (const entry of templateEntries) {
    const slotGroup = getSlotGroup(entry.role);
    if (!slotGroup) {
      entries.push(entry);
      continue;
    }

    if (expandedGroups.has(slotGroup)) {
      continue;
    }

    expandedGroups.add(slotGroup);
    const count = normalizedSlotCounts[slotGroup] ?? 1;

    for (let slotNumber = 1; slotNumber <= count; slotNumber += 1) {
      const role = `${slotGroup} ${slotNumber}`;
      let clonedEntry = {
        ...entry,
        role,
      };

      if (slotGroup === "Speaker" && entry.entryType.toLowerCase() === "speech") {
        clonedEntry = getSpeechProjectEntry(roleProjects, role, entry.entryType);
      }

      entries.push(clonedEntry);
    }
  }

  return entries;
}

export function getUniqueRoles(entries) {
  const roles = [];
  for (const entry of entries) {
    if (!roles.includes(entry.role)) {
      roles.push(entry.role);
    }
  }
  return roles;
}

export function getEntryKey(entry) {
  return `${entry.role}__${entry.entryType}`;
}

export function getSignal(entry, elapsedSeconds) {
  if (elapsedSeconds >= entry.redSeconds) {
    return "red";
  }
  if (entry.yellowSeconds && elapsedSeconds >= entry.yellowSeconds) {
    return "yellow";
  }
  if (entry.greenSeconds && elapsedSeconds >= entry.greenSeconds) {
    return "green";
  }
  return "default";
}

export function isSpeechRole(entries, role) {
  return entries.some((entry) => entry.role === role && getSlotGroup(entry.role) === "Speaker");
}

export { EMBEDDED_MEETING_FLOW };
