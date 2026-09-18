// @description Count remaining inbox items and name the first few
// @param limit  How many names to include (default 5)
(() => {
  const limit = params.limit || 5;
  return JSON.stringify({
    count: inbox.length,
    names: inbox.slice(0, limit).map((t) => t.name),
  });
})()
