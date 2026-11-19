# Messages and feedback

How the app answers an action, so every message reads and looks the same.
There are two kinds, and one component for each.

## Toasts: the answer to an action

Raised with `notify` (`desktop-app/src/renderer/src/lib/notify.ts`), never
with `sonner`'s `toast` directly.

| Call | When | Stays |
| --- | --- | --- |
| `notify.success(title)` | an action finished | 4 s |
| `notify.info(title)` | nothing happened, and why; or what the app did on its own | 6 s |
| `notify.warning(title)` | a result with a catch | 8 s |
| `notify.error(title, { cause })` | a failure | 10 s |
| `notify.failed(cause, title)` | a failure with no more specific title | 10 s |
| `notify.progress(title)` … `notify.success(…, { id })` | a step that takes a while; one toast follows it to the end | until done |
| `notify.copy(text, done)` | copy to the clipboard, with its confirmation or failure | |
| `notify.exported(key, path)` | a written file: its name and "Show in folder" | |

Writing a message:

- The **title** says what happened in one short sentence without a full
  stop: „Vorlage „Standard“ gespeichert“, „Speichern fehlgeschlagen“.
- Detail goes in the **description**: a file name, the names behind a
  count, a hint what to do next.
- A failure names what failed in the title and passes the error as
  `cause`; its message (without Electron's IPC prefix) becomes the
  description. Translations never embed `{{error}}` in a title.
- At most one **action** (Undo, Open settings, Show in folder). A toast with
  an action stays at least 8 s.
- The same title twice replaces the first instead of stacking.

## Inline notices: a lasting state

Something that stays true until the user acts (an analysis running,
boundaries to review, figures that are provisional, a missing model) is an
`Alert` (`components/ui/alert.tsx`) in the page, dialog or over the map, not
a toast.

- `variant`: `neutral`, `info`, `success`, `warning`, `destructive`.
  Only `warning` and `destructive` tint the surface; the others are a plain
  card with a coloured icon.
- `floating` adds the shadow for notices over the map.
- Parts: `AlertTitle`, `AlertDescription`, `AlertActions` (buttons with
  `size="xs"`), and `aside` for a dismiss button or one short action.
- `destructive` is announced at once (`role="alert"`), the rest politely
  (`role="status"`); `announce={false}` when an inner part announces itself.

Toasts use the same surface, border, icons and type sizes as `Alert`.

## Map elements

Location pins, cluster badges, hover tooltips, the location popup and the
storm's drag handle are Leaflet DOM, styled in
`desktop-app/src/renderer/src/styles/globals.css` with the app's tokens, so
they follow light and dark mode:

- **Pin**: teardrop in the hail-zone colour with the zone printed in a
  readable colour, a card-coloured rim; new business carries a primary "+"
  badge; the selected pin gets the focus ring.
- **Cluster**: a round card badge with the count; its ring shows the highest
  hail zone inside.
- **Tooltip and popup**: the popover surface; popup actions are the app's
  buttons, review points small warning notices.
