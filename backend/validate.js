const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

// Rejects anything that isn't a plausible chat message: wrong type, empty,
// or absurdly long (guards against abuse and unnecessary AI token cost).
function isValidMessage(value, maxLength = 4000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

module.exports = { isValidUuid, isValidMessage };
