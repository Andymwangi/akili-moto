export function findLeakedWords(words: readonly string[], assets: readonly string[]): string[] {
  const uniqueWords = [...new Set(words)].filter((word) => /^[a-z]{5}$/.test(word));
  return uniqueWords.filter((word) => assets.some((asset) => asset.includes(word)));
}

export function findLeakedContent(content: readonly string[], assets: readonly string[]): string[] {
  const uniqueContent = [
    ...new Set(content.map((item) => item.trim()).filter((item) => item.length > 0)),
  ];
  return uniqueContent.filter((item) => assets.some((asset) => asset.includes(item)));
}
