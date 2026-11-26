"use client";

import { Scales, Wallet } from "@phosphor-icons/react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation } from "convex/react";
import { useState, type FormEvent } from "react";
import { MarkdownText } from "./markdown";
import { button, doneBox, Panel, problem, Quiet, showMoney } from "./parts";

/**
 * The parts a project can switch on beyond its tasks. Options: questions to
 * decide, each with its options side by side; choosing one decides it and
 * saves the decision to Memory. Budget: lines planned against spent, which
 * double as the shopping list. (Schedule is the project's events, on the
 * project page.)
 */

type Page = NonNullable<FunctionReturnType<typeof api.viewer.project>>;
type Decision = Page["decisions"][number];
type Budget = Page["budget"];

const field = "rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm";
const quiet = "text-sm text-foreground/60 underline underline-offset-2";

/** A money box's text as a number: blank is none, and anything else must read as an amount. */
function amountOf(text: string): number | null | undefined {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function useAttempt() {
  const [error, setError] = useState<string>();
  async function attempt(change: () => Promise<unknown>) {
    setError(undefined);
    try {
      await change();
      return true;
    } catch (caught) {
      setError(problem(caught));
      return false;
    }
  }
  const shown = error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null;
  return { attempt, error: shown };
}

export function OptionsPart({ project, decisions }: { project: string; decisions: Decision[] }) {
  const save = useMutation(api.viewer.saveDecision);
  const { attempt, error } = useAttempt();
  const [question, setQuestion] = useState("");
  const [showDropped, setShowDropped] = useState(false);
  const open = decisions.filter((decision) => decision.status === "open");
  const decided = decisions.filter((decision) => decision.status === "decided");
  const dropped = decisions.filter((decision) => decision.status === "dropped");

  async function add(event: FormEvent) {
    event.preventDefault();
    if (question.trim() && (await attempt(() => save({ project, question })))) setQuestion("");
  }

  return (
    <Panel title="Options" icon={Scales} note={open.length > 0 ? `${open.length} to decide` : undefined}>
      {decisions.length === 0 ? <Quiet>Nothing to decide yet. Add a question, then the options to weigh.</Quiet> : null}
      <div className="space-y-8">
        {[...open, ...decided].map((decision) => (
          <DecisionBlock key={decision.id} decision={decision} />
        ))}
      </div>
      {dropped.length > 0 ? (
        <div className="mt-6">
          <button type="button" onClick={() => setShowDropped(!showDropped)} className={quiet}>
            {showDropped ? "Hide" : "Show"} {dropped.length} dropped
          </button>
          {showDropped ? (
            <div className="mt-4 space-y-8">
              {dropped.map((decision) => (
                <DecisionBlock key={decision.id} decision={decision} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <form onSubmit={add} className="mt-6 flex flex-wrap gap-2">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Something to decide, such as “Where to stay?”"
          aria-label="New question to decide"
          className={`min-w-48 flex-1 ${field}`}
        />
        <button type="submit" disabled={!question.trim()} className={`${button} disabled:opacity-50`}>
          Add
        </button>
      </form>
      {error}
    </Panel>
  );
}

/** One question: what matters, the options side by side, and what was chosen and why. */
function DecisionBlock({ decision }: { decision: Decision }) {
  const save = useMutation(api.viewer.saveDecision);
  const remove = useMutation(api.viewer.removeDecision);
  const { attempt, error } = useAttempt();
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(decision.question);
  const [criteria, setCriteria] = useState(decision.criteria ?? "");
  const [removing, setRemoving] = useState(false);
  const chosen = decision.options.find((option) => option.id === decision.chosenOptionId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await attempt(() => save({ id: decision.id, question, criteria: criteria.trim() ? criteria : null }))) setEditing(false);
  }

  return (
    <div className={decision.status === "dropped" ? "opacity-60" : undefined}>
      {editing ? (
        <form onSubmit={submit} className="space-y-2">
          <input value={question} onChange={(event) => setQuestion(event.target.value)} required aria-label="Question" className={`w-full ${field}`} />
          <textarea
            value={criteria}
            onChange={(event) => setCriteria(event.target.value)}
            rows={2}
            placeholder="What matters in choosing"
            aria-label="What matters in choosing"
            className={`w-full ${field}`}
          />
          <div className="flex gap-2">
            <button type="submit" className={button}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className={button}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-base font-semibold">{decision.question}</h3>
            <div className="flex flex-wrap gap-x-3">
              <button
                type="button"
                onClick={() => {
                  setQuestion(decision.question);
                  setCriteria(decision.criteria ?? "");
                  setEditing(true);
                }}
                className={quiet}
              >
                Edit
              </button>
              {decision.status === "decided" ? (
                <button type="button" onClick={() => attempt(() => save({ id: decision.id, chosen: null }))} className={quiet}>
                  Decide again
                </button>
              ) : decision.status === "open" ? (
                <button type="button" onClick={() => attempt(() => save({ id: decision.id, status: "dropped" }))} className={quiet}>
                  Drop
                </button>
              ) : (
                <button type="button" onClick={() => attempt(() => save({ id: decision.id, status: "open" }))} className={quiet}>
                  Bring it back
                </button>
              )}
              {removing ? (
                <>
                  <button type="button" onClick={() => attempt(() => remove({ id: decision.id }))} className={quiet}>
                    Remove it and its options for good
                  </button>
                  <button type="button" onClick={() => setRemoving(false)} className={quiet}>
                    Keep
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setRemoving(true)} className={quiet}>
                  Remove
                </button>
              )}
            </div>
          </div>
          {decision.criteria ? <p className="mt-1 text-sm whitespace-pre-wrap text-foreground/70">What matters: {decision.criteria}</p> : null}
          {chosen ? (
            <p className="mt-2 text-sm">
              <span className="font-medium">Decided: {chosen.title}</span>
              {decision.why ? <span className="text-foreground/70"> · {decision.why}</span> : null}
            </p>
          ) : null}
        </div>
      )}
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {decision.options.map((option) => (
          <OptionCard key={option.id} decision={decision} option={option} />
        ))}
      </ul>
      {decision.status !== "dropped" ? <AddOption decision={decision.id} /> : null}
      {error}
    </div>
  );
}

function OptionCard({ decision, option }: { decision: Decision; option: Decision["options"][number] }) {
  const choose = useMutation(api.viewer.saveDecision);
  const save = useMutation(api.viewer.saveOption);
  const remove = useMutation(api.viewer.removeOption);
  const { attempt, error } = useAttempt();
  const [choosing, setChoosing] = useState(false);
  const [why, setWhy] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: option.title, price: "", url: "", details: "" });
  const isChosen = decision.chosenOptionId === option.id;

  async function decide(event: FormEvent) {
    event.preventDefault();
    if (await attempt(() => choose({ id: decision.id, chosen: option.id, why: why.trim() ? why : null }))) setChoosing(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const price = amountOf(draft.price);
    if (price === undefined) return;
    const ok = await attempt(() =>
      save({ id: option.id, title: draft.title, price, url: draft.url.trim() || null, details: draft.details.trim() || null }),
    );
    if (ok) setEditing(false);
  }

  if (editing) {
    return (
      <li className="rounded-md border border-foreground/15 p-3">
        <form onSubmit={submit} className="space-y-2">
          <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required aria-label="Option" className={`w-full ${field}`} />
          <div className="flex gap-2">
            <input value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} inputMode="decimal" placeholder="Price" aria-label="Price" className={`w-28 ${field}`} />
            <input value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} type="url" placeholder="https://…" aria-label="Link" className={`min-w-0 flex-1 ${field}`} />
          </div>
          <textarea value={draft.details} onChange={(event) => setDraft({ ...draft, details: event.target.value })} rows={3} placeholder="Pros, cons, notes" aria-label="Details" className={`w-full ${field}`} />
          {amountOf(draft.price) === undefined ? <p className="text-xs text-red-700 dark:text-red-300">The price should be an amount.</p> : null}
          <div className="flex gap-2">
            <button type="submit" className={button}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className={button}>
              Cancel
            </button>
          </div>
        </form>
        {error}
      </li>
    );
  }

  return (
    <li className={`flex flex-col rounded-md border p-3 ${isChosen ? "border-green-700/50" : "border-foreground/15"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">
          {option.url ? (
            <a href={option.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {option.title}
            </a>
          ) : (
            option.title
          )}
        </span>
        {option.price !== undefined ? <span className="shrink-0 text-sm">{showMoney(option.price)}</span> : null}
      </div>
      {isChosen ? <p className="mt-1 text-xs text-green-800 dark:text-green-300">Chosen</p> : null}
      {option.details ? <MarkdownText text={option.details} className="mt-2 text-sm text-foreground/80" /> : null}
      <div className="mt-auto flex flex-wrap gap-x-3 pt-3">
        {decision.status === "open" && !choosing ? (
          <button type="button" onClick={() => setChoosing(true)} className="text-sm font-medium underline underline-offset-2">
            Choose this
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setDraft({ title: option.title, price: option.price?.toString() ?? "", url: option.url ?? "", details: option.details ?? "" });
            setEditing(true);
          }}
          className={quiet}
        >
          Edit
        </button>
        {isChosen ? null : (
          <button type="button" onClick={() => attempt(() => remove({ id: option.id }))} aria-label={`Remove the option ${option.title}`} className={quiet}>
            Remove
          </button>
        )}
      </div>
      {choosing ? (
        <form onSubmit={decide} className="mt-3 space-y-2">
          <input value={why} onChange={(event) => setWhy(event.target.value)} placeholder="Why this one (optional)" aria-label="Why this one" autoFocus className={`w-full ${field}`} />
          <div className="flex gap-2">
            <button type="submit" className={button}>
              Decide
            </button>
            <button type="button" onClick={() => setChoosing(false)} className={button}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {error}
    </li>
  );
}

function AddOption({ decision }: { decision: string }) {
  const save = useMutation(api.viewer.saveOption);
  const { attempt, error } = useAttempt();
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");

  async function add(event: FormEvent) {
    event.preventDefault();
    const amount = amountOf(price);
    if (!title.trim() || amount === undefined) return;
    if (await attempt(() => save({ decision, title, ...(amount === null ? {} : { price: amount }) }))) {
      setTitle("");
      setPrice("");
    }
  }

  return (
    <form onSubmit={add} className="mt-3 flex flex-wrap gap-2">
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add an option" aria-label="New option" className={`min-w-40 flex-1 ${field}`} />
      <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="Price" aria-label="Its price" className={`w-24 ${field}`} />
      <button type="submit" disabled={!title.trim() || amountOf(price) === undefined} className={`${button} disabled:opacity-50`}>
        Add
      </button>
      {error}
    </form>
  );
}

export function BudgetPart({ project, budget }: { project: string; budget: Budget }) {
  const saveProject = useMutation(api.viewer.saveProject);
  const saveLine = useMutation(api.viewer.saveBudgetLine);
  const { attempt, error } = useAttempt();
  const [title, setTitle] = useState("");
  const [planned, setPlanned] = useState("");
  const [total, setTotal] = useState<string>();
  const left = budget.total === undefined ? undefined : budget.total - budget.spent;
  const toBuy = budget.lines.filter((line) => !line.bought).length;

  async function add(event: FormEvent) {
    event.preventDefault();
    const amount = amountOf(planned);
    if (!title.trim() || amount === undefined) return;
    if (await attempt(() => saveLine({ project, title, ...(amount === null ? {} : { planned: amount }) }))) {
      setTitle("");
      setPlanned("");
    }
  }

  async function setBudget(event: FormEvent) {
    event.preventDefault();
    const amount = amountOf(total ?? "");
    if (amount === undefined) return;
    if (await attempt(() => saveProject({ slug: project, budget: amount }))) setTotal(undefined);
  }

  return (
    <Panel title="Budget" icon={Wallet} note={toBuy > 0 ? `${toBuy} to buy` : undefined}>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
        <span>
          Planned <span className="font-medium">{showMoney(budget.planned)}</span>
        </span>
        <span>
          Spent <span className="font-medium">{showMoney(budget.spent)}</span>
        </span>
        {total === undefined ? (
          <span>
            {budget.total === undefined ? (
              <button type="button" onClick={() => setTotal("")} className={quiet}>
                Set a budget
              </button>
            ) : (
              <>
                Budget <span className="font-medium">{showMoney(budget.total)}</span>
                {left !== undefined ? (
                  <span className={left < 0 ? "text-red-700 dark:text-red-300" : "text-foreground/70"}>
                    {" "}
                    · {left < 0 ? `${showMoney(-left)} over` : `${showMoney(left)} left`}
                  </span>
                ) : null}{" "}
                <button type="button" onClick={() => setTotal(budget.total?.toString() ?? "")} className={quiet}>
                  Change
                </button>
              </>
            )}
          </span>
        ) : (
          <form onSubmit={setBudget} className="flex gap-2">
            <input value={total} onChange={(event) => setTotal(event.target.value)} inputMode="decimal" placeholder="Total" aria-label="Budget total" autoFocus className={`w-28 ${field}`} />
            <button type="submit" disabled={amountOf(total) === undefined} className={`${button} disabled:opacity-50`}>
              Save
            </button>
            <button type="button" onClick={() => setTotal(undefined)} className={button}>
              Cancel
            </button>
          </form>
        )}
      </div>
      {budget.planned > 0 && budget.total !== undefined && budget.planned > budget.total ? (
        <p className="mt-1 text-sm text-red-700 dark:text-red-300">What is planned is {showMoney(budget.planned - budget.total)} over the budget.</p>
      ) : null}

      {budget.lines.length === 0 ? (
        <div className="mt-4">
          <Quiet>No lines yet. Add what there is to pay for or buy.</Quiet>
        </div>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-foreground/60">
              <th className="w-8 pb-2 font-normal">
                <span className="sr-only">Bought</span>
              </th>
              <th className="pb-2 font-normal">Item</th>
              <th className="w-28 pb-2 font-normal">Planned</th>
              <th className="w-28 pb-2 font-normal">Spent</th>
              <th className="w-16 pb-2 font-normal">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/10">
            {budget.lines.map((line) => (
              <BudgetRow key={line.id} line={line} />
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={add} className="mt-4 flex flex-wrap gap-2">
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a line, such as “Paint”" aria-label="New budget line" className={`min-w-40 flex-1 ${field}`} />
        <input value={planned} onChange={(event) => setPlanned(event.target.value)} inputMode="decimal" placeholder="Planned" aria-label="Planned amount" className={`w-28 ${field}`} />
        <button type="submit" disabled={!title.trim() || amountOf(planned) === undefined} className={`${button} disabled:opacity-50`}>
          Add
        </button>
      </form>
      {error}
    </Panel>
  );
}

/** One line. The amounts save when the box is left; the tick saves at once. */
function BudgetRow({ line }: { line: Budget["lines"][number] }) {
  const save = useMutation(api.viewer.saveBudgetLine);
  const remove = useMutation(api.viewer.removeBudgetLine);
  const { attempt, error } = useAttempt();

  function amountBox(which: "planned" | "spent") {
    const current = line[which];
    return (
      <input
        key={`${which}:${current ?? ""}`}
        defaultValue={current?.toString() ?? ""}
        inputMode="decimal"
        placeholder="–"
        aria-label={`${which === "planned" ? "Planned" : "Spent"} for ${line.title}`}
        onBlur={(event) => {
          const amount = amountOf(event.target.value);
          if (amount === undefined) {
            event.target.value = current?.toString() ?? "";
            return;
          }
          if (amount !== (current ?? null)) void attempt(() => save({ id: line.id, [which]: amount }));
        }}
        className={`w-24 ${field}`}
      />
    );
  }

  return (
    <tr>
      <td className="py-2 align-top">
        <input
          type="checkbox"
          checked={line.bought}
          onChange={(event) => attempt(() => save({ id: line.id, bought: event.target.checked }))}
          aria-label={`${line.title} bought`}
          className={`mt-2 ${doneBox(line.bought)}`}
        />
      </td>
      <td className="py-2 pr-2 align-top">
        <div className={`pt-1.5 ${line.bought ? "text-foreground/60" : ""}`}>
          {line.url ? (
            <a href={line.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {line.title}
            </a>
          ) : (
            line.title
          )}
        </div>
        {line.note ? <div className="text-xs text-foreground/60">{line.note}</div> : null}
        {error}
      </td>
      <td className="py-2 align-top">{amountBox("planned")}</td>
      <td className="py-2 align-top">{amountBox("spent")}</td>
      <td className="py-2 text-right align-top">
        <button type="button" onClick={() => attempt(() => remove({ id: line.id }))} aria-label={`Remove ${line.title}`} className={`mt-1.5 ${quiet}`}>
          Remove
        </button>
      </td>
    </tr>
  );
}
