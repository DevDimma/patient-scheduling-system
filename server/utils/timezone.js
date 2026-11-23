// Timezone helper for Africa/Lagos (WAT / UTC+1)

/**
 * Returns the current date in Africa/Lagos as 'YYYY-MM-DD'
 */
function getLagosDateString(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
  return parts; // 'YYYY-MM-DD' in en-CA format
}

/**
 * Returns current time in Africa/Lagos as { hours, minutes, seconds, timeStr: 'HH:MM:SS', minutesFromMidnight }
 */
function getLagosCurrentTime(d = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const timeStr = formatter.format(d); // 'HH:MM:SS'
  const [h, m, s] = timeStr.split(':').map(Number);
  return {
    hours: h,
    minutes: m,
    seconds: s,
    timeStr,
    minutesFromMidnight: h * 60 + m
  };
}

module.exports = {
  getLagosDateString,
  getLagosCurrentTime
};
