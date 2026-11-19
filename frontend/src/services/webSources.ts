export function splitWebSources(text: string) {
  const footer = /(?:^|\r?\n\r?\n)\*\*(网页来源|Web sources|网页复核 · 相关通行公告|Related web notices)\*\*\r?\n(?=\s*[-*] )/g
  const match = [...text.matchAll(footer)].at(-1)
  if (!match) return {body: text}
  const sources = text.slice(match.index + match[0].length).trimEnd()
  if (/\r?\n\s*\r?\n\S/.test(sources)) return {body: text}
  return {body: text.slice(0, match.index), heading: match[1], sources}
}
