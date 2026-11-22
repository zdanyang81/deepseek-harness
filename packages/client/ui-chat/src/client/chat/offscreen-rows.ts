/**
 * Render skipping for Chat flow rows far outside the scrollport. Rows stay
 * mounted, so browser find, `hidden="until-found"` reveal, DOM anchor lookups,
 * and focus keep working; only style, layout, and paint of distant rows stop.
 */

/** Distance beyond each scrollport edge, as a share of its height, within which rows render normally. */
const RENDER_MARGIN = '200% 0px'

/** Attribute that `ChatView.module.css` maps to `content-visibility: auto`. */
const OFFSCREEN_ATTRIBUTE = 'data-chat-offscreen'

function release(row: HTMLElement): void {
  row.removeAttribute(OFFSCREEN_ATTRIBUTE)
  row.style.removeProperty('contain-intrinsic-size')
}

function mark(entry: IntersectionObserverEntry): void {
  const row = entry.target as HTMLElement
  const { width, height } = entry.boundingClientRect
  // Zero-height rows (hidden, empty) gain nothing, and pinning a zero size
  // would collapse the row if it becomes visible while still far away.
  if (entry.isIntersecting || height === 0) {
    release(row)
    return
  }
  // Rows only enter skipping after they have rendered once, so the measured
  // size keeps the scroll height and every row offset unchanged.
  row.style.setProperty('contain-intrinsic-size', `auto ${width}px auto ${height}px`)
  row.setAttribute(OFFSCREEN_ATTRIBUTE, '')
}

/**
 * One IntersectionObserver over the Chat flow rows. Rows register before the
 * scrollport is known (child layout effects run before the owner's effects),
 * so registrations are retained and observed once `attach` supplies the root.
 */
export class OffscreenRows {
  private readonly rows = new Set<HTMLElement>()
  private observer: IntersectionObserver | null = null

  /**
   * Start observing registered rows against a scrollport.
   * @param root - the scroll container whose viewport defines "far".
   * @returns disposer that stops observing and releases every marked row.
   */
  attach(root: HTMLElement): () => void {
    if (typeof IntersectionObserver === 'undefined') return () => {}
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) mark(entry)
    }, { root, rootMargin: RENDER_MARGIN })
    this.observer = observer
    for (const row of this.rows) observer.observe(row)
    return () => {
      observer.disconnect()
      this.observer = null
      for (const row of this.rows) release(row)
    }
  }

  /**
   * Register one flow row for render skipping.
   * @param row - the row's stable wrapper element.
   * @returns disposer that unregisters the row and restores normal rendering.
   */
  readonly observe = (row: HTMLElement): (() => void) => {
    this.rows.add(row)
    this.observer?.observe(row)
    return () => {
      this.rows.delete(row)
      this.observer?.unobserve(row)
      release(row)
    }
  }
}
