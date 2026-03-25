'use client'

/**
 * overflow.tsx
 *
 * Compositional overflow detection following the shadcn/base-ui atomic pattern.
 *
 * Goals:
 *   • Accurate overflow decisions across horizontal/vertical/wrap/grid layouts
 *   • Compositional API (no child cloning, no render-prop-only lock-in)
 *   • Stable behavior in constrained flex layouts (no width blowout)
 *   • Accessibility-first hidden-state handling
 *
 * Components:
 *   Overflow           — root context provider, renders a flex container
 *   OverflowGroup      — clipping viewport + measurement engine (formerly OverflowContainer)
 *   OverflowItem       — individually registered measurable child
 *   OverflowSeparator  — auto-hiding divider between OverflowItems
 *   OverflowIndicator  — overflow slot, lives inside the clipping boundary
 *   OverflowActions    — persistent action area, always visible
 *   OverflowAnnouncer  — visually-hidden aria-live region for screen readers
 *
 * Hooks:
 *   useOverflow        — reactive state from anywhere in the tree
 *   useOverflowItem    — per-item hidden state for animations / conditional render
 *
 * Design decisions:
 *   • Registration pattern: each OverflowItem registers its own DOM ref.
 *     No child cloning, no double-render, no grid wrapper dimension issues.
 *   • Optional `fill` mode on OverflowGroup:
 *     - fill=true  → group fills available space (flex-1 w-full)
 *     - fill=false → group is content-sized but can still shrink
 *   • `stabilizeByParent` on OverflowGroup (default true):
 *     measurement space is anchored to the parent content box when available,
 *     preventing visible-count oscillation in content-sized groups.
 *   • OverflowActions can render either outside or inside OverflowGroup.
 *     When inside, it registers and reserves space in overflow math.
 *     Placement guidance:
 *       - outside group: actions are independent/pinned, never consume item-fit budget
 *       - inside group: actions participate in fit, ideal when they should hug indicator/items
 *   • Orientation-aware reservation:
 *     - horizontal reserves action width
 *     - vertical/wrap/grid reserve action height
 *   • keepMounted (default true): hidden items stay in the DOM with
 *     data-hidden + aria-hidden + tabIndex=-1, preserving React subtree state.
 *     Hidden items use zero-footprint positioning (not large off-screen offsets)
 *     to avoid accidental page-width expansion.
 *   • forceMount on OverflowIndicator: always renders, data-visible toggles.
 *     Enables CSS transitions without JS animation libraries.
 *   • Two-context split: OverflowContext (stable config) keeps components that
 *     only need orientation/rootId from re-rendering on store changes.
 *   • Primitive selectors on useStore: each subscriber re-renders only when
 *     its specific slice changes.
 *   • resolveSpace() + parent clamping:
 *     available space is resolved from container and parent content boxes,
 *     keeping measurement bounded in nested flex layouts with gaps/padding.
 *   • Dual ResizeObserver: watches both container + parent element.
 *     Per-item observation also tracks indicator/actions size changes.
 *   • useIsomorphicLayoutEffect throughout: SSR safe.
 *   • propsRef pattern on all callbacks: never stale, no deps array sprawl.
 *
 * Quick usage patterns:
 *
 *   1) Horizontal toolbar (actions outside group, pinned trailing controls)
 *
 *      <Overflow orientation="horizontal" className="w-full">
 *        <OverflowGroup fill={false} className="flex items-center gap-2">
 *          {items.map(item => <OverflowItem key={item.id}>{item.label}</OverflowItem>)}
 *          <OverflowIndicator>{({ hiddenCount }) => <span>+{hiddenCount}</span>}</OverflowIndicator>
 *        </OverflowGroup>
 *        <OverflowActions><button>Filter</button></OverflowActions>
 *      </Overflow>
 *
 *   2) Horizontal toolbar (actions inside group, indicator-adjacent)
 *
 *      <Overflow orientation="horizontal" className="w-full">
 *        <OverflowGroup fill={false} className="flex items-center gap-2">
 *          {items.map(item => <OverflowItem key={item.id}>{item.label}</OverflowItem>)}
 *          <OverflowIndicator>{({ hiddenCount }) => <span>+{hiddenCount}</span>}</OverflowIndicator>
 *          <OverflowActions><button>Filter</button></OverflowActions>
 *        </OverflowGroup>
 *      </Overflow>
 *
 *   3) Wrap chips (actions on reserved row)
 *
 *      <Overflow orientation="wrap" className="w-full h-28">
 *        <OverflowGroup className="flex flex-wrap gap-2 h-full">
 *          {chips.map(chip => <OverflowItem key={chip.id}>{chip.label}</OverflowItem>)}
 *          <OverflowIndicator><span>+N</span></OverflowIndicator>
 *          <OverflowActions className="w-full">...</OverflowActions>
 *        </OverflowGroup>
 *      </Overflow>
 *
 *   4) Grid cards (actions spanning full grid width)
 *
 *      <Overflow orientation="grid" className="h-full">
 *        <OverflowGroup className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
 *          {cards.map(card => <OverflowItem key={card.id}>{card.content}</OverflowItem>)}
 *          <OverflowIndicator>{({ hiddenCount }) => <span>+{hiddenCount} more</span>}</OverflowIndicator>
 *          <OverflowActions style={{ gridColumn: '1 / -1' }}>...</OverflowActions>
 *        </OverflowGroup>
 *      </Overflow>
 */

import * as React from 'react'
import { useRender } from '@base-ui/react/use-render'
import { mergeProps } from '@base-ui/react/merge-props'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useIsomorphicLayoutEffect } from '@/hooks/use-isomorphic-effect'

// ─── Component name constants ─────────────────────────────────────────────────

const ROOT_NAME = 'Overflow'
const CONTAINER_NAME = 'OverflowGroup'
const ITEM_NAME = 'OverflowItem'
const INDICATOR_NAME = 'OverflowIndicator'
const ACTIONS_NAME = 'OverflowActions'
const ANNOUNCER_NAME = 'OverflowAnnouncer'
const SEPARATOR_NAME = 'OverflowSeparator'

// ─── Public types ─────────────────────────────────────────────────────────────

export type OverflowOrientation =
  | 'horizontal'
  | 'vertical'
  | 'wrap'
  | 'grid'
  | 'none'

export type OverflowFitStrategy = 'preferred' | 'min' | 'balanced'

export interface OverflowInfo {
  /** Number of children not rendered in the main flow */
  hiddenCount: number
  /** The ReactNode children that are currently hidden */
  hiddenChildren: Array<React.ReactNode>
  /** True when any children are hidden */
  isOverflowing: boolean
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface OverflowStoreState {
  visibleCount: number
  hiddenCount: number
  isOverflowing: boolean
  /**
   * IDs of items past visibleCount.
   * Used by useOverflowItem() for per-item hidden state.
   */
  hiddenIds: ReadonlySet<string>
  /**
   * IDs of items in the overscan window: [visibleCount, visibleCount + overscan).
   * These items stay mounted (but hidden) even when their OverflowItem has
   * keepMounted={false}, reducing remount cost on resize.
   */
  overscanIds: ReadonlySet<string>
}

interface OverflowStore {
  subscribe: (cb: () => void) => () => void
  getState: () => OverflowStoreState
  setState: <K extends keyof OverflowStoreState>(
    key: K,
    value: OverflowStoreState[K],
  ) => void
  /**
   * Apply multiple state keys in one atomic write.
   * Subscribers are notified at most once — even if all four keys change —
   * preventing the four sequential re-renders of the old setState pattern.
   */
  batch: (updates: Partial<OverflowStoreState>) => void
  notify: () => void
}

function createStore(initial: OverflowStoreState): OverflowStore {
  const listeners = new Set<() => void>()
  let state = initial

  const notify = () => {
    for (const cb of listeners) cb()
  }

  return {
    subscribe: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getState: () => state,
    setState: (key, value) => {
      if (Object.is(state[key], value)) return
      state = { ...state, [key]: value }
      notify()
    },
    batch: (updates) => {
      let changed = false
      let next = state
      for (const k in updates) {
        const key = k as keyof OverflowStoreState
        const val = updates[key] as OverflowStoreState[typeof key]
        if (!Object.is(next[key], val)) {
          next = { ...next, [key]: val }
          changed = true
        }
      }
      if (changed) {
        state = next
        notify()
      }
    },
    notify,
  }
}

// ─── Contexts ─────────────────────────────────────────────────────────────────

/**
 * Stable config — never changes after mount.
 * Components that only read orientation/rootId will NOT re-render on store changes.
 */
interface OverflowContextValue {
  rootId: string
  orientation: OverflowOrientation
  store: OverflowStore
}

const OverflowContext = React.createContext<OverflowContextValue | null>(null)

function useOverflowContext(consumerName: string): OverflowContextValue {
  const ctx = React.useContext(OverflowContext)
  if (!ctx)
    throw new Error(`\`${consumerName}\` must be used within \`${ROOT_NAME}\``)
  return ctx
}

/**
 * Registration context — overflow participants call these to inform
 * OverflowGroup about measurable DOM elements and nodes.
 *
 * Participants:
 *   • OverflowItem      → registerItem / unregisterItem
 *   • OverflowIndicator → registerIndicator
 *   • OverflowActions   → registerActions (when inside OverflowGroup)
 */
interface OverflowRegistrationContextValue {
  registerItem: (
    id: string,
    el: HTMLElement,
    node: React.ReactNode,
    isSeparator?: boolean,
  ) => void
  unregisterItem: (id: string) => void
  registerIndicator: (el: HTMLElement | null) => void
  registerActions: (el: HTMLElement | null) => void
  /**
   * Returns the registered ReactNode children for every currently-hidden item,
   * in document order, excluding separators.
   * Called at OverflowIndicator render time — always fresh because the indicator
   * already re-renders whenever hiddenIds changes.
   */
  getHiddenNodes: () => Array<React.ReactNode>
}

const OverflowRegistrationContext =
  React.createContext<OverflowRegistrationContextValue | null>(null)

function useOverflowRegistrationContext(
  consumerName: string,
): OverflowRegistrationContextValue {
  const ctx = React.useContext(OverflowRegistrationContext)
  if (!ctx)
    throw new Error(
      `\`${consumerName}\` must be used within \`${CONTAINER_NAME}\``,
    )
  return ctx
}

/**
 * Per-item context — exposes hidden state and index to useOverflowItem().
 */
interface OverflowItemContextValue {
  itemId: string
  isHidden: boolean
  index: number
}

const OverflowItemContext =
  React.createContext<OverflowItemContextValue | null>(null)

function areSetsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) {
    if (!b.has(value)) return false
  }
  return true
}

interface OuterSizeBounds {
  minW: number
  preferredW: number
  maxW: number
  minH: number
  preferredH: number
  maxH: number
}

function clampToRange(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function parseCssPixelSize(value: string): number | null {
  if (!value || value === 'auto' || value === 'none') return null
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getOuterSize(el: HTMLElement): { w: number; h: number } {
  const rect = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const ml = parseFloat(cs.marginLeft) || 0
  const mr = parseFloat(cs.marginRight) || 0
  const mt = parseFloat(cs.marginTop) || 0
  const mb = parseFloat(cs.marginBottom) || 0
  return {
    w: rect.width + ml + mr,
    h: rect.height + mt + mb,
  }
}

function getOuterSizeBounds(
  el: HTMLElement,
  preferredSize: { w: number; h: number },
): OuterSizeBounds {
  const cs = getComputedStyle(el)
  const ml = parseFloat(cs.marginLeft) || 0
  const mr = parseFloat(cs.marginRight) || 0
  const mt = parseFloat(cs.marginTop) || 0
  const mb = parseFloat(cs.marginBottom) || 0

  const horizontalMargins = ml + mr
  const verticalMargins = mt + mb

  const minW = (parseCssPixelSize(cs.minWidth) ?? 0) + horizontalMargins
  const rawMaxW = parseCssPixelSize(cs.maxWidth)
  const maxW =
    rawMaxW === null ? Number.POSITIVE_INFINITY : rawMaxW + horizontalMargins

  const minH = (parseCssPixelSize(cs.minHeight) ?? 0) + verticalMargins
  const rawMaxH = parseCssPixelSize(cs.maxHeight)
  const maxH =
    rawMaxH === null ? Number.POSITIVE_INFINITY : rawMaxH + verticalMargins

  return {
    minW,
    preferredW: clampToRange(preferredSize.w, minW, maxW),
    maxW,
    minH,
    preferredH: clampToRange(preferredSize.h, minH, maxH),
    maxH,
  }
}

function measureOuterSizeAtWidth(
  el: HTMLElement,
  forcedWidth: number,
): { w: number; h: number } {
  const prev = {
    position: el.style.position,
    left: el.style.left,
    top: el.style.top,
    width: el.style.width,
    display: el.style.display,
    visibility: el.style.visibility,
    opacity: el.style.opacity,
    pointerEvents: el.style.pointerEvents,
  }

  el.style.position = 'absolute'
  el.style.left = '-99999px'
  el.style.top = '0'
  el.style.width = `${forcedWidth}px`
  el.style.display = 'block'
  el.style.visibility = 'hidden'
  el.style.opacity = '0'
  el.style.pointerEvents = 'none'

  const measured = getOuterSize(el)

  el.style.position = prev.position
  el.style.left = prev.left
  el.style.top = prev.top
  el.style.width = prev.width
  el.style.display = prev.display
  el.style.visibility = prev.visibility
  el.style.opacity = prev.opacity
  el.style.pointerEvents = prev.pointerEvents

  return measured
}

function splitTracks(template: string): Array<string> {
  const tokens: Array<string> = []
  let depth = 0
  let start = 0

  for (let i = 0; i < template.length; i++) {
    const ch = template[i]
    if (ch === '(') depth += 1
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (/\s/.test(ch) && depth === 0) {
      if (start < i) tokens.push(template.slice(start, i))
      start = i + 1
    }
  }
  if (start < template.length) tokens.push(template.slice(start))
  return tokens.filter(Boolean)
}

function parseRepeatCount(template: string): number | null {
  const trimmed = template.trim()
  const match = /^repeat\(\s*(\d+)\s*,/i.exec(trimmed)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

function parseAutoRepeatMinTrack(template: string): number | null {
  const trimmed = template.trim()
  if (!/^repeat\(\s*auto-(fit|fill)\s*,/i.test(trimmed)) return null
  const minmaxMatch = /minmax\(\s*([0-9]*\.?[0-9]+)px\s*,/i.exec(trimmed)
  if (!minmaxMatch) return null
  const value = Number(minmaxMatch[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

// ─── useStore — primitive selector hook ──────────────────────────────────────

function useStore<T>(
  selector: (state: OverflowStoreState) => T,
  store: OverflowStore,
): T {
  const getSnapshot = React.useCallback(
    () => selector(store.getState()),
    [store], // selector should be stable (memoised at call-site)
  )
  return React.useSyncExternalStore(
    store.subscribe,
    getSnapshot,
    getSnapshot, // same for SSR — no hydration mismatch
  )
}

// ─── Public hooks ─────────────────────────────────────────────────────────────

/**
 * useOverflow
 *
 * Reactive overflow state accessible from any descendant of <Overflow>.
 * Each field is subscribed independently — the caller only re-renders when
 * its specific value changes.
 *
 * rootId is exposed for aria-controls wiring in OverflowActions children.
 *
 * @example
 * function ViewAllButton() {
 *   const { isOverflowing, hiddenCount, rootId } = useOverflow()
 *   if (!isOverflowing) return null
 *   return <button aria-controls={rootId}>View {hiddenCount} more</button>
 * }
 */
export function useOverflow() {
  const ctx = useOverflowContext('useOverflow')

  const isOverflowing = useStore(
    React.useCallback((s: OverflowStoreState) => s.isOverflowing, []),
    ctx.store,
  )
  const visibleCount = useStore(
    React.useCallback((s: OverflowStoreState) => s.visibleCount, []),
    ctx.store,
  )
  const hiddenCount = useStore(
    React.useCallback((s: OverflowStoreState) => s.hiddenCount, []),
    ctx.store,
  )

  return {
    isOverflowing,
    visibleCount,
    hiddenCount,
    rootId: ctx.rootId,
    orientation: ctx.orientation,
  } as const
}

/**
 * useOverflowItem
 *
 * Per-item hidden state. Must be used inside an <OverflowItem> subtree.
 * Enables exit animations, conditional content, or aria feedback on
 * whether this specific item is currently hidden.
 *
 * @example
 * function NavPill({ label }: { label: string }) {
 *   const { isHidden } = useOverflowItem()
 *   return (
 *     <span data-hidden={isHidden || undefined}>
 *       {label}
 *     </span>
 *   )
 * }
 */
export function useOverflowItem(): OverflowItemContextValue {
  const ctx = React.useContext(OverflowItemContext)
  if (!ctx)
    throw new Error(`\`useOverflowItem\` must be used within \`${ITEM_NAME}\``)
  return ctx
}

// ─── Measurement utilities ────────────────────────────────────────────────────

/**
 * Sub-pixel content area of a container element.
 *
 * WIDTH  — getBoundingClientRect().width minus border + padding.
 *          Falls back to parent when the element reports zero width
 *          (e.g. a flex:1 child before first paint).
 *
 * HEIGHT — scrollHeight > clientHeight reliably signals height-constraint
 *          (overflow:hidden clips visible content but scrollHeight grows).
 *          When the element grew to fit its content, use the parent instead.
 *
 * Using getBoundingClientRect() rather than clientWidth/offsetWidth gives us
 * fractional-pixel precision, eliminating accumulated rounding error across
 * many items that caused incorrect cutoff calculations.
 */
function resolveSpace(el: HTMLElement): {
  contentW: number
  contentH: number
  containerRect: DOMRect
  contentLeft: number
  contentTop: number
} {
  const cs = getComputedStyle(el)
  const rect = el.getBoundingClientRect()

  const bl = parseFloat(cs.borderLeftWidth) || 0
  const br = parseFloat(cs.borderRightWidth) || 0
  const bt = parseFloat(cs.borderTopWidth) || 0
  const bb = parseFloat(cs.borderBottomWidth) || 0
  const pl = parseFloat(cs.paddingLeft) || 0
  const pr = parseFloat(cs.paddingRight) || 0
  const pt = parseFloat(cs.paddingTop) || 0
  const pb = parseFloat(cs.paddingBottom) || 0

  // Inner content box (excludes border + padding)
  const selfW = rect.width - bl - br - pl - pr
  const selfH = rect.height - bt - bb - pt - pb

  const parent = el.parentElement
  const pcs = parent ? getComputedStyle(parent) : null
  const pRect = parent ? parent.getBoundingClientRect() : null

  const parentW =
    pRect && pcs
      ? pRect.width -
        (parseFloat(pcs.borderLeftWidth) || 0) -
        (parseFloat(pcs.borderRightWidth) || 0) -
        (parseFloat(pcs.paddingLeft) || 0) -
        (parseFloat(pcs.paddingRight) || 0)
      : 0
  const parentH =
    pRect && pcs
      ? pRect.height -
        (parseFloat(pcs.borderTopWidth) || 0) -
        (parseFloat(pcs.borderBottomWidth) || 0) -
        (parseFloat(pcs.paddingTop) || 0) -
        (parseFloat(pcs.paddingBottom) || 0)
      : 0

  return {
    contentW: selfW > 0 ? selfW : parentW,
    // Use the element's own content box whenever it is measurable.
    // Falling back to parent height here overestimates available space in
    // vertical stacks (e.g. when OverflowActions is a sibling), which delays
    // or prevents correct vertical cutoff.
    contentH: selfH > 0 ? selfH : parentH,
    containerRect: rect,
    contentLeft: rect.left + bl + pl,
    contentTop: rect.top + bt + pt,
  }
}

// ─── Overflow (root) ──────────────────────────────────────────────────────────

export interface OverflowProps extends useRender.ComponentProps<'div'> {
  /**
   * Which axis to detect overflow on. Consumed by OverflowGroup via context.
   * @default 'none'
   */
  orientation?: OverflowOrientation
  /**
   * Fires when isOverflowing transitions between true ↔ false.
   * Stored in propsRef — never stale.
   */
  onOverflowChange?: (isOverflowing: boolean) => void
  /**
   * SSR / first-render hint: the expected number of visible items before
   * client-side measurement. Prevents a flash of all items on hydration.
   * @default 0
   */
  defaultVisibleCount?: number
}

export function Overflow(props: OverflowProps) {
  const {
    orientation = 'none',
    onOverflowChange,
    defaultVisibleCount = 0,
    className,
    id,
    ref,
    render,
    children,
    ...rootProps
  } = props

  const instanceId = React.useId()
  const rootId = id ?? instanceId

  // propsRef: callbacks always fresh, no deps array
  const propsRef = React.useRef({ onOverflowChange })
  useIsomorphicLayoutEffect(() => {
    propsRef.current = { onOverflowChange }
  })

  // Store — one instance, stable reference, never recreated
  const store = React.useMemo(
    () =>
      createStore({
        visibleCount: defaultVisibleCount,
        hiddenCount: 0,
        isOverflowing: false,
        hiddenIds: new Set<string>(),
        overscanIds: new Set<string>(),
      }),
    [],
  )

  // Fire onOverflowChange when isOverflowing changes
  useIsomorphicLayoutEffect(() => {
    let prev = store.getState().isOverflowing
    return store.subscribe(() => {
      const next = store.getState().isOverflowing
      if (next !== prev) {
        prev = next
        propsRef.current.onOverflowChange?.(next)
      }
    })
  }, [store])

  const context = React.useMemo<OverflowContextValue>(
    () => ({ rootId, orientation, store }),
    [rootId, orientation, store],
  )

  const defaultProps: useRender.ElementProps<'div'> & {
    'data-slot': string
    'data-orientation'?: OverflowOrientation
  } = {
    id: rootId,
    'data-slot': 'overflow',
    'data-orientation': orientation !== 'none' ? orientation : undefined,
    className: cn('flex min-w-0 min-h-0 max-w-full', className),
    children,
  }

  const element = useRender<Record<string, unknown>, HTMLElement>({
    defaultTagName: 'div',
    ref: [ref as React.Ref<HTMLDivElement>],
    render,
    props: mergeProps(defaultProps, rootProps as Record<string, unknown>),
  }) as React.ReactElement

  return (
    <OverflowContext.Provider value={context}>
      {element}
    </OverflowContext.Provider>
  )
}

// ─── OverflowGroup ────────────────────────────────────────────────────────────

export interface OverflowGroupProps extends useRender.ComponentProps<'div'> {
  /**
   * When true (default), the group fills available space.
   *
   * - true  → `flex-1 w-full` behavior for classic “fill row/column” layouts
   * - false → content-sized group that still shrinks under parent constraints
   */
  fill?: boolean
  /**
   * When true (default), use parent content box as the authoritative
   * measurement constraint when available.
   *
   * This prevents oscillation in content-sized groups (fill=false) where
   * available width would otherwise depend on currently-visible items.
   */
  stabilizeByParent?: boolean
  /**
   * Which size to use when deciding whether another item can fit.
   *
   * - `preferred`: use the current measured size
   * - `min`: use CSS min-width/min-height as the fit floor
   * - `balanced`: try preferred first, then fall back to min if needed
   *
   * `grid` still primarily uses measured track-sized height; this prop mainly
   * affects horizontal, vertical, and wrap packing.
   *
   * @default 'min'
   */
  fitStrategy?: OverflowFitStrategy
  /**
   * Number of items beyond the visible cutoff to keep mounted (but hidden).
   * Only takes effect on OverflowItems with keepMounted={false}.
   *
   * Pre-mounting items just past the visible boundary means they can become
   * visible on resize without a React subtree remount — useful when mapping
   * over many complex items. The overscan window is buffered internally so it
   * does not slide on every single resize step, which reduces mount churn
   * during continuous resizing. Has no effect when keepMounted={true} because
   * those items are always mounted regardless.
   *
   * @default 0
   */
  overscan?: number
}

export function OverflowGroup(props: OverflowGroupProps) {
  const {
    fill = true,
    stabilizeByParent = true,
    fitStrategy = 'min',
    overscan = 0,
    className,
    ref,
    render,
    children,
    ...containerProps
  } = props

  // Keep overscan in a ref so calc() can read the latest value without
  // needing it in its own dependency array (avoids recreating calc on change).
  const overscanRef = React.useRef(overscan)
  overscanRef.current = overscan

  const ctx = useOverflowContext(CONTAINER_NAME)

  // ── Refs ──────────────────────────────────────────────────────────────────────

  // Item registry: id → { el, index, node, isSeparator }
  // Using a ref so reads in calc() always see the latest registrations
  // without making calc itself a dependency.
  const registryRef = React.useRef(
    new Map<
      string,
      {
        el: HTMLElement
        index: number
        node: React.ReactNode
        isSeparator: boolean
      }
    >(),
  )
  // Insertion-order tracking for stable sort
  const orderRef = React.useRef<Array<string>>([])
  const indicatorRef = React.useRef<HTMLElement | null>(null)
  /** True once any OverflowIndicator has mounted — never goes back to false. */
  const hasIndicatorRef = React.useRef(false)
  const actionsRef = React.useRef<HTMLElement | null>(null)
  const containerElRef = React.useRef<HTMLElement | null>(null)
  const itemObserverRef = React.useRef<ResizeObserver | null>(null)
  const calcQueuedRef = React.useRef(false)
  const isUnmountedRef = React.useRef(false)
  const overscanRangeRef = React.useRef({ start: 0, end: 0 })
  const scheduleCalcRef = React.useRef<() => void>(() => {})

  /**
   * Size cache — keyed by item id, stores the last measured unconstrained
   * bounding dimensions (sub-pixel, from getBoundingClientRect).
   *
   * Why this is necessary: consumers often apply `[data-hidden] { display:none }`
   * which makes hidden items report { width:0, height:0 }. Without caching we'd
   * read 0 for every hidden item and think they all fit, causing jitter.
   * The cache is populated on registration and on every successful live read,
   * so calc() always has real dimensions available even for currently-hidden items.
   */
  const sizeCacheRef = React.useRef(new Map<string, { w: number; h: number }>())

  /**
   * Indicator size cache — preserves the last known rendered size of the
   * OverflowIndicator element between overflowing ↔ not-overflowing transitions.
   *
   * Problem: when forceMount=false (the default), the indicator unmounts when
   * nothing is overflowing. On the next calc() pass — before the indicator has
   * re-mounted and registered — indicatorRef.current is null, so ow/oh read as 0.
   * That means calc() thinks it doesn't need to reserve space for the indicator,
   * which can produce an incorrect visible count on the first pass.
   *
   * Fix: keep the last observed { w, h } here. calc() falls back to these cached
   * values when the indicator is not currently mounted. When the indicator does
   * mount and register, it triggers a calc() pass with the live size.
   */
  const indicatorSizeCacheRef = React.useRef({ w: 0, h: 0 })
  const actionsSizeCacheRef = React.useRef({ w: 0, h: 0 })

  // ── Registration ──────────────────────────────────────────────────────────────

  const registerItem = React.useCallback(
    (
      id: string,
      el: HTMLElement,
      node: React.ReactNode,
      isSeparator = false,
    ) => {
      const prev = registryRef.current.get(id)
      const existingIndex = orderRef.current.indexOf(id)
      const index =
        existingIndex === -1 ? orderRef.current.length : existingIndex
      if (existingIndex === -1) orderRef.current.push(id)
      registryRef.current.set(id, { el, index, node, isSeparator })
      // Eagerly cache size at registration time so calc() has real dimensions
      // available on the very first pass (before any hide/show cycle).
      const isHiddenNode = el.dataset.hidden !== undefined
      const outer = getOuterSize(el)
      if (!isHiddenNode && (outer.w > 0 || outer.h > 0)) {
        sizeCacheRef.current.set(id, outer)
      }
      itemObserverRef.current?.observe(el)
      if (existingIndex === -1 || prev?.el !== el) {
        scheduleCalcRef.current()
      }
    },
    [],
  )

  const unregisterItem = React.useCallback((id: string) => {
    const existing = registryRef.current.get(id)
    if (existing) itemObserverRef.current?.unobserve(existing.el)
    registryRef.current.delete(id)
    sizeCacheRef.current.delete(id)
    orderRef.current = orderRef.current.filter((x) => x !== id)
    scheduleCalcRef.current()
  }, [])

  const registerIndicator = React.useCallback((el: HTMLElement | null) => {
    if (indicatorRef.current === el) return
    if (indicatorRef.current)
      itemObserverRef.current?.unobserve(indicatorRef.current)
    indicatorRef.current = el
    if (el) {
      hasIndicatorRef.current = true
      itemObserverRef.current?.observe(el)
    }
    scheduleCalcRef.current()
  }, [])

  const registerActions = React.useCallback((el: HTMLElement | null) => {
    if (actionsRef.current === el) return
    if (actionsRef.current)
      itemObserverRef.current?.unobserve(actionsRef.current)
    actionsRef.current = el
    if (el) itemObserverRef.current?.observe(el)
    scheduleCalcRef.current()
  }, [])

  /**
   * getHiddenNodes — returns the registered ReactNode for each hidden item
   * in document order, skipping separators (which have no meaningful node).
   *
   * This is called synchronously at OverflowIndicator render time, not stored
   * in the Zustand-like store, because ReactNodes cannot be reliably compared
   * with Object.is() and would create unnecessary store churn.
   */
  const getHiddenNodes = React.useCallback((): Array<React.ReactNode> => {
    const { hiddenIds } = ctx.store.getState()
    // Walk insertion order, filter to hidden non-separator ids, sort by
    // registered index, return nodes. O(n) — no reverse lookup needed.
    return orderRef.current
      .filter((id) => hiddenIds.has(id))
      .map((id) => ({ id, entry: registryRef.current.get(id) }))
      .filter(
        (x): x is { id: string; entry: NonNullable<typeof x.entry> } =>
          x.entry !== undefined && !x.entry.isSeparator,
      )
      .sort((a, b) => a.entry.index - b.entry.index)
      .map((x) => x.entry.node)
  }, [ctx.store])

  const registrationCtx = React.useMemo<OverflowRegistrationContextValue>(
    () => ({
      registerItem,
      unregisterItem,
      registerIndicator,
      registerActions,
      getHiddenNodes,
    }),
    [
      registerItem,
      unregisterItem,
      registerIndicator,
      registerActions,
      getHiddenNodes,
    ],
  )

  // ── calc ────────────────────────────────────────────────────────────────────

  const calc = React.useCallback(() => {
    const orientation = ctx.orientation
    const el = containerElRef.current

    // Build sorted item list from registry
    const items = orderRef.current
      .map((id) => {
        const entry = registryRef.current.get(id)
        return entry ? { id, ...entry } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.index - b.index)

    const n = items.length

    if (orientation === 'none' || !el) {
      ctx.store.batch({
        visibleCount: n,
        hiddenCount: 0,
        isOverflowing: false,
        hiddenIds: new Set(),
        overscanIds: new Set(),
      })
      return
    }

    const cs = getComputedStyle(el)
    const { contentW, contentH } = resolveSpace(el)

    const pt = parseFloat(cs.paddingTop) || 0
    const pb = parseFloat(cs.paddingBottom) || 0
    const pl = parseFloat(cs.paddingLeft) || 0
    const pr = parseFloat(cs.paddingRight) || 0

    const directW = el.clientWidth - pl - pr
    const directH = el.clientHeight - pt - pb

    const parent = el.parentElement
    const parentCs = parent ? getComputedStyle(parent) : null
    const parentRect = parent ? parent.getBoundingClientRect() : null

    const parentW =
      parentRect && parentCs
        ? parentRect.width -
          (parseFloat(parentCs.borderLeftWidth) || 0) -
          (parseFloat(parentCs.borderRightWidth) || 0) -
          (parseFloat(parentCs.paddingLeft) || 0) -
          (parseFloat(parentCs.paddingRight) || 0)
        : 0
    const parentH =
      parentRect && parentCs
        ? parentRect.height -
          (parseFloat(parentCs.borderTopWidth) || 0) -
          (parseFloat(parentCs.borderBottomWidth) || 0) -
          (parseFloat(parentCs.paddingTop) || 0) -
          (parseFloat(parentCs.paddingBottom) || 0)
        : 0

    const rawW = directW > 0 ? directW : contentW
    const rawH = directH > 0 ? directH : contentH

    // Use parent constraints as the authoritative available space whenever
    // possible. Using Math.min(raw, parent) creates a feedback loop for
    // content-sized groups (fill=false): hiding items shrinks raw width, which
    // then further reduces measured space and causes oscillation.
    const availableW = stabilizeByParent && parentW > 0 ? parentW : rawW
    const availableH = stabilizeByParent && parentH > 0 ? parentH : rawH

    if (orientation === 'horizontal') {
      if (availableW <= 0) return
    } else if (orientation === 'vertical') {
      if (availableH <= 0) return
    } else {
      // wrap/grid require both axes.
      if (availableW <= 0 || availableH <= 0) return
    }

    // CSS gap values — parseFloat('normal') → NaN → 0, which is correct for flex.
    const cssColGap = parseFloat(cs.columnGap) || 0
    const cssRowGap = parseFloat(cs.rowGap) || 0

    // Indicator (overflow slot) size — use live rect when mounted, fall back to
    // the last cached size so calc() doesn't undercount on the first pass after
    // an overflow ↔ not-overflowing transition (forceMount=false default).
    const oel = indicatorRef.current
    if (oel) {
      const outer = getOuterSize(oel)
      if (outer.w > 0 || outer.h > 0) {
        indicatorSizeCacheRef.current = outer
      }
    }
    const ow = indicatorSizeCacheRef.current.w
    const oh = indicatorSizeCacheRef.current.h

    const ael = actionsRef.current
    if (ael) {
      const outer = getOuterSize(ael)
      if (outer.w > 0 || outer.h > 0) {
        actionsSizeCacheRef.current = outer
      }
    }
    const aw = actionsSizeCacheRef.current.w
    const ah = actionsSizeCacheRef.current.h

    const cg = cssColGap
    const rg = cssRowGap

    const reserveW =
      orientation === 'horizontal' && aw > 0 ? aw + (n > 0 ? cg : 0) : 0
    const reserveH =
      (orientation === 'vertical' ||
        orientation === 'wrap' ||
        orientation === 'grid') &&
      ah > 0
        ? ah + (n > 0 ? rg : 0)
        : 0

    const flowW = Math.max(0, availableW - reserveW)
    const flowH = Math.max(0, availableH - reserveH)

    /**
     * getSizeBounds — sub-pixel item dimensions with cache fallback plus
     * CSS min/max constraint bounds from computed style.
     *
     * Preferred size tracks the current measured box. Min/max sizes are outer
     * sizes (margins included) derived from computed min/max width/height.
     * Horizontal/vertical fit uses the minimum constrained size as the floor,
     * which lets more items become visible as soon as they can fit at `min-*`.
     */
    const getSizeBounds = (
      id: string,
      itemEl: HTMLElement,
      forcedWidth?: number,
    ): OuterSizeBounds => {
      let preferredSize: { w: number; h: number }

      if (forcedWidth !== undefined && forcedWidth > 0) {
        const measured = measureOuterSizeAtWidth(itemEl, forcedWidth)
        if (measured.w > 0 || measured.h > 0) {
          sizeCacheRef.current.set(id, measured)
          preferredSize = measured
          return getOuterSizeBounds(itemEl, preferredSize)
        }
      }

      const isHiddenNode = itemEl.dataset.hidden !== undefined
      if (isHiddenNode) {
        preferredSize = sizeCacheRef.current.get(id) ?? { w: 0, h: 0 }
        return getOuterSizeBounds(itemEl, preferredSize)
      }
      const outer = getOuterSize(itemEl)
      if (outer.w > 0 || outer.h > 0) {
        sizeCacheRef.current.set(id, outer)
        preferredSize = outer
        return getOuterSizeBounds(itemEl, preferredSize)
      }
      preferredSize = sizeCacheRef.current.get(id) ?? { w: 0, h: 0 }
      return getOuterSizeBounds(itemEl, preferredSize)
    }

    const itemSizes = items.map((item) => getSizeBounds(item.id, item.el))

    const pickAxisFitSize = (
      bounds: OuterSizeBounds,
      axis: 'w' | 'h',
      remainingSpace = Number.POSITIVE_INFINITY,
    ): number => {
      const preferred = axis === 'w' ? bounds.preferredW : bounds.preferredH
      const min = axis === 'w' ? bounds.minW : bounds.minH
      const floor = min > 0 ? min : preferred

      if (fitStrategy === 'preferred') return preferred
      if (fitStrategy === 'min') return floor
      return preferred <= remainingSpace ? preferred : floor
    }

    let visibleCount = n

    if (orientation === 'horizontal') {
      // Accumulate item widths + gaps. When an indicator is present, reserve
      // its space for all but the last item. Without an indicator items are
      // simply packed until they no longer fit (no slot reserved).
      const hasIndicator = hasIndicatorRef.current
      let used = 0
      let count = 0
      for (let i = 0; i < n; i++) {
        const g = i > 0 ? cg : 0
        const indicatorSlot = i === n - 1 || !hasIndicator ? 0 : cg + ow
        const remainingSpace = Math.max(0, flowW - used - g - indicatorSlot)
        const w = pickAxisFitSize(itemSizes[i], 'w', remainingSpace)
        if (i === n - 1) {
          if (used + g + w <= flowW) count = n
          break
        }
        if (used + g + w + indicatorSlot <= flowW) {
          used += g + w
          count = i + 1
        } else {
          break
        }
      }
      visibleCount = count
    } else if (orientation === 'vertical') {
      const hasIndicator = hasIndicatorRef.current
      let used = 0
      let count = 0
      for (let i = 0; i < n; i++) {
        const g = i > 0 ? rg : 0
        const indicatorSlot = i === n - 1 || !hasIndicator ? 0 : rg + oh
        const remainingSpace = Math.max(0, flowH - used - g - indicatorSlot)
        const h = pickAxisFitSize(itemSizes[i], 'h', remainingSpace)
        if (i === n - 1) {
          if (used + g + h <= flowH) count = n
          break
        }
        if (used + g + h + indicatorSlot <= flowH) {
          used += g + h
          count = i + 1
        } else {
          break
        }
      }
      visibleCount = count
    } else if (orientation === 'wrap') {
      const canFitWrap = (visible: number): boolean => {
        let rowUsedW = 0
        let rowH = 0
        let usedH = 0

        const pack = (w: number, h: number): boolean => {
          const nextW = rowUsedW === 0 ? w : rowUsedW + cg + w
          if (rowUsedW > 0 && nextW > flowW) {
            const nextUsedH = usedH + (usedH > 0 ? rg : 0) + rowH
            if (nextUsedH > flowH) return false
            usedH = nextUsedH
            rowUsedW = w
            rowH = h
            return true
          }
          rowUsedW = nextW
          rowH = Math.max(rowH, h)
          return true
        }

        for (let i = 0; i < visible; i++) {
          const remainingRowSpace = Math.max(
            0,
            flowW - (rowUsedW === 0 ? 0 : rowUsedW + cg),
          )
          const w = pickAxisFitSize(itemSizes[i], 'w', remainingRowSpace)
          const h = pickAxisFitSize(itemSizes[i], 'h')
          if (!pack(w, h)) return false
        }

        if (visible < n && hasIndicatorRef.current && !pack(ow, oh))
          return false

        const totalH = usedH + (usedH > 0 ? rg : 0) + rowH
        return totalH <= flowH
      }

      let best = 0
      for (let k = 0; k <= n; k++) {
        if (canFitWrap(k)) best = k
      }
      visibleCount = best
    } else if (orientation === 'grid') {
      const template = cs.gridTemplateColumns
      if (process.env.NODE_ENV !== 'production' && template === 'none') {
        console.warn(
          `[${CONTAINER_NAME}] orientation="grid" requires display:grid. ` +
            'gridTemplateColumns resolved to "none" — check className/style.',
        )
      }

      const explicitRepeat = parseRepeatCount(template)
      const trackTokens = splitTracks(template)
      const autoRepeatMin = parseAutoRepeatMinTrack(template)

      let colCount = 1
      if (explicitRepeat !== null) {
        colCount = explicitRepeat
      } else if (trackTokens.length > 0 && template !== 'none') {
        colCount = trackTokens.length
      } else if (autoRepeatMin !== null) {
        colCount = Math.max(1, Math.floor((flowW + cg) / (autoRepeatMin + cg)))
      } else {
        const sample = items[0] ? getOuterSize(items[0].el).w : flowW
        colCount = Math.max(1, Math.floor((flowW + cg) / (sample + cg)))
      }

      colCount = Math.max(1, colCount)
      const trackW = Math.max(1, (flowW - (colCount - 1) * cg) / colCount)

      const itemHeights = items.map(
        (item) => getSizeBounds(item.id, item.el, trackW).preferredH,
      )
      const indicatorH = oel
        ? getSizeBounds('__indicator__', oel, trackW).preferredH
        : indicatorSizeCacheRef.current.h

      const canFitGrid = (visible: number): boolean => {
        const rowHeights: Array<number> = []

        for (let i = 0; i < visible; i++) {
          const row = Math.floor(i / colCount)
          rowHeights[row] = Math.max(rowHeights[row] ?? 0, itemHeights[i])
        }

        if (visible < n && hasIndicatorRef.current) {
          const indicatorRow = Math.floor(visible / colCount)
          rowHeights[indicatorRow] = Math.max(
            rowHeights[indicatorRow] ?? 0,
            indicatorH,
          )
        }

        if (rowHeights.length === 0) return true

        let totalH = 0
        for (let i = 0; i < rowHeights.length; i++) {
          totalH += rowHeights[i]
          if (i > 0) totalH += rg
        }
        return totalH <= flowH + 0.5
      }

      let best = 0
      for (let k = 0; k <= n; k++) {
        if (canFitGrid(k)) best = k
      }

      // UX rule: avoid rendering the overflow indicator as the only item in a
      // new row (first column) when overflowing in multi-column grids.
      // If best lands exactly on a row boundary, shift one item into hidden so
      // the indicator shares the previous row.
      // Skipped entirely when no OverflowIndicator is present.
      const avoidLonelyIndicatorRow =
        hasIndicatorRef.current &&
        colCount > 1 &&
        best > 0 &&
        best < n &&
        best % colCount === 0
      const resolvedVisible = avoidLonelyIndicatorRow ? best - 1 : best
      visibleCount = resolvedVisible
    }

    // Trim trailing separators so the group never ends with a dangling divider.
    let trimmed = visibleCount
    while (trimmed > 0 && items[trimmed - 1].isSeparator) trimmed--

    const effectiveVisible = visibleCount < n ? trimmed : visibleCount
    const effectiveHidden = n - effectiveVisible
    const hiddenIds = new Set(items.slice(effectiveVisible).map((i) => i.id))

    // Build a sticky overscan window. Instead of sliding the overscan range on
    // every single visibleCount change, keep a buffered chunk mounted and only
    // refresh it when the boundary approaches the end of that chunk. This
    // avoids mount/unmount churn during live resize while preserving instant
    // reveal for nearby items.
    const overscanWindow = Math.max(0, Math.floor(overscanRef.current))
    const overscanIds = new Set<string>()
    if (overscanWindow > 0) {
      const range = overscanRangeRef.current
      const needsRefresh =
        range.end <= range.start ||
        range.end > n ||
        effectiveVisible < range.start ||
        effectiveVisible + overscanWindow > range.end

      if (needsRefresh) {
        range.start = Math.max(0, effectiveVisible - overscanWindow)
        range.end = Math.min(n, effectiveVisible + overscanWindow * 2)
      }

      for (let i = range.start; i < range.end; i++) {
        const id = items[i]?.id
        if (id && hiddenIds.has(id)) overscanIds.add(id)
      }
    } else {
      overscanRangeRef.current = { start: 0, end: 0 }
    }

    const prev = ctx.store.getState()
    if (
      prev.visibleCount === effectiveVisible &&
      prev.hiddenCount === effectiveHidden &&
      prev.isOverflowing === effectiveHidden > 0 &&
      areSetsEqual(prev.hiddenIds, hiddenIds) &&
      areSetsEqual(prev.overscanIds, overscanIds)
    ) {
      return
    }

    // Single atomic write — one subscriber notification per calc pass.
    ctx.store.batch({
      visibleCount: effectiveVisible,
      hiddenCount: effectiveHidden,
      isOverflowing: effectiveHidden > 0,
      hiddenIds,
      overscanIds,
    })
  }, [ctx, stabilizeByParent])

  const scheduleCalc = React.useCallback(() => {
    if (calcQueuedRef.current) return
    calcQueuedRef.current = true
    queueMicrotask(() => {
      calcQueuedRef.current = false
      if (isUnmountedRef.current) return
      calc()
    })
  }, [calc])

  const flushCalc = React.useCallback(() => {
    if (isUnmountedRef.current) return
    calcQueuedRef.current = false
    calc()
  }, [calc])

  scheduleCalcRef.current = scheduleCalc

  useIsomorphicLayoutEffect(() => {
    calc()
  })

  React.useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
      calcQueuedRef.current = false
    }
  }, [])

  // ── Resize observation ────────────────────────────────────────────────────────

  React.useEffect(() => {
    const el = containerElRef.current
    if (!el || ctx.orientation === 'none') return

    // Container + parent: parent resize handles unconstrained containers
    // (e.g. a flex:1 child whose available space is set by the parent).
    // Run these synchronously so overscanned items reveal immediately as
    // available space expands.
    const containerRo = new ResizeObserver(flushCalc)
    containerRo.observe(el)
    if (el.parentElement) containerRo.observe(el.parentElement)

    // Per-item ResizeObserver: re-calc when individual item content changes size
    // (e.g. async image load, dynamic label text, font loading).
    // Observing each item's element directly avoids needing to watch the full
    // container subtree with a MutationObserver.
    const itemRo = new ResizeObserver(scheduleCalc)
    itemObserverRef.current = itemRo
    for (const { el: itemEl } of registryRef.current.values()) {
      itemRo.observe(itemEl)
    }

    return () => {
      containerRo.disconnect()
      itemRo.disconnect()
      itemObserverRef.current = null
    }
  }, [flushCalc, scheduleCalc, ctx.orientation])

  const defaultProps: useRender.ElementProps<'div'> & {
    'data-slot': string
  } = {
    'data-slot': 'overflow-group',
    className: cn(
      'relative min-w-0 min-h-0 max-w-full overflow-hidden',
      fill ? 'flex-1 w-full' : 'w-auto shrink',
      className,
    ),
    children,
  }

  const element = useRender<Record<string, unknown>, HTMLElement>({
    defaultTagName: 'div',
    ref: [
      ref as React.Ref<HTMLDivElement>,
      containerElRef as React.Ref<HTMLDivElement>,
    ],
    render,
    props: mergeProps(defaultProps, containerProps as Record<string, unknown>),
  }) as React.ReactElement

  return (
    <OverflowRegistrationContext.Provider value={registrationCtx}>
      {element}
    </OverflowRegistrationContext.Provider>
  )
}

// ─── OverflowItem ─────────────────────────────────────────────────────────────

export interface OverflowItemProps extends useRender.ComponentProps<'div'> {
  /**
   * When true (default), hidden items stay in the DOM with:
   *   data-hidden=""   — CSS targeting
   *   aria-hidden      — screen reader suppression
   *   tabIndex=-1      — keyboard navigation suppression
   * Preserves React subtree state in hidden items (e.g. unsubmitted forms,
   * scroll positions, in-progress animations).
   *
   * Implementation detail: hidden mounted items use absolute zero-footprint
   * layout styles (width/height 0 + overflow hidden + visibility hidden),
   * which preserves subtree state without contributing to scroll extents.
   *
   * When false, hidden items outside the overscan window drop their subtree
   * for performance, but a lightweight wrapper stays mounted so the overflow
   * registry keeps their order and cached size. This allows items to reappear
   * immediately when space expands.
   */
  keepMounted?: boolean
  /**
   * Reserved for priority-based overflow eviction.
   * Higher-priority items are kept visible longer when space is tight.
   * Implementation planned for a future release.
   */
  priority?: number
}

export function OverflowItem(props: OverflowItemProps) {
  const {
    keepMounted = true,
    priority: _priority, // reserved, not yet used in measurement
    className,
    ref,
    render,
    children,
    ...itemProps
  } = props

  const overflowCtx = useOverflowContext(ITEM_NAME)
  const registrationCtx = useOverflowRegistrationContext(ITEM_NAME)

  const itemId = React.useId()
  const elRef = React.useRef<HTMLElement | null>(null)

  // Read hidden state from store via primitive selector
  const isHidden = useStore(
    React.useCallback(
      (s: OverflowStoreState) => s.hiddenIds.has(itemId),
      [itemId],
    ),
    overflowCtx.store,
  )

  // True when this item is inside the overscan window: hidden but should stay
  // mounted to allow instant reveal on resize without a tree remount.
  const isOverscan = useStore(
    React.useCallback(
      (s: OverflowStoreState) => s.overscanIds.has(itemId),
      [itemId],
    ),
    overflowCtx.store,
  )

  // index: populated lazily from the order array length at registration time
  const indexRef = React.useRef(0)

  // Register this item's element + node with the container
  useIsomorphicLayoutEffect(() => {
    const el = elRef.current
    if (!el) return
    registrationCtx.registerItem(itemId, el, children, false)
    return () => registrationCtx.unregisterItem(itemId)
    // Only run on mount/unmount — children updates handled below
  }, [itemId, registrationCtx])

  // Re-register when children change to keep hiddenChildren in OverflowInfo fresh
  useIsomorphicLayoutEffect(() => {
    const el = elRef.current
    if (!el) return
    registrationCtx.registerItem(itemId, el, children, false)
  }, [children])

  const itemContext: OverflowItemContextValue = {
    itemId,
    isHidden,
    index: indexRef.current,
  }

  const requiresLiveMeasurement =
    overflowCtx.orientation === 'grid' || overflowCtx.orientation === 'wrap'
  const shouldRenderChildren =
    keepMounted || !isHidden || isOverscan || requiresLiveMeasurement
  const shouldHideWrapper = isHidden
  const shouldWarmHidden = isHidden && isOverscan && !requiresLiveMeasurement

  const defaultProps: useRender.ElementProps<'div'> & {
    'data-slot': string
    'data-hidden'?: string
  } = {
    'data-slot': 'overflow-item',
    'data-hidden': isHidden ? '' : undefined,
    'aria-hidden': isHidden ? true : undefined,
    tabIndex: isHidden ? -1 : undefined,
    style: shouldHideWrapper
      ? shouldWarmHidden
        ? {
            position: 'absolute',
            top: 0,
            left: 0,
            visibility: 'hidden',
            pointerEvents: 'none',
            contain: 'layout paint style',
          }
        : {
            position: 'absolute',
            top: 0,
            left: 0,
            width: 0,
            height: 0,
            overflow: 'hidden',
            visibility: 'hidden',
            pointerEvents: 'none',
          }
      : undefined,
    className: cn('shrink-0', className),
    children: shouldRenderChildren ? children : null,
  }

  const element = useRender<Record<string, unknown>, HTMLElement>({
    defaultTagName: 'div',
    ref: [ref as React.Ref<HTMLDivElement>, elRef as React.Ref<HTMLDivElement>],
    render,
    props: mergeProps(defaultProps, itemProps as Record<string, unknown>),
  }) as React.ReactElement

  return (
    <OverflowItemContext.Provider value={itemContext}>
      {element}
    </OverflowItemContext.Provider>
  )
}

// ─── OverflowIndicator ────────────────────────────────────────────────────────

export interface OverflowIndicatorProps extends Omit<
  useRender.ComponentProps<'div'>,
  'children'
> {
  /**
   * When false (default), returns null when not overflowing.
   * When true, always renders — data-visible="" toggles instead.
   * Use forceMount to drive CSS transitions (e.g. opacity-0 → opacity-100).
   */
  forceMount?: boolean
  /**
   * Static ReactNode, or a render function receiving OverflowInfo.
   * The render function form gives access to hiddenCount and hiddenChildren.
   *
   * @example static
   * <OverflowIndicator>
   *   <span>More items</span>
   * </OverflowIndicator>
   *
   * @example render function
   * <OverflowIndicator>
   *   {({ hiddenCount, hiddenChildren }) => (
   *     <MoreMenu count={hiddenCount} items={hiddenChildren} />
   *   )}
   * </OverflowIndicator>
   */
  children?: React.ReactNode | ((info: OverflowInfo) => React.ReactNode)
}

export function OverflowIndicator(props: OverflowIndicatorProps) {
  const {
    forceMount = false,
    className,
    ref,
    render,
    children,
    ...indicatorProps
  } = props

  const overflowCtx = useOverflowContext(INDICATOR_NAME)
  const registrationCtx = useOverflowRegistrationContext(INDICATOR_NAME)

  const isOverflowing = useStore(
    React.useCallback((s: OverflowStoreState) => s.isOverflowing, []),
    overflowCtx.store,
  )
  const hiddenCount = useStore(
    React.useCallback((s: OverflowStoreState) => s.hiddenCount, []),
    overflowCtx.store,
  )
  // Subscribed for reactivity only — when hiddenIds changes the indicator
  // re-renders, keeping the getHiddenNodes() call below fresh. The value
  // is not read directly here; getHiddenNodes() reads it via store.getState().
  useStore(
    React.useCallback((s: OverflowStoreState) => s.hiddenIds, []),
    overflowCtx.store,
  )

  const elRef = React.useRef<HTMLElement | null>(null)

  // Register so the measurement engine can read the indicator's rendered size
  useIsomorphicLayoutEffect(() => {
    registrationCtx.registerIndicator(elRef.current)
    return () => registrationCtx.registerIndicator(null)
  }, [registrationCtx])

  const shouldRender = forceMount || isOverflowing
  const hiddenMeasureStyle: React.CSSProperties | undefined =
    !shouldRender && !forceMount
      ? {
          position: 'absolute',
          visibility: 'hidden',
          pointerEvents: 'none',
        }
      : undefined

  // Build hiddenChildren by calling getHiddenNodes() from the registration
  // context. This is safe to call synchronously at render time because the
  // indicator already re-renders whenever hiddenIds changes (via useStore above),
  // so the list is always fresh. ReactNodes are intentionally not stored in the
  // external store to avoid spurious re-renders from non-comparable values.
  const info: OverflowInfo = {
    hiddenCount,
    hiddenChildren: registrationCtx.getHiddenNodes(),
    isOverflowing,
  }

  const resolvedChildren =
    typeof children === 'function' ? children(info) : children

  const defaultProps: useRender.ElementProps<'div'> & {
    'data-slot': string
    'data-visible'?: string
  } = {
    'data-slot': 'overflow-indicator',
    'data-visible': isOverflowing ? '' : undefined,
    'aria-hidden': !shouldRender ? true : undefined,
    tabIndex: !shouldRender ? -1 : undefined,
    style: hiddenMeasureStyle,
    className: cn('shrink-0', className),
  }

  const element = useRender<Record<string, unknown>, HTMLElement>({
    defaultTagName: 'div',
    ref: [ref as React.Ref<HTMLDivElement>, elRef as React.Ref<HTMLDivElement>],
    render,
    props: mergeProps(
      { ...defaultProps, children: resolvedChildren } as Record<
        string,
        unknown
      >,
      indicatorProps as Record<string, unknown>,
    ),
  }) as React.ReactElement

  return element
}

// ─── OverflowActions ──────────────────────────────────────────────────────────

export interface OverflowActionsProps extends useRender.ComponentProps<'div'> {}

/**
 * OverflowActions
 *
 * Always-visible action slot. Can be rendered either:
 *   1) as a sibling of OverflowGroup (outside clipping), or
 *   2) inside OverflowGroup (space is reserved in overflow calculation).
 *
 * When rendered inside OverflowGroup, registration is automatic and
 * measurement reservation is orientation-aware.
 *
 * Use this for:
 *   - "View all N items" links that respond to overflow state
 *   - Sort/filter controls that must remain accessible
 *   - Count badges / navigation arrows
 *
 * Choose placement by intent:
 *   - Outside OverflowGroup:
 *     actions stay pinned and independent from item packing.
 *     Great for persistent controls that should not influence visible item count.
 *   - Inside OverflowGroup:
 *     actions are part of layout measurement and reserve space.
 *     Great when actions should visually track the indicator/last visible item.
 *
 * Children can call useOverflow() to react to the current overflow state.
 *
 * @example
 * <Overflow orientation="horizontal">
 *   <OverflowGroup className="flex items-center gap-2">
 *     {items.map(item => <OverflowItem key={item.id}>...</OverflowItem>)}
 *     <OverflowIndicator>{({ hiddenCount }) => <span>+{hiddenCount}</span>}</OverflowIndicator>
 *   </OverflowGroup>
 *   <OverflowActions>
 *     <ViewAllButton />   ← uses useOverflow() internally
 *   </OverflowActions>
 * </Overflow>
 *
 * @example
 * <Overflow orientation="horizontal">
 *   <OverflowGroup className="flex items-center gap-2">
 *     {items.map(item => <OverflowItem key={item.id}>...</OverflowItem>)}
 *     <OverflowIndicator>{({ hiddenCount }) => <span>+{hiddenCount}</span>}</OverflowIndicator>
 *     <OverflowActions>
 *       <ViewAllButton />
 *     </OverflowActions>
 *   </OverflowGroup>
 * </Overflow>
 */
export function OverflowActions(props: OverflowActionsProps) {
  const { children, className, ref, render, ...actionsProps } = props

  // Validate placement (throws with a clear message if used outside Overflow)
  useOverflowContext(ACTIONS_NAME)
  const registrationCtx = React.useContext(OverflowRegistrationContext)
  const elRef = React.useRef<HTMLElement | null>(null)

  useIsomorphicLayoutEffect(() => {
    if (!registrationCtx) return
    registrationCtx.registerActions(elRef.current)
    return () => registrationCtx.registerActions(null)
  }, [registrationCtx])

  const defaultProps: useRender.ElementProps<'div'> & { 'data-slot': string } =
    {
      'data-slot': 'overflow-actions',
      className: cn('shrink-0', className),
      children,
    }

  return useRender<Record<string, unknown>, HTMLElement>({
    defaultTagName: 'div',
    ref: [ref as React.Ref<HTMLDivElement>, elRef as React.Ref<HTMLDivElement>],
    render,
    props: mergeProps(defaultProps, actionsProps as Record<string, unknown>),
  }) as React.ReactElement
}

// ─── OverflowSeparator ────────────────────────────────────────────────────────

export interface OverflowSeparatorProps {
  /**
   * Visual orientation of the separator line.
   * Defaults to 'vertical' which is correct for horizontal overflow rows.
   * Set to 'horizontal' for vertical/stacked layouts.
   * @default 'vertical'
   */
  orientation?: 'horizontal' | 'vertical'
  /** Additional inline styles applied to the outer wrapper span. */
  style?: React.CSSProperties
  className?: string
}

/**
 * OverflowSeparator
 *
 * A thin divider between OverflowItems that automatically disappears when
 * it would otherwise become the last visible element in the group.
 *
 * Uses the shadcn `Separator` under the hood and participates in the same
 * registration/measurement cycle as OverflowItem, so the overflow calculation
 * accounts for its physical size.
 *
 * Place it directly between two OverflowItems inside an OverflowGroup:
 *
 * @example
 * <OverflowGroup className="flex items-center gap-2">
 *   <OverflowItem>A</OverflowItem>
 *   <OverflowSeparator />
 *   <OverflowItem>B</OverflowItem>
 *   <OverflowSeparator />
 *   <OverflowItem>C</OverflowItem>
 *   <OverflowIndicator>…</OverflowIndicator>
 * </OverflowGroup>
 */
export function OverflowSeparator({
  orientation = 'vertical',
  style,
  className,
}: OverflowSeparatorProps) {
  const overflowCtx = useOverflowContext(SEPARATOR_NAME)
  const registrationCtx = useOverflowRegistrationContext(SEPARATOR_NAME)

  const itemId = React.useId()
  const elRef = React.useRef<HTMLElement | null>(null)

  // Read hidden state using the same primitive selector as OverflowItem
  const isHidden = useStore(
    React.useCallback(
      (s: OverflowStoreState) => s.hiddenIds.has(itemId),
      [itemId],
    ),
    overflowCtx.store,
  )

  // Register as a separator so calc() can trim trailing ones
  useIsomorphicLayoutEffect(() => {
    const el = elRef.current
    if (!el) return
    registrationCtx.registerItem(itemId, el, null, /* isSeparator */ true)
    return () => registrationCtx.unregisterItem(itemId)
  }, [itemId, registrationCtx])

  return (
    <span
      ref={elRef as React.Ref<HTMLSpanElement>}
      data-slot="overflow-separator"
      data-hidden={isHidden ? '' : undefined}
      aria-hidden="true"
      style={style}
      className={cn(
        'shrink-0 self-stretch',
        isHidden && 'invisible pointer-events-none',
        className,
      )}
    >
      <Separator
        orientation={orientation}
        className={cn(
          orientation === 'vertical' ? 'h-full w-px' : 'w-full h-px',
        )}
      />
    </span>
  )
}

// ─── OverflowAnnouncer ────────────────────────────────────────────────────────

export interface OverflowAnnouncerProps {
  /**
   * Custom announcement string. Receives current state.
   * Defaults to "Showing N of M items. K hidden." / "Showing all N items."
   */
  announce?: (state: {
    visibleCount: number
    hiddenCount: number
    total: number
  }) => string
}

/**
 * OverflowAnnouncer
 *
 * Visually hidden aria-live="polite" region. Announces overflow count changes
 * to screen reader users. Mount once inside <Overflow>.
 *
 * @example
 * <Overflow orientation="horizontal">
 *   <OverflowAnnouncer />
 *   <OverflowGroup>…</OverflowGroup>
 * </Overflow>
 */
export function OverflowAnnouncer({ announce }: OverflowAnnouncerProps) {
  const ctx = useOverflowContext(ANNOUNCER_NAME)

  const visibleCount = useStore(
    React.useCallback((s: OverflowStoreState) => s.visibleCount, []),
    ctx.store,
  )
  const hiddenCount = useStore(
    React.useCallback((s: OverflowStoreState) => s.hiddenCount, []),
    ctx.store,
  )

  const total = visibleCount + hiddenCount

  const message = announce
    ? announce({ visibleCount, hiddenCount, total })
    : hiddenCount > 0
      ? `Showing ${visibleCount} of ${total} items. ${hiddenCount} not visible.`
      : `Showing all ${total} items.`

  return (
    <span
      aria-live="polite"
      aria-atomic="true"
      data-slot="overflow-announcer"
      className="sr-only"
    >
      {message}
    </span>
  )
}
