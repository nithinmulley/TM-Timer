import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildMeetingEntries,
  DEFAULT_PROJECT,
  DEFAULT_SLOT_COUNTS,
  SPEECH_PROJECT_OPTIONS,
  getEntryKey,
  getSignal,
  getSlotGroup,
  getUniqueRoles,
  isSpeechRole,
} from "./meetingFlow";

const PROJECT_OPTIONS = SPEECH_PROJECT_OPTIONS;
const STORAGE_KEY = "tm-timer-projector-state";
const SIGNAL_COLORS = {
  default: "#f6f1e8",
  green: "#2d8a57",
  yellow: "#f1bd3a",
  red: "#c94a3b",
};

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseMaskedDuration(text) {
  const match = text.trim().match(/^(\d+):([0-5]\d)$/);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

function digitsToMaskedTime(text) {
  const digits = text.replace(/\D/g, "").slice(0, 4).padStart(4, "0");
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function getTimingStatus(usedSeconds, allocatedSeconds, minimumSeconds) {
  if (usedSeconds > allocatedSeconds) {
    return "Exceeded time";
  }
  if (usedSeconds === 0 || (minimumSeconds && usedSeconds < minimumSeconds)) {
    return "Short timed";
  }
  return "Within time";
}

function buildReportRows(entries, roleNames, elapsedByKey) {
  const grouped = new Map();
  const totalAllocatedByRole = new Map();

  for (const entry of entries) {
    totalAllocatedByRole.set(
      entry.role,
      (totalAllocatedByRole.get(entry.role) ?? 0) + entry.allocatedSeconds,
    );
  }

  for (const entry of entries) {
    const used = elapsedByKey[getEntryKey(entry)] ?? 0;
    if (used <= 0) {
      continue;
    }

    const current = grouped.get(entry.role) ?? {
      role: entry.role,
      name: roleNames[entry.role]?.trim() || "Not assigned",
      used: 0,
      allocated: 0,
      minimum: 0,
    };
    current.name = roleNames[entry.role]?.trim() || current.name;
    current.used += used;
    current.allocated += entry.allocatedSeconds;
    current.minimum += entry.greenSeconds ?? 0;
    grouped.set(entry.role, current);
  }

  return Array.from(grouped.values()).map((row) => ({
    ...row,
    allocatedUntilNowText: formatTime(row.allocated),
    totalAllocatedText: formatTime(totalAllocatedByRole.get(row.role) ?? row.allocated),
    usedText: formatTime(row.used),
    status: getTimingStatus(row.used, row.allocated, row.minimum),
  }));
}

function getRoleTiming(entries, elapsedByKey, currentEntry, elapsedSeconds) {
  if (!currentEntry) {
    return {
      allocated: 0,
      used: 0,
      remaining: 0,
    };
  }

  const currentKey = getEntryKey(currentEntry);
  const allocated = entries
    .filter((entry) => entry.role === currentEntry.role)
    .reduce((total, entry) => total + entry.allocatedSeconds, 0);
  const used = entries
    .filter((entry) => entry.role === currentEntry.role)
    .reduce((total, entry) => {
      const key = getEntryKey(entry);
      const duration = key === currentKey ? elapsedSeconds : elapsedByKey[key] ?? 0;
      return total + duration;
    }, 0);

  return {
    allocated,
    used,
    remaining: Math.max(0, allocated - used),
  };
}

function getTotalAllocatedSeconds(entries) {
  return entries.reduce((total, entry) => total + entry.allocatedSeconds, 0);
}

function isFinalPresidingOfficerEntry(entry) {
  return entry?.role === "Presiding Officer" && entry.entryType === "Conclusion";
}

function getAgendaText(entries, currentIndex) {
  const previousText = currentIndex === 0
    ? "Previous: Not started"
    : `Previous: ${entries[currentIndex - 1].role} (${entries[currentIndex - 1].entryType})`;
  const nextText = currentIndex >= entries.length - 1
    ? "Next: Meeting complete"
    : `Next: ${entries[currentIndex + 1].role} (${entries[currentIndex + 1].entryType})`;
  return `${previousText} | ${nextText}`;
}

function findEntryIndex(entries, role, entryType) {
  return entries.findIndex((entry) => entry.role === role && entry.entryType === entryType);
}

function getShortcutTargets(entries, currentEntry, currentIndex) {
  if (!currentEntry) {
    return [];
  }

  const shortcuts = [];
  const addShortcut = (label, role, entryType, side = "left") => {
    const index = findEntryIndex(entries, role, entryType);
    if (index >= 0 && index !== currentIndex) {
      shortcuts.push({
        key: `${role}__${entryType}`,
        label,
        index,
        side,
      });
    }
  };

  const speakerIndices = entries
    .map((entry, index) => (getSlotGroup(entry.role) === "Speaker" ? index : -1))
    .filter((index) => index >= 0);
  const speakerIntroIndex = findEntryIndex(entries, "TMOD", "Speaker Intro");
  const firstSpeakerIndex = speakerIndices[0] ?? -1;
  const lastSpeakerIndex = speakerIndices[speakerIndices.length - 1] ?? -1;

  if (
    speakerIntroIndex >= 0
    && firstSpeakerIndex >= 0
    && currentIndex >= speakerIntroIndex
    && currentIndex <= lastSpeakerIndex
  ) {
    if (currentIndex === lastSpeakerIndex) {
      addShortcut("TMOD Part2", "TMOD", "Part2", "right");
    } else {
      addShortcut("TMOD Speaker Intro", "TMOD", "Speaker Intro");
    }
  }

  if (currentEntry.role === "General Evaluator" && currentEntry.entryType === "TAG Intro") {
    addShortcut("Timer", "Timer", "Intro");
    addShortcut("Ah-Counter", "Ah-Counter", "Intro");
    addShortcut("Grammarian", "Grammarian", "Intro");
  }

  if (currentEntry.role === "TMOD" && currentEntry.entryType === "Speaker Intro") {
    entries
      .filter((entry) => getSlotGroup(entry.role) === "Speaker")
      .forEach((entry) => addShortcut(entry.role, entry.role, entry.entryType));
  }

  if (
    ["Timer", "Ah-Counter", "Grammarian"].includes(currentEntry.role)
    && currentEntry.entryType === "Intro"
  ) {
    addShortcut("GE TAG Intro", "General Evaluator", "TAG Intro");
    addShortcut("GE Speech Objectives", "General Evaluator", "Speech Objectives", "right");
  }

  if (currentEntry.role === "General Evaluator" && currentEntry.entryType === "Eval Intro") {
    entries
      .filter((entry) => getSlotGroup(entry.role) === "Evaluator" && entry.entryType === "Evaluation")
      .forEach((entry) => addShortcut(entry.role, entry.role, entry.entryType));
    addShortcut("Ah-Counter", "Ah-Counter", "Report", "right");
    addShortcut("Grammarian", "Grammarian", "Report", "right");
    addShortcut("Timer", "Timer", "Report", "right");
  }

  if (getSlotGroup(currentEntry.role) === "Evaluator" && currentEntry.entryType === "Evaluation") {
    addShortcut("GE Eval Intro", "General Evaluator", "Eval Intro");
  }

  if (
    ["Ah-Counter", "Grammarian", "Timer"].includes(currentEntry.role)
    && currentEntry.entryType === "Report"
  ) {
    addShortcut("GE Eval Intro", "General Evaluator", "Eval Intro");
    addShortcut("GE Final Report", "General Evaluator", "Final GE report", "right");
  }

  return shortcuts;
}

function useProjectorSnapshot(enabled) {
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const loadSnapshot = () => {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          setSnapshot(JSON.parse(raw));
        } catch {
          setSnapshot(null);
        }
      }
    };

    loadSnapshot();
    const handleStorage = (event) => {
      if (event.key === STORAGE_KEY) {
        loadSnapshot();
      }
    };
    const intervalId = window.setInterval(loadSnapshot, 1000);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("storage", handleStorage);
    };
  }, [enabled]);

  return snapshot;
}

function Modal({ children, onClose, title, wide = false }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={`modal-shell ${wide ? "modal-shell-wide" : ""}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="ghost-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SetupScreen({
  meetingEntries,
  roleNames,
  roleProjects,
  slotCounts,
  totalAllocatedSeconds,
  onRoleNameChange,
  onProjectChange,
  onSlotCountChange,
  onStartMeeting,
}) {
  const roles = getUniqueRoles(meetingEntries);

  return (
    <section className="setup-shell">
      <header className="hero-card">
        <p className="eyebrow">TM Timer</p>
        <h1>Meeting setup</h1>
        <p className="hero-copy">
          Configure the live agenda, assign speakers, and then run the meeting.
        </p>
        <p className="hero-meta">Total allocated meeting time: {formatTime(totalAllocatedSeconds)}</p>
      </header>

      <div className="setup-grid">
        <div className="panel">
          <div className="panel-header">
            <h2>Slot counts</h2>
            <p>Evaluator slots always match speaker slots.</p>
          </div>
          <div className="slot-grid">
            {["Speaker", "Table Topic Speaker"].map((group) => (
              <div className="slot-card" key={group}>
                <span>{group}</span>
                <div className="slot-controls">
                  <button type="button" onClick={() => onSlotCountChange(group, Math.max(1, slotCounts[group] - 1))}>
                    -
                  </button>
                  <strong>{slotCounts[group]}</strong>
                  <button type="button" onClick={() => onSlotCountChange(group, slotCounts[group] + 1)}>
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Role assignments</h2>
            <p>Table Topic speakers are set during the meeting.</p>
          </div>
          <div className="role-table">
            <div className="role-table-header">Role</div>
            <div className="role-table-header">Name</div>
            <div className="role-table-header">Project</div>
            {roles.map((role) => (
              <FragmentRow key={role}>
                <div className="role-label">{role}</div>
                {getSlotGroup(role) === "Table Topic Speaker" ? (
                  <div className="muted-text">Set during meeting</div>
                ) : (
                  <input
                    value={roleNames[role] ?? ""}
                    onChange={(event) => onRoleNameChange(role, event.target.value)}
                    placeholder="Enter name"
                  />
                )}
                {isSpeechRole(meetingEntries, role) ? (
                  <select
                    value={roleProjects[role] ?? DEFAULT_PROJECT}
                    onChange={(event) => onProjectChange(role, event.target.value)}
                  >
                    {PROJECT_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="muted-text">-</div>
                )}
              </FragmentRow>
            ))}
          </div>
        </div>
      </div>

      <div className="setup-actions">
        <button className="primary-button" type="button" onClick={onStartMeeting}>
          Start meeting
        </button>
      </div>
    </section>
  );
}

function FragmentRow({ children }) {
  return <>{children}</>;
}

function RolePlayersModal({
  meetingEntries,
  roleNames,
  roleProjects,
  slotCounts,
  onClose,
  onRoleNameChange,
  onProjectChange,
  onSlotCountChange,
}) {
  const roles = getUniqueRoles(meetingEntries);

  return (
    <Modal title="Role players" onClose={onClose} wide>
      <div className="panel panel-in-modal">
        <div className="slot-grid">
          {["Speaker", "Table Topic Speaker"].map((group) => (
            <div className="slot-card" key={group}>
              <span>{group}</span>
              <div className="slot-controls">
                <button type="button" onClick={() => onSlotCountChange(group, Math.max(1, slotCounts[group] - 1))}>
                  -
                </button>
                <strong>{slotCounts[group]}</strong>
                <button type="button" onClick={() => onSlotCountChange(group, slotCounts[group] + 1)}>
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="role-table">
        <div className="role-table-header">Role</div>
        <div className="role-table-header">Name</div>
        <div className="role-table-header">Project</div>
        {roles.map((role) => (
          <FragmentRow key={role}>
            <div className="role-label">{role}</div>
            <input
              value={roleNames[role] ?? ""}
              onChange={(event) => onRoleNameChange(role, event.target.value)}
              placeholder={getSlotGroup(role) === "Table Topic Speaker" ? "Set during meeting" : "Enter name"}
            />
            {isSpeechRole(meetingEntries, role) ? (
              <select
                value={roleProjects[role] ?? DEFAULT_PROJECT}
                onChange={(event) => onProjectChange(role, event.target.value)}
              >
                {PROJECT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <div className="muted-text">-</div>
            )}
          </FragmentRow>
        ))}
      </div>
    </Modal>
  );
}

function ReportModal({ rows, onClose, onCopy, onExport }) {
  return (
    <Modal title="Final report" onClose={onClose} wide>
      <div className="report-table">
        <div className="report-header">Role</div>
        <div className="report-header">TM</div>
        <div className="report-header">Allocated until now</div>
        <div className="report-header">Total allocated</div>
        <div className="report-header">Time Used</div>
        <div className="report-header">Status</div>
        {rows.length === 0 ? (
          <div className="empty-state">No recorded times yet.</div>
        ) : (
          rows.map((row) => (
            <FragmentRow key={row.role}>
              <div>{row.role}</div>
              <div>{row.name}</div>
              <div>{row.allocatedUntilNowText}</div>
              <div>{row.totalAllocatedText}</div>
              <div>{row.usedText}</div>
              <div>{row.status}</div>
            </FragmentRow>
          ))
        )}
      </div>
      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={onCopy}>
          Copy report
        </button>
        <button className="secondary-button" type="button" onClick={onExport}>
          Export CSV
        </button>
      </div>
    </Modal>
  );
}

function EditLogModal({ entry, initialName, initialDuration, onClose, onSave }) {
  const [name, setName] = useState(initialName);
  const [duration, setDuration] = useState(formatTime(initialDuration));

  return (
    <Modal title="Edit log" onClose={onClose}>
      <div className="edit-grid">
        <div className="muted-text full-width">
          {entry.role} ({entry.entryType})
        </div>
        <label htmlFor="edit-name">TM</label>
        <input
          id="edit-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Enter name"
        />
        <label htmlFor="edit-duration">Duration</label>
        <input
          id="edit-duration"
          value={duration}
          onChange={(event) => setDuration(digitsToMaskedTime(event.target.value))}
          placeholder="00:00"
        />
        <div className="muted-text full-width">Type four digits like 0400 to get 04:00.</div>
      </div>
      <div className="modal-actions">
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            const parsed = parseMaskedDuration(duration);
            if (parsed === null) {
              window.alert("Enter a duration like 04:00.");
              return;
            }
            onSave(name.trim(), parsed);
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

function AboutModal({ onClose }) {
  return (
    <Modal title="About TM Timer" onClose={onClose}>
      <div className="about-copy">
        <p>
          TM Timer helps run a full meeting agenda, track each role, show color signals, manage role players, and produce a final timing report in the browser.
        </p>
        <p>Publisher: Nithin Mulley</p>
      </div>
    </Modal>
  );
}

function ConfirmModal({ body, confirmLabel, onCancel, onConfirm, title }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="confirm-copy">{body}</p>
      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function ProjectorView({ snapshot }) {
  const signal = snapshot?.signal ?? "default";
  const background = SIGNAL_COLORS[signal];
  const foreground = signal === "yellow" || signal === "default" ? "#222222" : "#ffffff";

  if (!snapshot) {
    return (
      <main className="projector-shell" style={{ background, color: foreground }}>
        <h1>Projector mode</h1>
        <p>Open the main timer view in another tab to start broadcasting live meeting data.</p>
      </main>
    );
  }

  return (
    <main className="projector-shell" style={{ background, color: foreground }}>
      <div className="projector-countdown">
        <span>Role time remaining</span>
        <strong>{snapshot.roleRemainingText}</strong>
        <small>{snapshot.roleTimingText}</small>
      </div>
      <div className="projector-card">
        <p className="projector-role">{snapshot.roleDisplay}</p>
        <p className="projector-time">{snapshot.elapsedText}</p>
        <p className="projector-signal">{snapshot.signalText}</p>
        <p className="projector-detail">{snapshot.allocationText}</p>
        <p className="projector-detail">{snapshot.progressText}</p>
      </div>
    </main>
  );
}

function App() {
  const isProjectorView = useMemo(
    () => new URLSearchParams(window.location.search).get("view") === "projector",
    [],
  );
  const projectorSnapshot = useProjectorSnapshot(isProjectorView);

  const [screen, setScreen] = useState("setup");
  const [slotCounts, setSlotCounts] = useState(DEFAULT_SLOT_COUNTS);
  const [roleProjects, setRoleProjects] = useState({});
  const [roleNames, setRoleNames] = useState({});
  const [currentEntryIndex, setCurrentEntryIndex] = useState(0);
  const [elapsedByKey, setElapsedByKey] = useState({});
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [meetingElapsedSeconds, setMeetingElapsedSeconds] = useState(0);
  const [meetingClockRunning, setMeetingClockRunning] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [rolePlayersOpen, setRolePlayersOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [reloadOpen, setReloadOpen] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const tableTopicInputRef = useRef(null);

  const meetingEntries = useMemo(
    () => buildMeetingEntries(slotCounts, roleProjects),
    [roleProjects, slotCounts],
  );
  useEffect(() => {
    setCurrentEntryIndex((current) => Math.min(current, Math.max(meetingEntries.length - 1, 0)));
  }, [meetingEntries.length]);

  const currentEntry = meetingEntries[currentEntryIndex];
  const currentEntryKey = currentEntry ? getEntryKey(currentEntry) : null;
  const currentRoleName = currentEntry ? roleNames[currentEntry.role]?.trim() ?? "" : "";
  const currentRoleDisplay = currentEntry
    ? currentRoleName
      ? `${currentEntry.role} - ${currentRoleName} (${currentEntry.entryType})`
      : `${currentEntry.role} (${currentEntry.entryType})`
    : "";
  const signal = currentEntry ? getSignal(currentEntry, elapsedSeconds) : "default";
  const reportRows = useMemo(
    () => buildReportRows(meetingEntries, roleNames, elapsedByKey),
    [elapsedByKey, meetingEntries, roleNames],
  );
  const currentRoleTiming = useMemo(
    () => getRoleTiming(meetingEntries, elapsedByKey, currentEntry, elapsedSeconds),
    [currentEntry, elapsedByKey, elapsedSeconds, meetingEntries],
  );
  const totalAllocatedSeconds = useMemo(
    () => getTotalAllocatedSeconds(meetingEntries),
    [meetingEntries],
  );
  const shortcutTargets = useMemo(
    () => getShortcutTargets(meetingEntries, currentEntry, currentEntryIndex),
    [currentEntry, currentEntryIndex, meetingEntries],
  );
  const leftShortcutTargets = shortcutTargets.filter((shortcut) => shortcut.side !== "right");
  const rightShortcutTargets = shortcutTargets.filter((shortcut) => shortcut.side === "right");

  useEffect(() => {
    if (!timerRunning) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [timerRunning]);

  useEffect(() => {
    if (!meetingClockRunning) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setMeetingElapsedSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [meetingClockRunning]);

  useEffect(() => {
    if (screen !== "meeting") {
      return undefined;
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [screen]);

  useEffect(() => {
    if (screen !== "meeting" || !currentEntry) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      const tagName = event.target.tagName;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(tagName)) {
        return;
      }

      if (event.key === " ") {
        event.preventDefault();
        setTimerRunning((running) => !running);
      } else if (event.key === "Enter") {
        event.preventDefault();
        finishTimer();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveToEntry(currentEntryIndex + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveToEntry(currentEntryIndex - 1);
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resetCurrentTimer();
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setReportOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentEntry, currentEntryIndex, screen, timerRunning]);

  useEffect(() => {
    if (screen !== "meeting" || !currentEntry) {
      return;
    }

    const snapshot = {
      roleDisplay: currentRoleDisplay,
      elapsedText: formatTime(elapsedSeconds),
      roleRemainingText: formatTime(currentRoleTiming.remaining),
      roleTimingText: `Used of ${formatTime(currentRoleTiming.allocated)}`,
      signal,
      signalText: signal === "default" ? "READY" : signal.toUpperCase(),
      allocationText: getAllocationText(currentEntry, elapsedSeconds),
      progressText: `Transition ${currentEntryIndex + 1} of ${meetingEntries.length}`,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }, [
    currentEntry,
    currentEntryIndex,
    currentRoleDisplay,
    currentRoleTiming,
    elapsedSeconds,
    meetingEntries.length,
    screen,
    signal,
  ]);

  useEffect(() => {
    if (screen === "meeting" && getSlotGroup(currentEntry?.role) === "Table Topic Speaker") {
      tableTopicInputRef.current?.focus();
    }
  }, [currentEntry?.role, screen]);

  function getSavedElapsed(entry) {
    return entry ? elapsedByKey[getEntryKey(entry)] ?? 0 : 0;
  }

  function saveCurrentElapsed() {
    if (!currentEntry || elapsedSeconds <= 0) {
      return;
    }
    setElapsedByKey((current) => ({
      ...current,
      [currentEntryKey]: elapsedSeconds,
    }));
  }

  function moveToEntry(nextIndex) {
    if (!currentEntry) {
      return;
    }

    setTimerRunning(false);
    if (elapsedSeconds > 0) {
      setElapsedByKey((current) => ({
        ...current,
        [currentEntryKey]: elapsedSeconds,
      }));
    }

    const clamped = Math.max(0, Math.min(nextIndex, meetingEntries.length - 1));
    setCurrentEntryIndex(clamped);
    setElapsedSeconds(getSavedElapsed(meetingEntries[clamped]));
  }

  function startMeeting() {
    setScreen("meeting");
    setCurrentEntryIndex(0);
    setElapsedByKey({});
    setElapsedSeconds(0);
    setTimerRunning(false);
    setMeetingElapsedSeconds(0);
    setMeetingClockRunning(false);
  }

  useEffect(() => {
    if (
      timerRunning
      && !meetingClockRunning
      && currentEntry
      && currentEntry.role === "Presiding Officer"
      && currentEntry.entryType === "Intro"
    ) {
      setMeetingClockRunning(true);
    }
  }, [timerRunning, meetingClockRunning, currentEntry]);

  function finishTimer() {
    if (!currentEntry || elapsedSeconds <= 0) {
      window.alert("Start the timer before recording this role.");
      return;
    }

    saveCurrentElapsed();
    if (currentEntryIndex >= meetingEntries.length - 1) {
      setTimerRunning(false);
      if (isFinalPresidingOfficerEntry(currentEntry)) {
        setMeetingClockRunning(false);
      }
      return;
    }
    moveToEntry(currentEntryIndex + 1);
  }

  function resetCurrentTimer() {
    if (elapsedSeconds > 0 && !window.confirm("Reset the current timer without recording this time?")) {
      return;
    }
    setTimerRunning(false);
    setElapsedSeconds(0);
    if (currentEntryKey) {
      setElapsedByKey((current) => {
        const next = { ...current };
        delete next[currentEntryKey];
        return next;
      });
    }
  }

  function reloadMeeting() {
    setTimerRunning(false);
    setReportOpen(false);
    setRolePlayersOpen(false);
    setReloadOpen(false);
    setEditingKey(null);
    setElapsedByKey({});
    setElapsedSeconds(0);
    setMeetingElapsedSeconds(0);
    setMeetingClockRunning(false);
    setCurrentEntryIndex(0);
    setScreen("setup");
  }

  function handleCopyReport() {
    const lines = ["Role\tTM\tAllocated until now\tTotal allocated\tTime Used\tStatus"];
    for (const row of reportRows) {
      lines.push([
        row.role,
        row.name,
        row.allocatedUntilNowText,
        row.totalAllocatedText,
        row.usedText,
        row.status,
      ].join("\t"));
    }
    navigator.clipboard?.writeText(lines.join("\n"));
  }

  function handleExportCsv() {
    const rows = [
      ["Meeting elapsed time", formatTime(meetingElapsedSeconds)],
      [],
      ["Role", "TM", "Allocated until now", "Total allocated", "Time Used", "Status"],
      ...reportRows.map((row) => [
        row.role,
        row.name,
        row.allocatedUntilNowText,
        row.totalAllocatedText,
        row.usedText,
        row.status,
      ]),
    ];
    const csv = rows
      .map((row) => row.map((value) => escapeCsv(value)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tm-final-report.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function openProjectorView() {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "projector");
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }

  function getAllocationText(entry, usedSeconds) {
    const allocatedText = formatTime(entry.allocatedSeconds);
    if (usedSeconds > entry.allocatedSeconds) {
      return `Allocated: ${allocatedText} | Over by ${formatTime(usedSeconds - entry.allocatedSeconds)}`;
    }
    return `Allocated: ${allocatedText}`;
  }

  if (isProjectorView) {
    return <ProjectorView snapshot={projectorSnapshot} />;
  }

  const currentSignalColor = SIGNAL_COLORS[signal];
  const foreground = signal === "yellow" || signal === "default" ? "#1c1c1c" : "#ffffff";
  const editingEntry = editingKey
    ? meetingEntries.find((entry) => getEntryKey(entry) === editingKey) ?? null
    : null;

  return (
    <main className={`app-shell ${screen === "meeting" ? "meeting-app-shell" : ""}`}>
      {screen === "setup" ? (
        <SetupScreen
          meetingEntries={meetingEntries}
          roleNames={roleNames}
          roleProjects={roleProjects}
          slotCounts={slotCounts}
          totalAllocatedSeconds={totalAllocatedSeconds}
          onRoleNameChange={(role, value) => setRoleNames((current) => ({ ...current, [role]: value }))}
          onProjectChange={(role, value) => setRoleProjects((current) => ({ ...current, [role]: value }))}
          onSlotCountChange={(group, value) => setSlotCounts((current) => ({ ...current, [group]: value }))}
          onStartMeeting={startMeeting}
        />
      ) : (
        <section className="meeting-screen" style={{ "--signal-color": currentSignalColor }}>
          <div className="meeting-toolbar">
            <div className="toolbar-total">
              <span>Meeting time</span>
              <strong>{formatTime(meetingElapsedSeconds)}</strong>
            </div>
            <button className="nav-button" type="button" onClick={() => setRolePlayersOpen(true)}>
              Role Players
            </button>
            <button className="nav-button" type="button" onClick={() => setReportOpen(true)}>
              Final Report
            </button>
            <button className="nav-button" type="button" onClick={handleExportCsv}>
              Export CSV
            </button>
            <button className="nav-button" type="button" onClick={() => setReloadOpen(true)}>
              Reload Meeting
            </button>
            <button className="nav-button" type="button" onClick={() => setAboutOpen(true)}>
              About
            </button>
            <div className="toolbar-stepper" aria-label="Table Topic Speaker count">
              <span>Table Topic Speakers</span>
              <button
                type="button"
                onClick={() => setSlotCounts((current) => ({
                  ...current,
                  "Table Topic Speaker": Math.max(1, current["Table Topic Speaker"] - 1),
                }))}
              >
                -
              </button>
              <strong>{slotCounts["Table Topic Speaker"]}</strong>
              <button
                type="button"
                onClick={() => setSlotCounts((current) => ({
                  ...current,
                  "Table Topic Speaker": current["Table Topic Speaker"] + 1,
                }))}
              >
                +
              </button>
            </div>
          </div>

          <div className="meeting-shell">
            <aside className="sidebar">
              <div className="sidebar-card">
                <div className="sidebar-header">
                  <div>
                    <p className="eyebrow">Meeting Flow</p>
                    <h2>Agenda</h2>
                  </div>
                  <span className="step-pill">
                    {currentEntryIndex + 1}/{meetingEntries.length}
                  </span>
                </div>
                <div className="sidebar-actions">
                  <button className="secondary-button" type="button" onClick={() => setEditingKey(currentEntryKey)}>
                    Edit log
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      if (!currentEntryKey || !(elapsedByKey[currentEntryKey] || elapsedSeconds)) {
                        window.alert("That transition does not have a recorded time.");
                        return;
                      }
                      if (!window.confirm("Clear time for the selected transition?")) {
                        return;
                      }
                      setElapsedByKey((current) => {
                        const next = { ...current };
                        delete next[currentEntryKey];
                        return next;
                      });
                      setElapsedSeconds(0);
                    }}
                  >
                    Delete log
                  </button>
                  <button className="secondary-button" type="button" onClick={handleCopyReport}>
                    Copy report
                  </button>
                </div>
                <div className="log-scroll" aria-label="Meeting transitions">
                  <div className="log-table">
                    <div className="log-header">#</div>
                    <div className="log-header">Transition</div>
                    <div className="log-header">Alloc</div>
                    <div className="log-header">Time</div>
                    {meetingEntries.map((entry, index) => {
                      const key = getEntryKey(entry);
                      const duration = index === currentEntryIndex && elapsedSeconds > 0
                        ? elapsedSeconds
                        : elapsedByKey[key] ?? 0;
                      const hasDuration = duration > 0;
                      const isCurrent = index === currentEntryIndex;
                      const name = roleNames[entry.role]?.trim();
                      const roleText = name ? `${entry.role} - ${name}` : entry.role;

                      return (
                        <FragmentRow key={key}>
                          <button
                            type="button"
                            className={`log-row ${isCurrent ? "log-row-current" : hasDuration ? "log-row-complete" : ""}`}
                            onClick={() => moveToEntry(index)}
                          >
                            {index + 1}
                          </button>
                          <button
                            type="button"
                            className={`log-row ${isCurrent ? "log-row-current" : hasDuration ? "log-row-complete" : ""}`}
                            onClick={() => moveToEntry(index)}
                          >
                            {roleText} ({entry.entryType})
                          </button>
                          <button
                            type="button"
                            className={`log-row ${isCurrent ? "log-row-current" : hasDuration ? "log-row-complete" : ""}`}
                            onClick={() => moveToEntry(index)}
                          >
                            {formatTime(entry.allocatedSeconds)}
                          </button>
                          <button
                            type="button"
                            className={`log-row ${isCurrent ? "log-row-current" : hasDuration ? "log-row-complete" : ""}`}
                            onClick={() => moveToEntry(index)}
                          >
                            {hasDuration ? formatTime(duration) : ""}
                          </button>
                        </FragmentRow>
                      );
                    })}
                  </div>
                </div>
              </div>
            </aside>

            <section className="timer-panel" style={{ background: currentSignalColor, color: foreground }}>
              <div className="timer-panel-inner">
                <div className="timer-side-rail">
                  <div className="role-countdown-card timer-countdown-card">
                    <span>Role time remaining</span>
                    <strong>{formatTime(currentRoleTiming.remaining)}</strong>
                    <small>
                      Used of {formatTime(currentRoleTiming.allocated)}
                    </small>
                  </div>
                  {shortcutTargets.length > 0 ? (
                    <div
                      className={`shortcut-panel ${
                        leftShortcutTargets.length > 0 && rightShortcutTargets.length > 0
                          ? ""
                          : "shortcut-panel-single"
                      }`}
                      aria-label="Transition shortcuts"
                    >
                      <span>Shortcuts</span>
                      <div className="shortcut-grid">
                        <div className="shortcut-column">
                          {leftShortcutTargets.map((shortcut) => (
                            <button
                              className="shortcut-button"
                              key={shortcut.key}
                              type="button"
                              onClick={() => moveToEntry(shortcut.index)}
                            >
                              {shortcut.label}
                            </button>
                          ))}
                        </div>
                        <div className="shortcut-column">
                          {rightShortcutTargets.map((shortcut) => (
                            <button
                              className="shortcut-button"
                              key={shortcut.key}
                              type="button"
                              onClick={() => moveToEntry(shortcut.index)}
                            >
                              {shortcut.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
                <h1 className="role-display">{currentRoleDisplay}</h1>
                <div className="time-display">{formatTime(elapsedSeconds)}</div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${Math.min(100, (elapsedSeconds / Math.max(currentEntry.allocatedSeconds, 1)) * 100)}%`,
                    }}
                  />
                </div>
                <div className="signal-display">
                  {signal === "default" ? "Ready" : signal.toUpperCase()}
                </div>
                <p className="meta-line">{getAllocationText(currentEntry, elapsedSeconds)}</p>
                <p className="meta-line">Transition {currentEntryIndex + 1} of {meetingEntries.length}</p>
                <p className="meta-line">{getAgendaText(meetingEntries, currentEntryIndex)}</p>

                {getSlotGroup(currentEntry.role) === "Table Topic Speaker" ? (
                  <div className="table-topic-card">
                    <label htmlFor="table-topic-name">Table Topic name</label>
                    <input
                      id="table-topic-name"
                      ref={tableTopicInputRef}
                      value={roleNames[currentEntry.role] ?? ""}
                      onChange={(event) => setRoleNames((current) => ({ ...current, [currentEntry.role]: event.target.value }))}
                      placeholder="Enter speaker name"
                    />
                  </div>
                ) : null}

                <div className="timer-controls">
                  <div className="timer-control-row">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => setTimerRunning((running) => !running)}
                    >
                      {timerRunning ? "Pause" : elapsedSeconds > 0 ? "Resume" : "Start"}
                    </button>
                    <button className="accent-button" type="button" onClick={finishTimer} disabled={elapsedSeconds <= 0}>
                      Finish
                    </button>
                    <button className="secondary-button" type="button" onClick={resetCurrentTimer}>
                      Reset
                    </button>
                  </div>
                  <div className="timer-control-row">
                    <button className="arrow-button" type="button" onClick={() => moveToEntry(currentEntryIndex - 1)} disabled={currentEntryIndex === 0}>
                      {"\u2190"}
                    </button>
                    <button className="arrow-button" type="button" onClick={() => moveToEntry(currentEntryIndex + 1)} disabled={currentEntryIndex >= meetingEntries.length - 1}>
                      {"\u2192"}
                    </button>
                    <button className="secondary-button" type="button" onClick={openProjectorView}>
                      Projector Mode
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>
      )}

      {reportOpen ? (
        <ReportModal
          rows={reportRows}
          onClose={() => setReportOpen(false)}
          onCopy={handleCopyReport}
          onExport={handleExportCsv}
        />
      ) : null}

      {rolePlayersOpen ? (
        <RolePlayersModal
          meetingEntries={meetingEntries}
          roleNames={roleNames}
          roleProjects={roleProjects}
          slotCounts={slotCounts}
          onClose={() => setRolePlayersOpen(false)}
          onRoleNameChange={(role, value) => setRoleNames((current) => ({ ...current, [role]: value }))}
          onProjectChange={(role, value) => setRoleProjects((current) => ({ ...current, [role]: value }))}
          onSlotCountChange={(group, value) => setSlotCounts((current) => ({ ...current, [group]: value }))}
        />
      ) : null}

      {aboutOpen ? <AboutModal onClose={() => setAboutOpen(false)} /> : null}

      {reloadOpen ? (
        <ConfirmModal
          title="Reload meeting"
          body="Reset all recorded times and return to the meeting setup screen?"
          confirmLabel="Reload meeting"
          onCancel={() => setReloadOpen(false)}
          onConfirm={reloadMeeting}
        />
      ) : null}

      {editingEntry ? (
        <EditLogModal
          entry={editingEntry}
          initialName={roleNames[editingEntry.role] ?? ""}
          initialDuration={elapsedByKey[getEntryKey(editingEntry)] ?? (editingEntry === currentEntry ? elapsedSeconds : 0)}
          onClose={() => setEditingKey(null)}
          onSave={(name, duration) => {
            setRoleNames((current) => ({ ...current, [editingEntry.role]: name }));
            setElapsedByKey((current) => ({ ...current, [getEntryKey(editingEntry)]: duration }));
            if (getEntryKey(editingEntry) === currentEntryKey) {
              setElapsedSeconds(duration);
            }
            if (duration > 0 && isFinalPresidingOfficerEntry(editingEntry)) {
              setMeetingClockRunning(false);
            }
            setEditingKey(null);
          }}
        />
      ) : null}
    </main>
  );
}

function escapeCsv(value) {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

export default App;
