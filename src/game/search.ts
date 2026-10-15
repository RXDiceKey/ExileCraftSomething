// PoE stash-search syntax: space-separated terms must all match, "..." keeps spaces in one term,
// a leading ! negates a term, each term is a case-insensitive regex.
function toRegExp(body: string): RegExp {
  try {
    return new RegExp(body, 'i')
  } catch {
    // Half-typed regex: match it as plain text until it's valid.
    return new RegExp(body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }
}

export function compileSearch(query: string): ((text: string) => boolean) | null {
  const terms = (query.match(/!?"[^"]*"?|\S+/g) ?? [])
    .map((raw) => {
      const neg = raw.startsWith('!')
      return { neg, body: (neg ? raw.slice(1) : raw).replace(/^"|"$/g, '') }
    })
    .filter((t) => t.body)
    .map((t) => ({ neg: t.neg, re: toRegExp(t.body) }))
  if (!terms.length) return null
  return (text) => terms.every((t) => t.re.test(text) !== t.neg)
}
