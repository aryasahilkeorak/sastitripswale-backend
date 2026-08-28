// ============================================================
//  Profanity filter - blocks the platform's banned word list from
//  chat messages. See chatController.sendMessage.
//
//  Design notes (why this isn't a plain "does the message contain
//  any of these substrings" check):
//
//  - Short entries (mc, bc, bs, ass, pos, mf...) are real abbreviations
//    and common substrings of ordinary words (class, positive, bass,
//    McDonald's...). Those are only matched as a STANDALONE word/token,
//    never as a substring - otherwise completely normal messages would
//    get blocked.
//  - Every token is normalized before comparison - lowercased, common
//    leetspeak decoded (@→a, 4→a, 3→e, 0→o, $/5→s, 1/!→i, 7/+→t), every
//    remaining non-letter character stripped, and 3+ repeated letters
//    squashed to 2. That means "f*ck", "f**k", "f.u.c.k", "sh1t",
//    "m@darchod", "m4darchod", and "MADARCHOD" all normalize to the same
//    key as their plain spelling, without needing every possible spelling
//    spelled out in the list.
//  - Longer, unambiguous entries (5+ letters, e.g. "madarchod", "bhenchod",
//    "chutiya") are ALSO checked against the message with every space
//    removed too, to catch spacing the word out letter-by-letter
//    ("m a d a r c h o d"). Short entries are excluded from this pass for
//    the same false-positive reason as above - collapsing a whole message
//    down and substring-searching for "ass" or "mc" would flag ordinary
//    sentences.
//  - A handful of entries are multi-word phrases ("bhen ke lode", "gand
//    mara") - those are matched as consecutive normalized tokens, with
//    flexible whitespace, plus a couple of pre-merged spellings someone
//    might type as one word.
//
//  This isn't a perfect filter (no word list is), but it covers the given
//  list plus its common leetspeak/spacing evasions without nuking ordinary
//  conversation over short substrings.
// ============================================================

const RAW_WORDS = [
  // English profanity
  'fuck', 'fucking', 'fucker', 'motherfucker', 'fuckhead', 'fuckface',
  'shit', 'bullshit', 'shitty', 'bitch', 'bitchy', 'bastard', 'asshole', 'arsehole',
  'dumbass', 'jackass', 'ass', 'dick', 'dickhead', 'dickwad', 'cock', 'pussy', 'cunt',
  'prick', 'slut', 'whore', 'hoe', 'skank', 'sonofabitch', 'damn', 'goddamn', 'crap',
  'piss', 'pissed', 'twat', 'wanker', 'jerkoff', 'dipshit', 'shithead', 'shitface',
  'douche', 'douchebag', 'scumbag', 'moron', 'idiot', 'stupid', 'retard', 'retarded',
  // Common obfuscated/short spellings (kept explicit alongside normalization)
  'fck', 'fuk', 'fukc', 'fuq', 'f*ck', 'f**k', 'fckr',
  'mf', 'mfer', 'mfu', 'stfu', 'wtf', 'gtfo', 'pos', 'bs', 'stfd',
  'bkl', 'mkc', 'bkc', 'lbc', 'lmc', 'gmd', 'gmr',
  // Hindi/Punjabi abuse (transliterated) + common obfuscations
  'madarchod', 'madarch0d', 'mc', 'm.c', 'm@darchod', 'madharchod', 'maderchod',
  'madarchuth', 'madarchoot', 'm4darchod',
  'bhenchod', 'benchod', 'bhench*d', 'bc', 'b.c',
  'bhen ke lode', 'behen ke lode', 'behenchod', 'behen ch*d',
  'chutiya', 'chutiye', 'chutia', 'chuti', 'chut', 'chutiyapa', 'chutiyaapa',
  'gaand', 'gand', 'g@nd', 'gaandu', 'gandu', 'ganduu',
  'gand mara', 'gaand mara', 'gaand mein',
  'lodu', 'loda', 'lauda', 'launda', 'lawda', 'lwda', 'l*da',
  'lund', 'l*nd', 'lunnd', 'lund choos', 'lundchus',
  'chod', 'chodu', 'chodna', 'chudai', 'chudwa', 'chudakkad',
  'randi', 'rand', 'randwa', 'randi ka', 'randi ke',
  'harami', 'haraami', 'haramzada', 'haramzade', 'haramkhor',
  'kamina', 'kamine', 'kameena', 'kameene',
  'kutte', 'kutta', 'kutiya', 'suar', 'suar ka',
  'bhosdike', 'bhosdi', 'bhosda', 'bhosdiwala', 'bhosdawala', 'bhosd', 'bhosadi', 'bhosadike', 'bhosad',
  'jhantu', 'jhaantu', 'jhant', 'jhantoo',
  'chakka', 'hijra',
  // Extra merged spellings for the phrases above, in case someone runs them
  // together as one word instead of leaving the spaces in.
  'bhenkelode', 'behenkelode', 'gandmara', 'gaandmara', 'gaandmein',
];

const LEET_MAP = {
  '@': 'a', '4': 'a',
  '3': 'e',
  '0': 'o',
  '$': 's', '5': 's',
  '1': 'i', '!': 'i',
  '7': 't', '+': 't',
};
const LEET_RX = /[@435071!+$]/g;

function foldLeet(s) {
  return s.replace(LEET_RX, (ch) => LEET_MAP[ch] ?? ch);
}

// Lowercase, leet-decode, strip everything that isn't a plain letter, and
// squash 3+ repeated letters down to 2 - so "f*ck", "F.U.C.K", "sh1t", and
// "fuuuuuck" all collapse to the same comparison key as their plain form.
function normalizeWord(raw) {
  return foldLeet(String(raw).toLowerCase())
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1{2,}/g, '$1$1');
}

const SINGLE_WORDS = new Set();
const PHRASES = [];
for (const entry of RAW_WORDS) {
  if (/\s/.test(entry.trim())) {
    const words = entry.trim().split(/\s+/).map(normalizeWord).filter(Boolean);
    if (words.length > 1) PHRASES.push(words);
  } else {
    const n = normalizeWord(entry);
    if (n) SINGLE_WORDS.add(n);
  }
}

// Only long, unambiguous entries are checked with whitespace fully removed
// (see file header for why short ones are excluded from this pass).
const MIN_LEN_FOR_SPACED_MATCH = 5;
const SPACED_EVASION_WORDS = [...SINGLE_WORDS].filter((w) => w.length >= MIN_LEN_FOR_SPACED_MATCH);

// True if `text` contains any banned word/phrase (including common
// leetspeak, punctuation-inserted, or letter-by-letter-spaced evasions).
export function containsProfanity(text) {
  if (!text) return false;
  const tokens = String(text).split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;

  const normTokens = tokens.map(normalizeWord);

  for (const t of normTokens) {
    if (t && SINGLE_WORDS.has(t)) return true;
  }

  for (const phrase of PHRASES) {
    for (let i = 0; i + phrase.length <= normTokens.length; i++) {
      if (phrase.every((w, j) => normTokens[i + j] === w)) return true;
    }
  }

  const collapsed = normTokens.join('');
  return SPACED_EVASION_WORDS.some((w) => collapsed.includes(w));
}
