const WINDOWS_1252_BYTES = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f]
]);

const MOJIBAKE_MARKERS = [
  '\u00c2',
  '\u00c3',
  '\u00c4',
  '\u00c6',
  '\u00e1\u00ba',
  '\u00e1\u00bb',
  '\u00e2\u0080',
  '\u00e2\u009d',
  '\u00e2\u0161',
  '\u00ef\u00b8',
  '\u00f0\u0178'
];

const utf8Decoder = new TextDecoder('utf-8', {
  fatal: true
});

function mojibakeScore(value) {
  let score = 0;

  for (const marker of MOJIBAKE_MARKERS) {
    let offset = 0;
    while ((offset = value.indexOf(marker, offset)) >= 0) {
      score++;
      offset += marker.length;
    }
  }

  return score;
}

function windows1252Byte(character) {
  const codePoint = character.codePointAt(0);
  if (codePoint <= 0xff) return codePoint;
  return WINDOWS_1252_BYTES.get(codePoint);
}

function decodeRun(run) {
  const beforeScore = mojibakeScore(run);
  if (beforeScore === 0) return run;

  const bytes = [];
  for (const character of run) {
    const byte = windows1252Byte(character);
    if (byte === undefined) return run;
    bytes.push(byte);
  }

  try {
    const decoded = utf8Decoder.decode(Uint8Array.from(bytes));
    return mojibakeScore(decoded) < beforeScore
      ? decoded
      : run;
  } catch {
    return run;
  }
}

function repairPass(value) {
  let output = '';
  let run = '';

  const flush = () => {
    output += decodeRun(run);
    run = '';
  };

  for (const character of value) {
    if (windows1252Byte(character) !== undefined) {
      run += character;
    } else {
      flush();
      output += character;
    }
  }
  flush();

  return output;
}

export function repairMojibake(value) {
  if (typeof value !== 'string') return value;

  let repaired = value;
  for (let pass = 0; pass < 3; pass++) {
    const next = repairPass(repaired);
    if (next === repaired) break;
    repaired = next;
  }
  return repaired;
}

let installed = false;

export function installUtf8Console() {
  if (installed) return;
  installed = true;

  for (const method of ['debug', 'error', 'info', 'log', 'warn']) {
    const original = console[method].bind(console);
    console[method] = (...args) =>
      original(
        ...args.map(argument =>
          typeof argument === 'string'
            ? repairMojibake(argument)
            : argument
        )
      );
  }
}
