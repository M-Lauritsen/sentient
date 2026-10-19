// Browser/Node shared UTF-8 accounting, including lone-surrogate replacement.
// No Buffer, encoding allocation or cutting a Unicode code point in half.
function characterBytes(character) {
  const point = character.codePointAt(0);
  return point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
}

export function utf8ByteLength(text, stopAfter = Infinity) {
  let bytes = 0;
  for (const character of text) {
    bytes += characterBytes(character);
    if (bytes > stopAfter) break;
  }
  return bytes;
}

export function clipUtf8(text, maxBytes) {
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const size = characterBytes(character);
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += character.length;
  }
  return { text: text.slice(0, end), truncated: end < text.length };
}
