// Standalone notes (project notes and notes pinned to Today) read from the
// plugin's app state. The MCP server reads Local REST /notes instead when it
// is configured, and only lets these tools run with the read and notes
// scopes. Mirrors noteView in internal/bridge/notes.go.
const { typedError } = require("../errors");

const NOTE_WRITES_UNAVAILABLE = "Changing notes needs Local REST (SP_LOCAL_REST_URL and SP_LOCAL_REST_TOKEN). Nothing was changed.";

function noteView(note) {
  const out = {
    id: note.id,
    content: note.content,
    projectId: note.projectId ?? null,
    isPinnedToToday: note.isPinnedToToday === true,
  };
  if (note.created !== undefined) out.created = note.created;
  if (note.modified !== undefined) out.modified = note.modified;
  return out;
}

async function readNotes() {
  if (typeof PluginAPI.getAppState !== "function") {
    throw typedError("UNSUPPORTED_ACTION", "Reading notes needs Local REST or PluginAPI.getAppState, which this Super Productivity runtime lacks", false);
  }
  const state = await PluginAPI.getAppState();
  return Object.values((state && state.notes) || {}).filter(Boolean);
}

module.exports = {
  "note.list": async (payload) => {
    const projectId = payload?.projectId || payload?.project_id;
    const notes = (await readNotes())
      .filter((note) => !projectId || note.projectId === projectId)
      .filter((note) => payload?.pinnedToToday !== true || note.isPinnedToToday === true);
    return { notes: notes.map(noteView), via: "plugin" };
  },
  "note.get": async (payload) => {
    const id = payload?.noteId || payload?.note_id || payload?.id;
    if (!id) throw typedError("INVALID_REQUEST", "noteId is required", false);
    const note = (await readNotes()).find((candidate) => candidate.id === id);
    if (!note) throw typedError("NOTE_NOT_FOUND", `Note ${id} not found`, false);
    return { note: noteView(note), via: "plugin" };
  },
  // Note writes go through Local REST, which the MCP server calls itself; the
  // plugin API has no note writes.
  "note.create": async () => {
    throw typedError("UNSUPPORTED_ACTION", NOTE_WRITES_UNAVAILABLE, false);
  },
  "note.update": async () => {
    throw typedError("UNSUPPORTED_ACTION", NOTE_WRITES_UNAVAILABLE, false);
  },
  "note.delete": async () => {
    throw typedError("UNSUPPORTED_ACTION", NOTE_WRITES_UNAVAILABLE, false);
  },
};
