import {
  AirplaneTilt,
  Barbell,
  Bed,
  BookOpen,
  Cake,
  CalendarBlank,
  Car,
  ChatCircleText,
  Cloud,
  Code,
  Coffee,
  CreditCard,
  CurrencyDollar,
  FilmSlate,
  ForkKnife,
  Gavel,
  ListChecks,
  MusicNotes,
  Package,
  Palette,
  Phone,
  Repeat,
  Scissors,
  ShieldCheck,
  ShoppingCart,
  Stethoscope,
  Suitcase,
  Ticket,
  Train,
  UsersThree,
  Wrench,
  type Icon,
} from "@phosphor-icons/react";
import { iconKind, type IconKind } from "@/lib/item-icon";

const ICONS: Record<IconKind, Icon> = {
  ride: Car,
  flight: AirplaneTilt,
  train: Train,
  lodging: Bed,
  birthday: Cake,
  food: ForkKnife,
  coffee: Coffee,
  health: Stethoscope,
  court: Gavel,
  haircut: Scissors,
  art: Palette,
  show: Ticket,
  film: FilmSlate,
  music: MusicNotes,
  fitness: Barbell,
  call: Phone,
  meeting: UsersThree,
  money: CurrencyDollar,
  subscription: CreditCard,
  package: Package,
  shopping: ShoppingCart,
  security: ShieldCheck,
  storage: Cloud,
  code: Code,
  message: ChatCircleText,
  reading: BookOpen,
  repair: Wrench,
  trip: Suitcase,
};

/** What an item is when its words say nothing more. */
const FALLBACK = { event: CalendarBlank, task: ListChecks, recurrence: Repeat } satisfies Record<string, Icon>;

/**
 * The work mark: the firm's three-band pyramid, shown on meetings copied from
 * the end-of-day work schedule email so they stand apart from the rest.
 */
export function WorkMark({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 90 90" role="img" aria-label="Work" className={`inline-block shrink-0 ${className}`}>
      <title>Work</title>
      <path d="M22.4944 44.9682L16.8736 54.688H73.0931L67.4944 44.9682L64.4508 39.7028H25.527L22.4944 44.9682Z" fill="#BF9B5F" />
      <path d="M55.3974 24.0289L45 6L34.5804 24.0289H55.3974Z" fill="#BF9B5F" />
      <path d="M7.8314 70.3619L0 83.9474H45H90L82.1353 70.3619H7.8314Z" fill="#BF9B5F" />
    </svg>
  );
}

/**
 * The small icon before an item's title: the work mark for a work meeting,
 * else one picked from its words, else its kind's own. Sized to sit in a line of text.
 */
export function ItemIcon({
  kind,
  title,
  location,
  work,
  size = "row",
}: {
  kind: keyof typeof FALLBACK;
  title: string;
  location?: string;
  work?: boolean;
  size?: "row" | "small" | "title";
}) {
  const box = size === "title" ? "mr-2 size-5 align-[-0.1em]" : size === "small" ? "mr-1 size-3.5 align-[-0.15em]" : "mr-1.5 size-4 align-[-0.15em]";
  if (work) return <WorkMark className={box} />;
  const picked = iconKind(title, location);
  const Shown = picked ? ICONS[picked] : FALLBACK[kind];
  return <Shown aria-hidden className={`inline-block shrink-0 text-foreground/55 ${box}`} />;
}
