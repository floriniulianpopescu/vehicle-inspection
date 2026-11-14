/**
 * Fills the app's database with realistic demo data, to show the app to a client.
 *
 *   bun run seed:demo                       3000 cars over the last 3 years
 *   bun run seed:demo -- --cars 1000 --years 2
 *   bun run seed:demo -- --data-dir <folder>  another data folder (for testing)
 *
 * Close the app first. The current database is not deleted: it is renamed to
 * vehicle-inspection.before-demo-<time>.db in the same folder. To go back, close the app,
 * delete vehicle-inspection.db and rename that file back.
 *
 * The phone numbers start with 0700 and are invented. Do not send messages from a demo.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const IDENTIFIER = "com.iulian.vehicle-inspection";
const DB_FILE = "vehicle-inspection.db";
const MIGRATIONS = join(import.meta.dir, "..", "src-tauri", "migrations");

// --- options -------------------------------------------------------------------------------

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const CARS = Number(option("cars") ?? 3000);
const YEARS = Number(option("years") ?? 3);

/** Where Tauri keeps the app's data on this system. */
function dataDir(): string {
  const given = option("data-dir");
  if (given) return join(given, IDENTIFIER);
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), IDENTIFIER);
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", IDENTIFIER);
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), IDENTIFIER);
}

// --- random, repeatable ----------------------------------------------------------------------

let seed = 20261114;
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}
const chance = (probability: number) => random() < probability;
const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}
function weighted<T>(items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [item, weight] of items) {
    roll -= weight;
    if (roll < 0) return item;
  }
  return items[items.length - 1][0];
}

// --- dates ---------------------------------------------------------------------------------

const DAY = 86_400_000;
const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY);
function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth() + months, 1, 12);
  // Same day of the month, or the last one (31 August + 6 months is 28 February), like the app.
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(date.getDate(), last));
  return next;
}
/** Stations close on Sunday and are quieter on Saturday; moved visits spread over the week. */
function workday(date: Date): Date {
  if (date.getDay() === 0) return addDays(date, between(1, 5));
  if (date.getDay() === 6 && chance(0.6)) return addDays(date, -between(1, 5));
  return date;
}
function at(date: Date, fromHour = 8, toHour = 17): string {
  return `${iso(date)}T${String(between(fromHour, toHour - 1)).padStart(2, "0")}:${String(between(0, 59)).padStart(2, "0")}:${String(between(0, 59)).padStart(2, "0")}`;
}
function orthodoxEaster(year: number): Date {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const total = d + e + 114;
  return addDays(new Date(year, Math.floor(total / 31) - 1, (total % 31) + 1, 12), 13);
}

const today = new Date();
today.setHours(12, 0, 0, 0);
const start = addDays(today, -Math.round(YEARS * 365.25));

// --- what the demo cars look like ----------------------------------------------------------

const MAKES = [
  ["Dacia", 28, ["Logan", "Sandero", "Duster", "Logan MCV", "Sandero Stepway", "Spring", "Jogger", "Dokker", "Lodgy"]],
  ["Volkswagen", 11, ["Golf", "Passat", "Polo", "Tiguan", "Touran", "Transporter", "Caddy"]],
  ["Skoda", 8, ["Octavia", "Fabia", "Superb", "Kodiaq", "Rapid"]],
  ["Renault", 7, ["Clio", "Megane", "Captur", "Kangoo", "Master", "Trafic"]],
  ["Ford", 7, ["Focus", "Fiesta", "Kuga", "Mondeo", "Transit", "Transit Custom"]],
  ["Opel", 6, ["Astra", "Corsa", "Insignia", "Zafira", "Vivaro"]],
  ["BMW", 5, ["320", "520", "X1", "X3", "X5", "118"]],
  ["Mercedes-Benz", 5, ["C-Class", "E-Class", "A-Class", "Sprinter", "Vito", "GLC"]],
  ["Audi", 4, ["A4", "A6", "A3", "Q5", "Q3"]],
  ["Toyota", 4, ["Corolla", "Yaris", "RAV4", "C-HR", "Auris"]],
  ["Hyundai", 3, ["i30", "Tucson", "i20", "Kona"]],
  ["Peugeot", 3, ["208", "308", "3008", "Partner"]],
  ["Kia", 2, ["Ceed", "Sportage", "Rio"]],
  ["Citroën", 2, ["C3", "C4", "Berlingo"]],
  ["Fiat", 2, ["Punto", "500", "Doblo", "Ducato"]],
  ["Nissan", 2, ["Qashqai", "Juke", "X-Trail"]],
  ["Seat", 1, ["Leon", "Ibiza", "Ateca"]],
  ["Mazda", 1, ["3", "6", "CX-5"]],
  ["Suzuki", 1, ["Vitara", "Swift", "Ignis"]],
  ["Volvo", 1, ["XC60", "V40", "S60"]],
] as const;
const COUNTIES = [
  ["B", 30], ["CJ", 6], ["IF", 6], ["TM", 5], ["IS", 5], ["BV", 5], ["CT", 5], ["PH", 4], ["AG", 4],
  ["DJ", 4], ["SB", 3], ["MS", 3], ["BH", 3], ["AR", 3], ["GL", 3], ["BC", 3], ["DB", 2], ["SV", 2],
] as const;
const LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";
const NOTES = [
  [null, 88], ["GPL", 4], ["Flotă firmă", 3], ["Remorcă 750 kg", 2], ["Client vechi, preferă dimineața", 2], ["Plată cu factură", 1],
] as const;

const usedPlates = new Set<string>();
function plate(): string {
  for (;;) {
    const county = weighted(COUNTIES);
    const digits = county === "B" ? between(10, 999) : between(10, 99);
    const letters = Array.from({ length: 3 }, () => pick([...LETTERS])).join("");
    const candidate = `${county}${String(digits).padStart(2, "0")}${letters}`;
    if (!usedPlates.has(candidate)) {
      usedPlates.add(candidate);
      return candidate;
    }
  }
}

let nextPhone = 0;
/** 0700 followed by six digits: invented numbers, unused by Romanian mobile networks. */
function phone(): string {
  nextPhone += between(1, 37);
  return `0700${String(nextPhone).padStart(6, "0")}`;
}

// --- build ---------------------------------------------------------------------------------

const folder = dataDir();
mkdirSync(folder, { recursive: true });
const path = join(folder, DB_FILE);
if (existsSync(path)) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const aside = join(folder, `vehicle-inspection.before-demo-${stamp}.db`);
  try {
    renameSync(path, aside);
  } catch {
    console.error("The database is in use. Close the app (and `bun run tauri dev`) and run this again.");
    process.exit(1);
  }
  console.log(`Previous database kept as ${aside}`);
}

const db = new Database(path, { create: true });
db.exec("PRAGMA foreign_keys = OFF");
const migrations = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
for (const name of migrations) db.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
db.exec(`PRAGMA user_version = ${migrations.length}`);
db.exec("PRAGMA foreign_keys = ON");

const templates = Object.fromEntries(
  db.query("SELECT Type, Text FROM sms_templates").all().map((row) => {
    const { Type, Text } = row as { Type: string; Text: string };
    return [Type, Text];
  }),
) as Record<string, string>;

const insertClient = db.prepare("INSERT INTO clients (Phone, SmsOptOut) VALUES (?, ?) RETURNING ClientID");
const insertCar = db.prepare(
  "INSERT INTO cars (Plate, Manufacturer, Model, LastRevision, RevisionFrequency, Notes) VALUES (?, ?, ?, ?, ?, ?) RETURNING CarID",
);
const link = db.prepare("INSERT OR IGNORE INTO carsclients (CarID, ClientID) VALUES (?, ?)");
const insertInspection = db.prepare("INSERT OR IGNORE INTO inspections (CarID, ClientID, Date) VALUES (?, ?, ?)");
const insertMessage = db.prepare(
  "INSERT INTO messages (ClientID, CarID, Type, Text, SentAt, Status) VALUES (?, ?, ?, ?, ?, ?)",
);

type ClientRow = { id: number; since: Date };
const clients: ClientRow[] = [];
const counts = { cars: 0, inspections: 0, messages: 0 };
const display = (date: Date) => iso(date).split("-").reverse().join(".");

db.transaction(() => {
  for (let index = 0; index < CARS; index += 1) {
    // Most cars are regulars from the start; the rest arrive over the years.
    const joinsLater = chance(0.3);
    const frequency = weighted([[12, 55], [24, 30], [36, 8], [6, 7]] as const);
    const firstWindowDays = Math.min(frequency * 30, 365);
    const first = workday(
      joinsLater
        ? addDays(start, between(0, Math.round((today.getTime() - start.getTime()) / DAY) - 1))
        : addDays(start, between(0, firstWindowDays)),
    );

    const visits: Date[] = [];
    if (!chance(0.01)) {
      // 1 in 100 failed its ITP: kept with an unknown date.
      let visit = first;
      while (visit <= today) {
        visits.push(visit);
        // Some clients stop coming, which is what makes cars expire.
        if (!chance(0.86)) break;
        visit = workday(addDays(addMonths(visit, frequency), -between(0, 20)));
      }
    }

    // A tenth of the clients bring a second car.
    const owner =
      clients.length > 20 && chance(0.1)
        ? pick(clients)
        : (() => {
            const id = (insertClient.get(phone(), chance(0.03) ? 1 : 0) as { ClientID: number }).ClientID;
            const row = { id, since: first };
            clients.push(row);
            return row;
          })();
    const second = chance(0.15)
      ? (() => {
          const id = (insertClient.get(phone(), 0) as { ClientID: number }).ClientID;
          const row = { id, since: first };
          clients.push(row);
          return row;
        })()
      : null;

    const [make, , models] = weighted(MAKES.map((entry) => [entry, entry[1]] as const));
    const note = frequency === 6 ? weighted([["Taxi", 6], ["Transport persoane", 3], [null, 1]] as const) : weighted(NOTES);
    const last = visits.length ? iso(visits[visits.length - 1]) : null;
    const carPlate = plate();
    const carId = (
      insertCar.get(carPlate, make, pick(models), last, frequency, note ?? "") as { CarID: number }
    ).CarID;
    counts.cars += 1;
    link.run(carId, owner.id);
    if (second) link.run(carId, second.id);

    for (const visit of visits) {
      const bringer = second && chance(0.15) ? second.id : chance(0.04) ? null : owner.id;
      insertInspection.run(carId, bringer, iso(visit));
      counts.inspections += 1;

      // Feedback asked the same day, for part of the visits in the last six months.
      if (bringer && visit >= addDays(today, -183) && chance(0.45)) {
        insertMessage.run(bringer, carId, "feedback", templates.feedback.replace("{plate}", carPlate), at(visit, 12, 19), "sent");
        counts.messages += 1;
      }
    }

    // A reminder some days before each due date that has passed.
    for (const visit of visits) {
      const due = addMonths(visit, frequency);
      if (due > today || !chance(0.6)) continue;
      const sentOn = addDays(due, -between(10, 25));
      if (sentOn < start) continue;
      const text = templates.inspection.replace("{plate}", carPlate).replace("{date}", display(due));
      insertMessage.run(owner.id, carId, "inspection", text, at(sentOn), chance(0.96) ? "sent" : "failed");
      counts.messages += 1;
    }
  }

  // Holiday greetings to most clients who were already clients by then.
  for (let year = start.getFullYear(); year <= today.getFullYear() + 1; year += 1) {
    const holidays = [
      ["christmas", new Date(year, 11, 25, 12)],
      ["new_year", new Date(year, 0, 1, 12)],
      ["easter", orthodoxEaster(year)],
    ] as const;
    for (const [kind, date] of holidays) {
      if (date < start || date > today) continue;
      for (const client of clients) {
        if (client.since > date || !chance(0.65)) continue;
        insertMessage.run(client.id, null, kind, templates[kind], at(addDays(date, -between(0, 3))), chance(0.97) ? "sent" : "failed");
        counts.messages += 1;
      }
    }
  }
})();

db.close();
console.log(
  `Demo data written to ${path}\n` +
    `${counts.cars} cars, ${clients.length} clients, ${counts.inspections} inspections and ${counts.messages} messages ` +
    `from ${iso(start)} to ${iso(today)}.\nStart the app with: bun run tauri dev`,
);
