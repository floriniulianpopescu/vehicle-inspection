/**
 * Manufacturers and their models, for suggestions in the car form. It covers the cars and
 * light commercial vehicles common at Romanian inspection stations, older ones included.
 * Anything missing can still be typed by hand.
 */
export const CAR_MODELS: Record<string, string[]> = {
  "Alfa Romeo": ["145", "146", "147", "155", "156", "159", "166", "4C", "Brera", "Giulia", "Giulietta", "GT", "GTV", "Junior", "MiTo", "Spider", "Stelvio", "Tonale"],
  Aro: ["10", "24", "240", "243", "244", "246", "320", "324", "328"],
  Audi: ["80", "90", "100", "200", "A1", "A2", "A3", "A4", "A4 Allroad", "A5", "A6", "A6 Allroad", "A7", "A8", "Cabriolet", "Coupe", "e-tron", "e-tron GT", "Q2", "Q3", "Q4 e-tron", "Q5", "Q6 e-tron", "Q7", "Q8", "Q8 e-tron", "R8", "RS3", "RS4", "RS5", "RS6", "RS7", "S3", "S4", "S5", "S6", "S8", "SQ5", "SQ7", "TT"],
  BMW: ["116", "118", "120", "123", "125", "130", "135", "216", "218", "220", "225", "316", "318", "320", "323", "325", "328", "330", "335", "340", "418", "420", "428", "430", "435", "440", "518", "520", "523", "525", "528", "530", "535", "540", "545", "550", "630", "635", "640", "645", "650", "730", "735", "740", "745", "750", "760", "840", "850", "i3", "i4", "i5", "i7", "i8", "iX", "iX1", "iX3", "M2", "M3", "M4", "M5", "M8", "X1", "X2", "X3", "X4", "X5", "X6", "X7", "XM", "Z3", "Z4"],
  BYD: ["Atto 2", "Atto 3", "Dolphin", "Dolphin Surf", "Han", "Seal", "Seal U", "Sealion 7", "Tang"],
  Chevrolet: ["Aveo", "Camaro", "Captiva", "Corvette", "Cruze", "Epica", "Kalos", "Lacetti", "Malibu", "Matiz", "Nubira", "Orlando", "Spark", "Tacuma", "Trax"],
  Chrysler: ["300C", "Grand Voyager", "PT Cruiser", "Sebring", "Voyager"],
  "Citroën": ["AX", "Berlingo", "BX", "C-Crosser", "C-Elysee", "C-Zero", "C1", "C2", "C3", "C3 Aircross", "C3 Picasso", "C4", "C4 Aircross", "C4 Cactus", "C4 Picasso", "C4 X", "C5", "C5 Aircross", "C5 X", "C6", "C8", "DS3", "DS4", "DS5", "Jumper", "Jumpy", "Nemo", "Saxo", "SpaceTourer", "Xantia", "XM", "Xsara", "Xsara Picasso", "ZX"],
  Cupra: ["Ateca", "Born", "Formentor", "Leon", "Tavascan", "Terramar"],
  Dacia: ["1100", "1300", "1310", "1410", "Bigster", "Dokker", "Duster", "Jogger", "Lodgy", "Logan", "Logan MCV", "Logan Van", "Nova", "Pick-Up", "Sandero", "Sandero Stepway", "Solenza", "Spring", "SuperNova"],
  Daewoo: ["Cielo", "Espero", "Kalos", "Lacetti", "Lanos", "Leganza", "Matiz", "Nexia", "Nubira", "Racer", "Tacuma", "Tico"],
  Dodge: ["Caliber", "Challenger", "Charger", "Durango", "Journey", "Nitro", "RAM"],
  DS: ["DS 3", "DS 3 Crossback", "DS 4", "DS 5", "DS 7", "DS 9"],
  Fiat: ["124 Spider", "500", "500C", "500e", "500L", "500X", "600", "Albea", "Brava", "Bravo", "Cinquecento", "Croma", "Doblo", "Ducato", "Fiorino", "Freemont", "Fullback", "Grande Punto", "Idea", "Linea", "Marea", "Multipla", "Palio", "Panda", "Punto", "Punto Evo", "Qubo", "Scudo", "Sedici", "Seicento", "Siena", "Stilo", "Talento", "Tipo", "Ulysse", "Uno"],
  Ford: ["B-Max", "Bronco", "C-Max", "Capri", "Cougar", "EcoSport", "Edge", "Escort", "Explorer", "Fiesta", "Focus", "Fusion", "Galaxy", "Grand C-Max", "Ka", "Ka+", "Kuga", "Maverick", "Mondeo", "Mustang", "Mustang Mach-E", "Orion", "Puma", "Ranger", "S-Max", "Scorpio", "Sierra", "Tourneo Connect", "Tourneo Courier", "Tourneo Custom", "Transit", "Transit Connect", "Transit Courier", "Transit Custom"],
  Honda: ["Accord", "City", "Civic", "CR-V", "CR-Z", "e", "FR-V", "HR-V", "Insight", "Jazz", "Legend", "Prelude", "Shuttle", "Stream", "ZR-V"],
  Hyundai: ["Accent", "Atos", "Bayon", "Coupe", "Elantra", "Galloper", "Getz", "Grandeur", "H-1", "i10", "i20", "i30", "i40", "Inster", "Ioniq", "Ioniq 5", "Ioniq 6", "ix20", "ix35", "ix55", "Kona", "Lantra", "Matrix", "Pony", "Santa Fe", "Sonata", "Terracan", "Trajet", "Tucson", "Veloster"],
  Isuzu: ["D-Max", "Trooper"],
  Iveco: ["Daily", "Eurocargo", "Massif"],
  Jaguar: ["E-Pace", "F-Pace", "F-Type", "I-Pace", "S-Type", "X-Type", "XE", "XF", "XJ", "XK"],
  Jeep: ["Avenger", "Cherokee", "Commander", "Compass", "Grand Cherokee", "Patriot", "Renegade", "Wrangler"],
  Kia: ["Carens", "Carnival", "Ceed", "Cerato", "EV3", "EV6", "EV9", "Magentis", "Niro", "Opirus", "Optima", "Picanto", "ProCeed", "Rio", "Sorento", "Soul", "Sportage", "Stinger", "Stonic", "Venga", "XCeed"],
  Lada: ["110", "111", "112", "2101", "2104", "2105", "2106", "2107", "Granta", "Kalina", "Niva", "Priora", "Samara", "Vesta"],
  Lancia: ["Delta", "Lybra", "Musa", "Phedra", "Thema", "Thesis", "Ypsilon"],
  "Land Rover": ["Defender", "Discovery", "Discovery Sport", "Freelander", "Range Rover", "Range Rover Evoque", "Range Rover Sport", "Range Rover Velar"],
  Lexus: ["CT", "ES", "GS", "IS", "LBX", "LC", "LS", "NX", "RC", "RX", "RZ", "UX"],
  Mazda: ["121", "2", "3", "323", "5", "6", "626", "BT-50", "CX-3", "CX-30", "CX-5", "CX-60", "CX-7", "CX-80", "CX-9", "Demio", "MX-3", "MX-30", "MX-5", "Premacy", "RX-8", "Tribute", "Xedos"],
  "Mercedes-Benz": ["190", "A-Class", "AMG GT", "B-Class", "C-Class", "Citan", "CL", "CLA", "CLK", "CLS", "E-Class", "EQA", "EQB", "EQC", "EQE", "EQS", "EQV", "G-Class", "GL", "GLA", "GLB", "GLC", "GLE", "GLK", "GLS", "M-Class", "R-Class", "S-Class", "SL", "SLK", "Sprinter", "T-Class", "Vaneo", "Viano", "Vito", "V-Class", "X-Class"],
  MG: ["3", "4", "5", "Cyberster", "HS", "Marvel R", "MG4", "ZS"],
  Mini: ["Clubman", "Cooper", "Countryman", "Coupe", "One", "Paceman", "Roadster"],
  Mitsubishi: ["ASX", "Carisma", "Colt", "Eclipse Cross", "Galant", "Grandis", "L200", "Lancer", "Outlander", "Pajero", "Pajero Pinin", "Space Star", "Space Wagon"],
  Nissan: ["350Z", "370Z", "Almera", "Almera Tino", "Ariya", "Juke", "Leaf", "Micra", "Murano", "Navara", "Note", "NV200", "NV300", "NV400", "Pathfinder", "Patrol", "Pixo", "Primastar", "Primera", "Pulsar", "Qashqai", "Sunny", "Terrano", "Townstar", "X-Trail"],
  Oltcit: ["Club", "Special"],
  Opel: ["Adam", "Agila", "Ampera", "Antara", "Astra", "Calibra", "Cascada", "Combo", "Corsa", "Crossland", "Frontera", "Grandland", "GT", "Insignia", "Kadett", "Karl", "Meriva", "Mokka", "Movano", "Omega", "Signum", "Sintra", "Tigra", "Vectra", "Vivaro", "Zafira"],
  Peugeot: ["1007", "106", "107", "108", "2008", "205", "206", "207", "208", "3008", "301", "306", "307", "308", "4007", "4008", "405", "406", "407", "408", "5008", "508", "605", "607", "806", "807", "Bipper", "Boxer", "Expert", "iOn", "Partner", "RCZ", "Rifter", "Traveller"],
  Porsche: ["911", "918", "924", "928", "944", "968", "Boxster", "Cayenne", "Cayman", "Macan", "Panamera", "Taycan"],
  Renault: ["Arkana", "Austral", "Captur", "Clio", "Espace", "Express", "Fluence", "Grand Scenic", "Kadjar", "Kangoo", "Koleos", "Laguna", "Latitude", "Master", "Megane", "Modus", "R19", "R21", "Rafale", "Safrane", "Scenic", "Symbol", "Talisman", "Thalia", "Trafic", "Twingo", "Twizy", "Vel Satis", "Wind", "Zoe"],
  Saab: ["9-3", "9-5", "900", "9000"],
  Seat: ["Alhambra", "Altea", "Arona", "Arosa", "Ateca", "Cordoba", "Exeo", "Ibiza", "Inca", "Leon", "Mii", "Tarraco", "Toledo"],
  Skoda: ["Citigo", "Elroq", "Enyaq", "Fabia", "Favorit", "Felicia", "Kamiq", "Karoq", "Kodiaq", "Octavia", "Rapid", "Roomster", "Scala", "Superb", "Yeti"],
  Smart: ["#1", "#3", "ForFour", "ForTwo", "Roadster"],
  SsangYong: ["Actyon", "Korando", "Kyron", "Musso", "Rexton", "Rodius", "Tivoli", "Torres", "XLV"],
  Subaru: ["BRZ", "Forester", "Impreza", "Justy", "Legacy", "Levorg", "Outback", "Solterra", "Tribeca", "WRX", "XV"],
  Suzuki: ["Alto", "Baleno", "Celerio", "Grand Vitara", "Ignis", "Jimny", "Kizashi", "Liana", "S-Cross", "Splash", "Swace", "Swift", "SX4", "Vitara", "Wagon R"],
  Tesla: ["Model 3", "Model S", "Model X", "Model Y"],
  Toyota: ["Auris", "Avensis", "Avensis Verso", "Aygo", "Aygo X", "bZ4X", "C-HR", "Camry", "Carina", "Celica", "Corolla", "Corolla Cross", "Corolla Verso", "GR86", "GT86", "Hiace", "Highlander", "Hilux", "iQ", "Land Cruiser", "Mirai", "MR2", "Prius", "Prius+", "Proace", "Proace City", "RAV4", "Starlet", "Supra", "Urban Cruiser", "Verso", "Yaris", "Yaris Cross"],
  Volkswagen: ["Amarok", "Arteon", "Beetle", "Bora", "Caddy", "California", "Caravelle", "Corrado", "Crafter", "Eos", "Fox", "Golf", "Golf Plus", "Golf Sportsvan", "ID.3", "ID.4", "ID.5", "ID.7", "ID. Buzz", "Jetta", "Lupo", "Multivan", "New Beetle", "Passat", "Passat CC", "Phaeton", "Polo", "Scirocco", "Sharan", "T-Cross", "T-Roc", "Taigo", "Tiguan", "Tiguan Allspace", "Touareg", "Touran", "Transporter", "Up", "Vento"],
  Volvo: ["240", "440", "460", "740", "850", "940", "C30", "C40", "C70", "EX30", "EX40", "EX90", "S40", "S60", "S70", "S80", "S90", "V40", "V50", "V60", "V70", "V90", "XC40", "XC60", "XC70", "XC90"],
};

/** Other names people type for a manufacturer. */
const ALIASES: Record<string, string> = {
  vw: "Volkswagen",
  mercedes: "Mercedes-Benz",
  merc: "Mercedes-Benz",
  citroen: "Citroën",
  landrover: "Land Rover",
  alfa: "Alfa Romeo",
  ssang: "SsangYong",
};

export type ModelSuggestion = { manufacturer: string; model: string };

/** Lower case, no diacritics, spaces or punctuation: "Citroën C-Elysée" matches "citroen c elysee". */
export function simplify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const MANUFACTURERS = Object.keys(CAR_MODELS);

/** The catalogue's name for a typed manufacturer, if it knows it. */
export function knownManufacturer(text: string): string | null {
  const key = simplify(text);
  if (!key) return null;
  return MANUFACTURERS.find((name) => simplify(name) === key) ?? ALIASES[key] ?? null;
}

/** Manufacturers starting with the typed text first, then those containing it. */
export function suggestManufacturers(text: string, limit = 8): string[] {
  const key = simplify(text);
  if (!key) return [];
  const aliased = ALIASES[key];
  const starts = MANUFACTURERS.filter((name) => simplify(name).startsWith(key));
  const contains = MANUFACTURERS.filter(
    (name) => !simplify(name).startsWith(key) && simplify(name).includes(key),
  );
  return [...new Set([...(aliased ? [aliased] : []), ...starts, ...contains])].slice(0, limit);
}

/**
 * Models matching the typed text, limited to the manufacturer when it is a known one.
 * Models starting with the text come before those containing it.
 */
export function suggestModels(text: string, manufacturer: string, limit = 8): ModelSuggestion[] {
  const key = simplify(text);
  if (!key) return [];
  const brand = knownManufacturer(manufacturer);
  const all = (brand ? [brand] : MANUFACTURERS).flatMap((name) =>
    CAR_MODELS[name].map((model) => ({ manufacturer: name, model })),
  );
  const starts = all.filter((item) => simplify(item.model).startsWith(key));
  const contains = all.filter(
    (item) => !simplify(item.model).startsWith(key) && simplify(item.model).includes(key),
  );
  return [...starts, ...contains].slice(0, limit);
}
