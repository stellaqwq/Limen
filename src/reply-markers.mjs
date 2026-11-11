// Reply marker grammar shared by the reply stream, meme and voice plugins.
// Streaming must recognise markers even when the meme plugin is not loaded,
// so the tokenizer lives in the host.
const markerPairs = { '[': ']', '[[': ']]', '【': '】', '【【': '】】', '［': '］', '［［': '］］' };
const memeTag = () => /(?<![\[【［])(\[\[|\[|【【|【|［［|［)\s*(?:(表情)\s*[:：]\s*)?([^\[\]【】［］\r\n]{0,100})\s*(\]\]|\]|】】|】|］］|］)(?![\]】］])/gu;

function codeRanges(value) {
  const code = []; let opening;
  for (const tick of value.matchAll(/`+/gu)) {
    if (!opening) opening = { index: tick.index, length: tick[0].length };
    else if (tick[0].length === opening.length) { code.push([opening.index, tick.index + tick[0].length]); opening = null; }
  }
  if (opening) code.push([opening.index, value.length]);
  return code;
}

export const replyTags = (value, categories = []) => {
  const references = new Set(categories.flatMap(category => [category.id, category.name]));
  const code = codeRanges(value);
  const tags = [];
  const cleaned = value.replace(memeTag(), (marker, left, prefix, reference, right, index) => {
    if (markerPairs[left] !== right || !prefix && left.length !== 2) return marker;
    if (code.some(([start, end]) => index >= start && index < end)) return marker;
    const name = reference.trim();
    // Category names are bounded at 30 characters, generated UUIDs at 36;
    // the marker grammar bounds both without truncating custom category IDs.
    if (!prefix && !references.has(name)) return marker;
    if (name) tags.push(name);
    return '';
  }).trim();
  return { tags, cleaned };
};

export const textWithoutMemeTags = (value, categories = []) => replyTags(value, categories).cleaned;

// Hold full markers and incomplete headers until media planning can remove
// them. Ordinary ASCII arrays can resume streaming once their '[' is resolved.
export const memeStreamBoundary = value => value.search(/\[\[|[【［]|\[\s*(?:表情\s*[:：]|表(?:情\s*)?$|$)/u);
