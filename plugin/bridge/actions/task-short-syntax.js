async function parseTaskShortSyntax(title) {
  const parsed = { title: title || "", tagIds: [] };
  const remove = [];

  for (const match of title.matchAll(/#([\p{L}\p{N}_-]+)/gu)) {
    const tag = await findTagByTitle(match[1]);
    if (tag?.id) parsed.tagIds.push(tag.id);
    remove.push(match[0]);
  }

  for (const match of title.matchAll(/\+([\p{L}\p{N}_-]{3,})/gu)) {
    const project = await findProjectByPrefix(match[1]);
    if (project?.id && !parsed.projectId) parsed.projectId = project.id;
    remove.push(match[0]);
  }

  const due = parseDueSyntax(title);
  if (due) {
    parsed.dueDay = due.dueDay;
    if (due.dueWithTime != null) parsed.dueWithTime = due.dueWithTime;
    remove.push(due.token);
    if (due.timeToken) remove.push(due.timeToken);
  }

  const estimate = parseTimeSyntax(title);
  if (estimate) {
    if (estimate.timeSpent != null) parsed.timeSpent = estimate.timeSpent;
    if (estimate.timeEstimate != null) parsed.timeEstimate = estimate.timeEstimate;
    remove.push(estimate.token);
  }

  parsed.title = stripTokens(title, remove) || title;
  return parsed;
}

async function findTagByTitle(title) {
  if (typeof PluginAPI.getAllTags !== "function") return null;
  const tags = await PluginAPI.getAllTags();
  const needle = title.toLowerCase();
  return tags.find((tag) => String(tag.title || tag.name || "").toLowerCase() === needle) || null;
}

async function findProjectByPrefix(prefix) {
  if (typeof PluginAPI.getAllProjects !== "function") return null;
  const projects = await PluginAPI.getAllProjects();
  const needle = prefix.toLowerCase();
  return projects.find((project) => String(project.title || project.name || "").toLowerCase().startsWith(needle)) || null;
}

function parseDueSyntax(title) {
  const match = title.match(/@(today|tomorrow|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)(?:\s+((?:[01]?\d|2[0-3]):[0-5]\d\s*(?:am|pm)?|(?:1[0-2]|0?\d)\s*(?:am|pm)))?/i);
  if (!match) return null;
  const date = resolveDueDate(match[1]);
  const out = { token: match[0], dueDay: localDateStr(date), timeToken: match[2] };
  const time = parseClockTime(match[2]);
  if (time) out.dueWithTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.hour, time.minute).getTime();
  return out;
}

function resolveDueDate(word) {
  const normalized = word.toLowerCase().slice(0, 3);
  const date = new Date();
  if (normalized === "tom") {
    date.setDate(date.getDate() + 1);
    return date;
  }
  if (normalized === "tod") return date;
  const weekdays = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  if (weekdays[normalized] !== undefined) {
    let diff = weekdays[normalized] - date.getDay();
    if (diff <= 0) diff += 7;
    date.setDate(date.getDate() + diff);
  }
  return date;
}

function parseClockTime(raw) {
  if (!raw) return null;
  const match = String(raw).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridian = match[3]?.toLowerCase();
  if (meridian === "pm" && hour < 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

function parseTimeSyntax(title) {
  const match = title.match(/\b(\d+(?:\.\d+)?)([hm])(?:\/(\d+(?:\.\d+)?)([hm]))?\b/i);
  if (!match) return null;
  const first = durationMs(match[1], match[2]);
  const second = match[3] ? durationMs(match[3], match[4]) : null;
  return second == null ? { token: match[0], timeEstimate: first } : { token: match[0], timeSpent: first, timeEstimate: second };
}

function durationMs(amount, unit) {
  const multiplier = unit.toLowerCase() === "h" ? 60 * 60 * 1000 : 60 * 1000;
  return Math.round(Number(amount) * multiplier);
}

function stripTokens(title, tokens) {
  let out = title;
  for (const token of tokens.filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = out.replace(token, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

function localDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

module.exports = { parseTaskShortSyntax };
