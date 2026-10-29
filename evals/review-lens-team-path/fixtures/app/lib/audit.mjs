const events = [];

/** Append one audit event; the compliance export reads these. */
export const audit = {
  record(event, data) {
    events.push({ event, data, at: Date.now() });
  },
  all() {
    return [...events];
  },
};
