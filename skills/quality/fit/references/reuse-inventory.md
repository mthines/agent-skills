# Why inventory mode lists every new thing and asks for a verdict

Coding agents find the existing code they should reuse almost every time (about 99 % of runs), but reuse it in only 67–86 % of them.
The gap is the decision, not the search, so a better search does not close it.
Inventory mode moves the decision into the open: a deterministic script lists every symbol, route, component, and file the diff adds, and each one needs a written verdict that names the existing path it could have used, or the reason it could not.

The script stays deterministic so the list cannot be talked down: an agent judging its own diff from memory skips the items it already decided were fine.
Approach mode stays silent when the approach is sound because one weak proposal costs trust; inventory mode writes a row per item because the row is the justification, and a `new` row with a reason is a cheap, checkable answer.

A real component registry or Storybook beats prose about the design system as the search target, because it names the component a reviewer would expect to see reused.
