"use client";

import { Bell, Desktop, Funnel, PlugsConnected, SquaresFour } from "@phosphor-icons/react";
import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { OwnerPage } from "./owner-page";
import { IngestionRules } from "./ingested";
import { NotificationSettings } from "./notifications";
import { button, Panel, problem, Quiet, showDay, showTime } from "./parts";
import { useNow } from "./use-now";

/** The owner-wide settings: the time zone dates are read in, and when a quiet project is flagged. */

const field = "rounded-md border border-foreground/20 bg-background px-2 py-1.5 text-sm";

export function SettingsPage() {
  return (
    <OwnerPage>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Loaded />
      <div className="mt-12">
        <Panel title="Areas" icon={SquaresFour}>
          <Areas />
        </Panel>
      </div>
      <div className="mt-12">
        <Panel title="Notifications" icon={Bell}>
          <NotificationsPanel />
        </Panel>
      </div>
      <div className="mt-12">
        <Panel title="Ingestion" icon={Funnel}>
          <IngestionRules />
        </Panel>
      </div>
      <div className="mt-12">
        <Panel title="Mac mini" icon={Desktop}>
          <Machinery />
        </Panel>
      </div>
      <div className="mt-12">
        <Panel title="Connections" icon={PlugsConnected}>
          <Connections />
        </Panel>
      </div>
    </OwnerPage>
  );
}

/** Notifications need the saved quiet hours, so they wait for the settings to load. */
function NotificationsPanel() {
  const settings = useQuery(api.viewer.settings);
  if (settings === undefined) return <Quiet>Loading…</Quiet>;
  return <NotificationSettings quietFrom={settings.quietFrom} quietTo={settings.quietTo} />;
}

function Loaded() {
  const settings = useQuery(api.viewer.settings);
  if (settings === undefined) {
    return (
      <div className="mt-6">
        <Quiet>Loading…</Quiet>
      </div>
    );
  }
  return <Form key={`${settings.timeZone}/${settings.stalenessDays}`} settings={settings} />;
}

function Form({ settings }: { settings: { timeZone: string; stalenessDays: number } }) {
  const save = useMutation(api.viewer.saveSettings);
  const [timeZone, setTimeZone] = useState(settings.timeZone);
  const [days, setDays] = useState(String(settings.stalenessDays));
  const [note, setNote] = useState<{ ok: boolean; text: string }>();
  // Every zone the browser knows, with the saved one first in case it is not among them.
  const zones = [...new Set([settings.timeZone, ...Intl.supportedValuesOf("timeZone")])];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNote(undefined);
    try {
      await save({ timeZone, stalenessDays: Number(days) });
      setNote({ ok: true, text: "Saved." });
    } catch (caught) {
      setNote({ ok: false, text: problem(caught) });
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-6">
      <label className="block text-sm">
        Time zone
        <select value={timeZone} onChange={(event) => setTimeZone(event.target.value)} className={`mt-1 block w-full max-w-sm ${field}`}>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-foreground/60">
          Dates Claude and you enter are read in this zone, and it decides when a day starts.
        </span>
      </label>
      <label className="block text-sm">
        Flag an active project as stale after
        <span className="mt-1 flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(event) => setDays(event.target.value)}
            className={`w-24 ${field}`}
          />
          days without a status report
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className={button}>
          Save
        </button>
        {note ? <p className={`text-sm ${note.ok ? "text-foreground/60" : "text-red-700 dark:text-red-300"}`}>{note.text}</p> : null}
      </div>
    </form>
  );
}

/** The areas of life a task or a recurrence can sit in: add, rename, reorder, remove. */
function Areas() {
  const data = useQuery(api.viewer.areas, {});
  const save = useMutation(api.viewer.saveArea);
  const move = useMutation(api.viewer.moveArea);
  const remove = useMutation(api.viewer.removeArea);
  const [adding, setAdding] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string }>();
  const [removing, setRemoving] = useState<string>();
  const [error, setError] = useState<string>();
  if (data === undefined) return <Quiet>Loading…</Quiet>;

  async function run(change: () => Promise<unknown>) {
    setError(undefined);
    try {
      await change();
    } catch (caught) {
      setError(problem(caught));
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground/60">A task or a repeating thing can sit in one area. The Agenda can be narrowed to one.</p>
      {data.areas.length === 0 ? <Quiet>No areas yet.</Quiet> : null}
      <ul className="space-y-2">
        {data.areas.map((area, index) => (
          <li key={area.id} className="flex flex-wrap items-center gap-2">
            {renaming?.id === area.id ? (
              <form
                className="flex flex-1 flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await save({ id: area.id, name: renaming.name });
                    setRenaming(undefined);
                  });
                }}
              >
                <input
                  value={renaming.name}
                  onChange={(event) => setRenaming({ id: area.id, name: event.target.value })}
                  aria-label="Area name"
                  maxLength={40}
                  required
                  className={`w-48 ${field}`}
                />
                <button type="submit" className={button}>
                  Save
                </button>
                <button type="button" onClick={() => setRenaming(undefined)} className={button}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className="min-w-32 flex-1">
                  {area.name}
                  <span className="text-sm text-foreground/60">
                    {" "}
                    · {area.openTasks} open {area.openTasks === 1 ? "task" : "tasks"}
                    {area.recurrences > 0 ? `, ${area.recurrences} repeating` : ""}
                  </span>
                </span>
                <button type="button" disabled={index === 0} onClick={() => void run(() => move({ id: area.id, direction: "up" }))} aria-label={`Move ${area.name} up`} className={`${button} disabled:opacity-40`}>
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === data.areas.length - 1}
                  onClick={() => void run(() => move({ id: area.id, direction: "down" }))}
                  aria-label={`Move ${area.name} down`}
                  className={`${button} disabled:opacity-40`}
                >
                  ↓
                </button>
                <button type="button" onClick={() => setRenaming({ id: area.id, name: area.name })} className={button}>
                  Rename
                </button>
                {removing === area.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          await remove({ id: area.id });
                          setRemoving(undefined);
                        })
                      }
                      className={`${button} border-red-600/50 text-red-700 dark:text-red-300`}
                    >
                      Remove it; its tasks stay
                    </button>
                    <button type="button" onClick={() => setRemoving(undefined)} className={button}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setRemoving(area.id)} className={button}>
                    Remove
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await save({ name: adding });
            setAdding("");
          });
        }}
      >
        <input value={adding} onChange={(event) => setAdding(event.target.value)} placeholder="New area" aria-label="New area" maxLength={40} required className={`w-48 ${field}`} />
        <button type="submit" className={button}>
          Add
        </button>
      </form>
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </div>
  );
}

/** The mini says "alive" every half minute. Past this it is counted as away. */
const AWAY_AFTER_MS = 100_000;

/** The chat runner on the Mac mini, and when each scheduled job last did something. */
function Machinery() {
  const data = useQuery(api.viewer.system, {});
  const now = useNow();
  if (data === undefined) return <Quiet>Loading…</Quiet>;
  const { jobs } = data;
  const rows: [string, string][] = [
    [
      "Ingestion",
      jobs.ingestion
        ? `${jobs.ingestion.pass ? `${jobs.ingestion.pass} pass ` : "last pass "}${jobs.ingestion.status === "finished" ? "finished" : jobs.ingestion.status} · ${showTime(jobs.ingestion.finishedAt ?? jobs.ingestion.startedAt)}`
        : "has not run yet",
    ],
    ["Morning briefing", jobs.briefing ? `for ${showDay(jobs.briefing.date)} · written ${showTime(jobs.briefing.writtenAt)}` : "none written yet"],
    ["Weekly review", jobs.review ? `written ${showTime(jobs.review.writtenAt)}` : "none written yet"],
    ["Nightly sweep", jobs.sweepReportAt ? `last wrote a report ${showTime(jobs.sweepReportAt)}` : "has not written a report yet"],
  ];
  return (
    <div className="space-y-4">
      {data.mini.length === 0 ? (
        <Quiet>No Mac mini has connected to this copy of Skippy OS. Chats started here will not be answered.</Quiet>
      ) : (
        <ul className="space-y-1">
          {data.mini.map((host) => {
            const away = now - new Date(host.lastSeenAt).getTime() > AWAY_AFTER_MS;
            return (
              <li key={host.host}>
                <span className="font-medium">{host.host}</span>
                <span className={away ? "text-red-700 dark:text-red-300" : "text-foreground/60"}>
                  {" "}
                  · {away ? `away since ${showTime(host.lastSeenAt)}` : "answering chats"}
                </span>
                {host.version ? <span className="text-foreground/60"> · runner {host.version}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-foreground/60">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {data.runnerTokenSet ? null : <p className="text-sm text-red-700 dark:text-red-300">No runner token is set, so no Mac mini can connect.</p>}
    </div>
  );
}

/** Where a new client connects, and which clients have written so far. */
function Connections() {
  const data = useQuery(api.viewer.system, {});
  const [copied, setCopied] = useState(false);
  if (data === undefined) return <Quiet>Loading…</Quiet>;
  return (
    <div className="space-y-4">
      {data.mcpUrl ? (
        <p className="text-sm">
          Connect a client at <code className="font-mono">{data.mcpUrl}</code>{" "}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(data.mcpUrl!).then(() => setCopied(true));
            }}
            className={button}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </p>
      ) : null}
      {data.clients.length === 0 ? (
        <Quiet>No client has written anything yet.</Quiet>
      ) : (
        <ul className="space-y-2">
          {data.clients.map((client) => (
            <li key={client.clientId}>
              <span className="font-medium">{client.harness}</span>
              <span className="text-foreground/60">
                {" "}
                · last wrote {showTime(client.lastWriteAt)}
                {client.surfaces.length > 0 ? ` · from ${client.surfaces.map((surface) => surface.replace("_", " ")).join(", ")}` : ""}
              </span>
              <p className="break-all font-mono text-xs text-foreground/60">{client.clientId}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-foreground/60">A client that has only read is not listed: reads leave no record.</p>
    </div>
  );
}
