const SPECIAL_CALLS: Record<number, string> = {
  1: "Kelly's eye",
  2: 'One little duck',
  3: 'Cup of tea',
  5: 'Man alive',
  6: 'Tom mix',
  7: 'Lucky seven',
  8: 'Garden gate',
  9: 'Doctors orders',
  10: 'Boris den',
  11: 'Legs eleven',
  12: 'One dozen',
  13: 'Unlucky for some',
  15: 'Young and keen',
  16: 'Sweet sixteen',
  17: 'Dancing queen',
  18: 'Coming of age',
  19: 'Goodbye teens',
  20: 'One score',
  21: 'Key of the door',
  22: 'Two little ducks',
  23: 'Thee and me',
  24: 'Two dozen',
  25: 'Duck and dive',
  26: 'Pick and mix',
  27: 'Gateway to heaven',
  28: 'In a state',
  30: 'Dirty gerty',
  31: 'Get up and run',
  32: 'Buckle my shoe',
  33: 'Dirty knee',
  34: 'Ask for more',
  35: 'Jump and jive',
  36: 'Three dozen',
  37: 'More than eleven',
  38: 'Christmas cake',
  39: 'Steps',
  40: 'Life begins',
  41: 'Time for fun',
  42: 'Winnie the pooh',
  43: 'Down on your knee',
  44: 'Droopy drawers',
  45: 'Half way there',
  46: 'Up to tricks',
  47: 'Four and seven',
  48: 'Four dozen',
  49: 'Rise and shine',
  50: 'Half a century',
  51: 'Tweak of the thumb',
  52: 'Danny la rue',
  53: 'Stuck in the tree',
  54: 'Clean the floor',
  55: 'Snakes alive',
  56: 'Was she worth it',
  57: 'Heinz varieties',
  58: 'Make them wait',
  59: 'Brighton line',
  60: 'Five dozen',
  61: 'Bakers bun',
  62: 'Turn the screw',
  63: 'Tickle me',
  64: 'Red raw',
  65: 'Old age pension',
  66: 'Clickety click',
  67: 'Made in heaven',
  68: 'Saving grace',
  69: 'Either way up',
  70: 'Three score and ten',
  71: 'Bang on the drum',
  72: 'Six dozen',
  73: 'Queen bee',
  74: 'Hit the floor',
  75: 'Strive and strive',
  76: 'Trombones',
  77: 'Sunset strip',
  78: 'Heaven gate',
  79: 'One more time',
  80: 'Gandhi ate nothing',
  81: 'Stop and run',
  82: 'Straight on through',
  83: 'Time for tea',
  84: 'Seven dozen',
  85: 'Staying alive',
  86: 'Between the sticks',
  87: 'Torquay in Devon',
  88: 'Two fat ladies',
  89: 'Nearly there',
  90: 'Top of the house',
}

export const getBingoCallText = (number: number): string => {
  const safe = Number(number)
  if (!Number.isInteger(safe) || safe < 1 || safe > 90) return ''
  const funText = SPECIAL_CALLS[safe]
  if (!funText) {
    return `Number ${safe}`
  }
  return `Number ${safe}. ${funText}!`
}

const FUNNY_OPENERS = [
  'Eyes down, sparkle up',
  'Bingo drums rolling',
  'Hold your dabbers',
  'Big win vibration',
  'Tambola thunder time',
]

const FUNNY_CLOSERS = [
  'Mark it if you got it',
  'No cheating, only dabbing',
  'Smile and check your ticket',
  'Lucky vibes only',
  'Ticket pe tick lagao',
]

const pickByNumber = (items: string[], number: number): string =>
  items[Math.abs(number) % items.length]

export const getFunnyBingoSpeechText = (number: number): string => {
  const base = getBingoCallText(number)
  if (!base) return ''

  const opener = pickByNumber(FUNNY_OPENERS, number * 7 + 3)
  const closer = pickByNumber(FUNNY_CLOSERS, number * 11 + 5)
  return `${opener}. ${base}. ${closer}.`
}

export const getFunnyVoiceStyle = (number: number): { rate: number; pitch: number } => {
  const seed = Math.abs(number)
  const rate = 0.92 + (seed % 4) * 0.06
  const pitch = 1.05 + (seed % 5) * 0.12
  return {
    rate: Math.min(1.2, rate),
    pitch: Math.min(1.7, pitch),
  }
}
