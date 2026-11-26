/**
 * Which icon goes before an item's title, worked out from its words: a flight,
 * a ride, a dinner and so on. The first rule that matches wins, so the more
 * particular ones come first. Nothing matched, an item gets its kind's own icon.
 */

export type IconKind =
  | "ride"
  | "flight"
  | "train"
  | "lodging"
  | "birthday"
  | "food"
  | "coffee"
  | "health"
  | "court"
  | "haircut"
  | "art"
  | "show"
  | "film"
  | "music"
  | "fitness"
  | "call"
  | "meeting"
  | "money"
  | "subscription"
  | "package"
  | "shopping"
  | "security"
  | "storage"
  | "code"
  | "message"
  | "reading"
  | "repair"
  | "trip";

const RULES: [IconKind, RegExp][] = [
  // A ride to the airport is a ride; the flight is its own item.
  ["ride", /\b(uber|lyft|taxi|cab|car service|black car|rental car|car rental|ground transportation|pick up the car|car wash|parking)\b|(?<!google )\bdriv(e|ing)\b/i],
  ["flight", /\b(flights?|fly|flying|airport|airlines?|delta|jetblue|united airlines|american airlines|southwest|boarding)\b|✈/i],
  // Airport codes and flight numbers are capitals, so these go by case.
  ["flight", /\b[A-Z]{3}\s*(→|->)\s*[A-Z]{3}\b|\b(DL|B6|AA|UA|WN|AS)\s?\d{2,4}\b/],
  ["train", /\b(train|amtrak|metro-?north|subway|rail)\b/i],
  ["lodging", /\b(hotel|airbnb|lodging|motel|hostel)\b/i],
  ["birthday", /\b(birthday|bday|b-day|anniversary)\b/i],
  ["food", /\b(dinner|lunch|breakfast|brunch|restaurant|eat|pizza|drinks|bar|beer|wine|cocktails?|reservation)\b/i],
  ["coffee", /\b(coffee|cafe|café|tea)\b/i],
  ["health", /\b(doctor|dentist|appointment|physical|blood work|mychart|clinic|hospital|pharmacy|prescription|therapy|therapist|check-?up|vaccine|flu shot)\b/i],
  ["court", /\b(jury|court)\b/i],
  ["haircut", /\b(barber|haircut|salon)\b/i],
  ["art", /\b(art|gallery|exhibit|exhibition|museum|open studio|painting)\b/i],
  ["film", /\b(movie|film|screening|cinema)\b/i],
  ["show", /\b(concert|show|festival|theater|theatre|play|speaker series|lecture|tickets?)\b/i],
  ["music", /\b(songs?|music|guitar|recording|record|demo|album|practice|rehearsal|band)\b/i],
  ["fitness", /\b(gym|workout|yoga|pilates|hike)\b/i],
  ["call", /\b(call|phone|zoom|facetime|google meet)\b/i],
  ["meeting", /\b(meeting|meet with|board|interview|1:1|standup)\b/i],
  ["subscription", /\b(subscriptions?|renew|renewal|membership|auto-?renew)\b/i],
  ["money", /\b(bill|pay|payment|mortgage|rent|invoice|tax|taxes|balance|overdrawn|statement|credit card|debit card|bank|refund|401\(k\))\b|\$\d/i],
  ["shopping", /\b(groceries|grocery|shopping|buy|purchase)\b/i],
  ["package", /\b(package|packages|delivery|deliver|arriving|shipped|usps|ups|fedex|amazon)\b/i],
  ["security", /\b(sign-?ins?|log-?ins?|password|security|two-factor|2fa|fraud)\b/i],
  ["storage", /\b(icloud|dropbox|storage|backups?)\b/i],
  ["code", /\b(deploy|deployment|vercel|github|vulnerability|cve|dns|domain|oauth|connector|convex|repo)\b/i],
  ["message", /\b(reply|email|e-mail|text|message|respond|rsvp)\b/i],
  ["reading", /\b(audiobooks?|audible|kindle|novel|reading)\b/i],
  ["repair", /\b(install|repair|plumber|handyman|bathtub|sink|door|furniture|renovation)\b/i],
  ["trip", /\b(trip|travel|vacation|luggage|packing)\b/i],
];

export function iconKind(...words: (string | undefined)[]): IconKind | undefined {
  const text = words.filter(Boolean).join(" ");
  for (const [kind, rule] of RULES) {
    if (rule.test(text)) return kind;
  }
  return undefined;
}
