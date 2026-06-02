## idle

```js
// no-op
```

## hover

```js
await target.hover();
```

## click

```js
await target.click();
```

## focus

```js
await target.focus();
```

## tab-to

```js
// Tab until target is :focus (max 30 tabs).
for (let i = 0; i < 30; i++) {
  const active = await page.evaluate(() => document.activeElement);
  const isTarget = await target.evaluate((el, active) => el === active, active);
  if (isTarget) break;
  await page.keyboard.press('Tab');
}
```

## scroll-into-view

```js
await target.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
```

## scroll-page

```js
await page.mouse.wheel(0, 800);
```

## press

```js
// {{KEY}} is substituted as JSON.stringify(key) — e.g. "Escape"
await page.keyboard.press({{KEY}});
```

## type

```js
// {{TEXT}} is substituted as JSON.stringify(text)
await target.type({{TEXT}}, { delay: 50 });
```

## drag-to

```js
// {{DEST_SELECTOR}} is substituted as JSON.stringify(destSelector)
await target.dragTo(page.locator({{DEST_SELECTOR}}));
```

## navigate

```js
// {{HREF_SELECTOR}} is substituted as JSON.stringify(hrefSelector)
await page.click({{HREF_SELECTOR}});
await page.waitForLoadState('domcontentloaded');
```

## multi

```js
// Composed from the steps array. Allowed actions: hover, click, focus,
// type, press, scroll-into-view, scroll-page, wait, drag-to. Other
// actions are rejected before generation.
{{MULTI_STEPS_BLOCK}}
```
