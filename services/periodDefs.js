// Cleans and validates a bell schedule (period rows). Shared by manual editing and PDF import.
const TIME_RE = /^\d{1,2}:\d{2}$/;

// Returns { periods } or { error }.
function cleanPeriodDefs(periodDefs) {
  if (!Array.isArray(periodDefs)) return { error: 'periodDefs must be an array' };
  const periods = periodDefs.map((p) => ({
    code: String(p?.code || '').trim(),
    start: String(p?.start || '').trim(),
    end: String(p?.end || '').trim(),
    isBreak: !!p?.isBreak,
  })).filter((p) => p.code);
  if (periods.some((p) => (p.start && !TIME_RE.test(p.start)) || (p.end && !TIME_RE.test(p.end)))) {
    return { error: 'Times must look like 08:50' };
  }
  const teaching = periods.filter((p) => !p.isBreak).map((p) => p.code.toUpperCase());
  if (new Set(teaching).size !== teaching.length) return { error: 'Class period labels must each be unique' };
  return { periods };
}

module.exports = { cleanPeriodDefs, TIME_RE };
