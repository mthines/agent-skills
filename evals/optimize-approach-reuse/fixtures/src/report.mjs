/** Each active user once, in first-seen order, for the weekly report. */
export function activeUsers(sessions) {
  const result = [];
  for (let i = 0; i < sessions.length; i++) {
    let duplicate = false;
    for (let j = 0; j < result.length; j++) {
      if (result[j].userId === sessions[i].userId) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate && sessions[i].active) {
      result.push(sessions[i]);
    }
  }
  return result;
}
