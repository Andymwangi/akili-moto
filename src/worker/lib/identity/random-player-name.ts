const adjectives = [
  'Bold',
  'Brave',
  'Bright',
  'Calm',
  'Clever',
  'Curious',
  'Friendly',
  'Happy',
  'Keen',
  'Kind',
  'Lucky',
  'Merry',
  'Patient',
  'Playful',
  'Quick',
  'Quiet',
  'Sharp',
  'Sunny',
  'Wise',
] as const;

const animals = [
  'Badger',
  'Bison',
  'Cheetah',
  'Dolphin',
  'Eagle',
  'Falcon',
  'Gecko',
  'Heron',
  'Koala',
  'Lemur',
  'Lion',
  'Mongoose',
  'Otter',
  'Panda',
  'Penguin',
  'Raven',
  'Robin',
  'Turtle',
  'Zebra',
] as const;

export function createRandomPlayerName(): string {
  const [adjectiveRoll = 0, animalRoll = 0, numberRoll = 0] = crypto.getRandomValues(
    new Uint32Array(3),
  );
  const adjective = adjectives[adjectiveRoll % adjectives.length];
  const animal = animals[animalRoll % animals.length];
  const number = String(numberRoll % 10_000).padStart(4, '0');

  return `${adjective} ${animal} ${number}`;
}
