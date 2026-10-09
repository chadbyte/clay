function formatSessionActivity(value) {
  if (!value) return "";
  var date = new Date(value);
  if (isNaN(date.getTime())) return "";
  try {
    return "Last activity: " + new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch (error) {
    return "Last activity: " + date.toLocaleString();
  }
}

export { formatSessionActivity };
