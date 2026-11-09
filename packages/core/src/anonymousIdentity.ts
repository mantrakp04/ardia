export const IDENTITY_ADJECTIVES = [
  "Agile", "Amber", "Amiable", "Astute", "Arctic", "Artful", "Autumn", "Azure",
  "Balmy", "Beaming", "Blissful", "Bold", "Bouncy", "Brave", "Breezy", "Bright",
  "Brisk", "Bubbly", "Buoyant", "Calm", "Candid", "Carefree", "Charming", "Cheerful",
  "Chipper", "Classy", "Clever", "Coastal", "Cordial", "Cosmic", "Cozy", "Crimson",
  "Curious", "Dapper", "Daring", "Dazzling", "Dreamy", "Eager", "Earnest", "Elated",
  "Electric", "Elegant", "Epic", "Fabled", "Fair", "Fearless", "Festive", "Fluent",
  "Fond", "Friendly", "Frosty", "Gallant", "Gentle", "Gilded", "Glad", "Gleaming",
  "Glowing", "Golden", "Graceful", "Grand", "Happy", "Hardy", "Harmonic", "Hearty",
  "Helpful", "Honest", "Hopeful", "Humble", "Jaunty", "Jolly", "Jovial", "Joyful",
  "Keen", "Kind", "Lively", "Loyal", "Lucky", "Lunar", "Magic", "Mellow",
  "Merry", "Mighty", "Misty", "Modest", "Mossy", "Nimble", "Noble", "Northern",
  "Ocean", "Peppy", "Placid", "Playful", "Plucky", "Polite", "Proud", "Quick",
  "Quiet", "Radiant", "Rapid", "Ready", "Regal", "Rosy", "Royal", "Rustic",
  "Serene", "Silver", "Sincere", "Snowy", "Solar", "Sparkly", "Spirited", "Steady",
  "Stellar", "Sterling", "Sunny", "Swift", "Tidy", "Tranquil", "Trusty", "Upbeat",
  "Valiant", "Velvet", "Vivid", "Warm", "Wise", "Witty", "Zany", "Zesty",
] as const;

export const IDENTITY_ANIMALS = [
  "Albatross", "Alpaca", "Antelope", "Armadillo", "Badger", "Beaver", "Bison", "Bluebird",
  "Bobcat", "Buffalo", "Bunny", "Butterfly", "Camel", "Canary", "Capybara", "Caribou",
  "Cheetah", "Chickadee", "Chinchilla", "Chipmunk", "Cockatoo", "Condor", "Cardinal", "Cougar",
  "Coyote", "Crane", "Cricket", "Dingo", "Dolphin", "Dove", "Dragonfly", "Duckling",
  "Eagle", "Egret", "Elephant", "Elk", "Falcon", "Fawn", "Ferret", "Finch",
  "Firefly", "Flamingo", "Fox", "Gazelle", "Gecko", "Gibbon", "Giraffe", "Goldfinch",
  "Gopher", "Gorilla", "Grouse", "Hare", "Hawk", "Hedgehog", "Heron", "Hummingbird",
  "Ibex", "Ibis", "Iguana", "Impala", "Jackrabbit", "Jaguar", "Jay", "Kangaroo",
  "Kestrel", "Kingfisher", "Kitten", "Kiwi", "Koala", "Ladybug", "Lark", "Lemur",
  "Leopard", "Lion", "Llama", "Lobster", "Lynx", "Macaw", "Magpie", "Manatee",
  "Marmot", "Marten", "Meerkat", "Mink", "Mongoose", "Moose", "Narwhal", "Newt",
  "Nightingale", "Ocelot", "Octopus", "Oriole", "Osprey", "Ostrich", "Otter", "Owl",
  "Panda", "Panther", "Parrot", "Pelican", "Penguin", "Pheasant", "Platypus", "Puffin",
  "Puma", "Quail", "Quokka", "Rabbit", "Raccoon", "Raven", "Reindeer", "Robin",
  "Salmon", "Seahorse", "Seal", "Sparrow", "Squirrel", "Starling", "Stork", "Swallow",
  "Swan", "Tiger", "Toucan", "Turtle", "Walrus", "Whale", "Wombat", "Wren",
] as const;

export type AnonymousAvatar = { colors: [string, string, string]; angle: number };
export type AnonymousIdentity = { name: string; avatar: AnonymousAvatar };

function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function sequence(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

const hex = (value: number) => Math.round(value * 255).toString(16).padStart(2, "0");

export function hslHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return `#${hex(channel(0))}${hex(channel(8))}${hex(channel(4))}`;
}

const brightHue = (hue: number) => hue >= 45 && hue <= 200;

const gradientStop = (hue: number, saturation: number, lightness: number) => {
  const h = (hue + 360) % 360;
  return hslHex(h, saturation, brightHue(h) ? lightness - 10 : lightness);
};

export function anonymousIdentity(id: string): AnonymousIdentity {
  const next = sequence(fnv1a32(id.trim().toLowerCase()));
  const adjective = IDENTITY_ADJECTIVES[next() % IDENTITY_ADJECTIVES.length]!;
  const animal = IDENTITY_ANIMALS[next() % IDENTITY_ANIMALS.length]!;
  const hue = next() % 360;
  const spread = 28 + (next() % 30);
  const direction = next() % 2 ? 1 : -1;
  const saturation = 68 + (next() % 18);
  const lightness = 54 + (next() % 10);
  const colors: [string, string, string] = [
    gradientStop(hue, saturation, lightness),
    gradientStop(hue + direction * spread, saturation, lightness + 4),
    gradientStop(hue + direction * spread * 2, saturation - 6, lightness - 4),
  ];
  return { name: `${adjective} ${animal}`, avatar: { colors, angle: next() % 360 } };
}
